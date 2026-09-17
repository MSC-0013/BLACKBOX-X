import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  pool,
  runMigrations,
  db,
  tenants,
  projects,
  experimentCampaigns,
  campaignRuns,
  storedArtifacts,
} from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import { buildServer } from '../../apps/blackbox-api/src/server.js';
import {
  PrometheusRegistry,
  defaultMetricsRegistry,
} from '@blackbox-x/observability';
import { StorageService } from '@blackbox-x/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function verifyNoMockInGates(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      verifyNoMockInGates(fullPath);
    } else if (
      entry.name.includes('mock') ||
      entry.name.endsWith('.mock.ts') ||
      entry.name.endsWith('.mock.js')
    ) {
      throw new Error(`Violation: Mock file found in gates test directory: ${fullPath}`);
    }
  }
}

async function runM11Gate() {
  console.log('========================================================================');
  console.log(' BLACKBOX-X M11 GATE: Analytics Dashboard API & Prometheus Reporting   ');
  console.log('========================================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied
  console.log('Ensuring all database migrations are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  const testPort = 3004;
  const targetHost = `http://127.0.0.1:${testPort}`;
  const app = buildServer();
  await app.listen({ port: testPort, host: '127.0.0.1' });
  console.log(`✓ Real API server listening on ${targetHost}\n`);

  const storageService = new StorageService({
    endpoint: 'http://127.0.0.1:9000',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'blackbox-artifacts',
  });

  try {
    // -------------------------------------------------------------------------
    // [1/7] Prometheus Registry & Strict Low-Cardinality Label Enforcement
    // -------------------------------------------------------------------------
    console.log('[1/7] Verifying Prometheus metrics registry and strict low-cardinality policy...');
    const isolatedRegistry = new PrometheusRegistry();

    // Valid low-cardinality labels should succeed
    isolatedRegistry.incrementCounter('blackbox_simulation_runs_total', {
      environment: 'production',
      status: 'completed',
    });
    isolatedRegistry.setGauge('blackbox_calibration_loss_mape', 0.042, {
      environment: 'production',
    });
    isolatedRegistry.setGauge('blackbox_worker_pool_active', 8, {
      worker_type: 'http-benchmark',
    });
    isolatedRegistry.observeHistogram('blackbox_request_duration_seconds', 0.015, {
      environment: 'production',
      operation: 'simulate',
    });

    // High-cardinality labels must throw and be strictly rejected
    let highCardinalityBlocked = false;
    try {
      isolatedRegistry.incrementCounter('blackbox_simulation_runs_total', {
        environment: 'production',
        run_id: 'sim-run-12345678', // PROHIBITED!
      });
    } catch (err: unknown) {
      highCardinalityBlocked = (err as Error).message.includes('High-cardinality label violation');
    }
    assert.strictEqual(
      highCardinalityBlocked,
      true,
      'Registry must reject prohibited high-cardinality label keys (e.g. run_id)',
    );

    let tenantIdBlocked = false;
    try {
      isolatedRegistry.setGauge('blackbox_calibration_loss_mape', 0.05, {
        tenant_id: 'tnt_abc_123', // PROHIBITED!
      });
    } catch (err: unknown) {
      tenantIdBlocked = (err as Error).message.includes('High-cardinality label violation');
    }
    assert.strictEqual(
      tenantIdBlocked,
      true,
      'Registry must reject prohibited tenant_id in Prometheus metrics',
    );

    console.log('✓ Strict low-cardinality policy actively enforced (high-cardinality labels rejected)\n');

    // -------------------------------------------------------------------------
    // [2/7] Prometheus Exposition Format via Fastify /metrics
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing Fastify /metrics endpoint exposition format...');
    // Seed default registry so the HTTP endpoint serves populated text
    defaultMetricsRegistry.incrementCounter('blackbox_simulation_runs_total', {
      environment: 'production',
      status: 'completed',
    }, 5);
    defaultMetricsRegistry.setGauge('blackbox_calibration_loss_mape', 0.038, {
      environment: 'production',
    });
    defaultMetricsRegistry.setGauge('blackbox_worker_pool_active', 4, {
      worker_type: 'load-generator',
    });
    defaultMetricsRegistry.observeHistogram('blackbox_request_duration_seconds', 0.022, {
      environment: 'production',
      operation: 'compare',
    });

    const metricsRes = await fetch(`${targetHost}/metrics`);
    assert.strictEqual(metricsRes.status, 200, '/metrics must return 200 OK');
    const contentType = metricsRes.headers.get('content-type') || '';
    assert.ok(
      contentType.includes('text/plain'),
      'Content-Type must be text/plain for Prometheus',
    );

    const metricsText = await metricsRes.text();
    assert.ok(metricsText.includes('# HELP blackbox_simulation_runs_total'));
    assert.ok(metricsText.includes('# TYPE blackbox_simulation_runs_total counter'));
    assert.ok(metricsText.includes('blackbox_simulation_runs_total{environment="production",status="completed"} 5'));
    assert.ok(metricsText.includes('blackbox_calibration_loss_mape{environment="production"} 0.038'));
    assert.ok(metricsText.includes('blackbox_worker_pool_active{worker_type="load-generator"} 4'));
    assert.ok(metricsText.includes('blackbox_request_duration_seconds_bucket'));
    assert.ok(metricsText.includes('blackbox_request_duration_seconds_sum'));
    assert.ok(metricsText.includes('blackbox_request_duration_seconds_count'));
    console.log('✓ /metrics exposes valid Prometheus text format adhering to OpenMetrics standard\n');

    // -------------------------------------------------------------------------
    // [3/7] Provision Test Campaign & Runs in MySQL 8.4
    // -------------------------------------------------------------------------
    console.log('[3/7] Seeding test campaign, runs, and baseline data in real MySQL 8.4...');
    const [tenant] = await db.select().from(tenants).limit(1);
    assert.ok(tenant, 'Default tenant must exist');

    const projectId = `prj_m11_${Date.now()}`;
    await db.insert(projects).values({
      id: projectId,
      tenantId: tenant.id,
      name: 'M11 Analytics Project',
      slug: `m11-proj-${Date.now()}`,
      description: 'Analytics test project',
    });

    const campaignId = `cmp_${Date.now()}`;
    await db.insert(experimentCampaigns).values({
      id: campaignId,
      tenantId: tenant.id,
      projectId,
      name: 'Capacity Sensitivity Campaign',
      campaignType: 'CAPACITY_SWEEP',
      status: 'COMPLETED',
      config: { targetRpsRange: [100, 1000], step: 100 },
    });

    // Add 3 campaign runs
    for (let i = 1; i <= 3; i++) {
      await db.insert(campaignRuns).values({
        id: `crun_${campaignId}_${i}`,
        campaignId,
        runId: `run-${campaignId}-${i}`,
        runIndex: i,
        parameters: { targetRps: i * 200, workers: 2 },
        status: 'COMPLETED',
      });
    }
    console.log(`✓ Test campaign '${campaignId}' seeded with 3 completed runs in MySQL 8.4\n`);

    // -------------------------------------------------------------------------
    // [4/7] Campaign Structured Report & Immutable Artifact Generation
    // -------------------------------------------------------------------------
    console.log('[4/7] Requesting campaign report with immutable artifact generation...');
    const reportRes = await fetch(
      `${targetHost}/api/v1/campaigns/${campaignId}/report?generateArtifact=true`,
      {
        headers: {
          'x-tenant-id': tenant.id,
        },
      },
    );
    assert.strictEqual(reportRes.status, 200, 'Report endpoint must return 200 OK');
    const report = (await reportRes.json()) as {
      campaignId: string;
      tenantId: string;
      summary: { totalRuns: number; completedRuns: number; verdict: string };
      runs: Array<{ runIndex: number; status: string }>;
      artifactId?: string;
      artifactKey?: string;
      sha256Checksum?: string;
    };

    assert.strictEqual(report.campaignId, campaignId);
    assert.strictEqual(report.tenantId, tenant.id);
    assert.strictEqual(report.summary.totalRuns, 3);
    assert.strictEqual(report.summary.completedRuns, 3);
    assert.strictEqual(report.runs.length, 3);
    assert.ok(report.artifactId, 'Must return generated artifactId');
    assert.ok(report.artifactKey, 'Must return objectKey in MinIO');
    assert.ok(report.sha256Checksum, 'Must return SHA-256 checksum');

    console.log(`      Campaign Report: ${report.campaignId}`);
    console.log(`      Total Runs:      ${report.summary.totalRuns}`);
    console.log(`      Artifact Key:    ${report.artifactKey}`);
    console.log(`      SHA-256:         ${report.sha256Checksum}`);
    console.log('✓ Campaign structured report generated and uploaded as immutable artifact\n');

    // -------------------------------------------------------------------------
    // [5/7] High-Resolution Time-Series Latency & Throughput Querying
    // -------------------------------------------------------------------------
    console.log('[5/7] Querying high-resolution time-series percentiles and throughput...');
    const tsRes = await fetch(
      `${targetHost}/api/v1/analytics/time-series?campaignId=${campaignId}&interval=1s`,
      {
        headers: {
          'x-tenant-id': tenant.id,
        },
      },
    );
    assert.strictEqual(tsRes.status, 200, 'Time-series endpoint must return 200 OK');
    const timeSeries = (await tsRes.json()) as {
      count: number;
      dataPoints: Array<{
        timestamp: string;
        virtualTimeUs: number;
        throughputRps: number;
        p50Us: number;
        p90Us: number;
        p95Us: number;
        p99Us: number;
        errorRate: number;
      }>;
    };

    assert.ok(timeSeries.count > 0, 'Must return time-series points');
    assert.ok(timeSeries.dataPoints.length > 0);
    const p0 = timeSeries.dataPoints[0]!;
    assert.ok(p0.p50Us <= p0.p90Us, 'p50 <= p90 in time series');
    assert.ok(p0.p90Us <= p0.p95Us, 'p90 <= p95 in time series');
    assert.ok(p0.p95Us <= p0.p99Us, 'p95 <= p99 in time series');
    assert.ok(p0.throughputRps > 0, 'Throughput must be positive');
    console.log(`      Retrieved ${timeSeries.count} time-series points (p50: ${p0.p50Us}us, p99: ${p0.p99Us}us, RPS: ${p0.throughputRps})`);
    console.log('✓ High-resolution time-series analytics verified\n');

    // -------------------------------------------------------------------------
    // [6/7] Comparison Visualizer (Normalized CDF Curves & Wasserstein Breakdown)
    // -------------------------------------------------------------------------
    console.log('[6/7] Querying comparison visualizer CDF curves and Wasserstein metrics...');
    const compVisRes = await fetch(`${targetHost}/api/v1/comparison/visualizer/cmp-demo-vis-001`);
    assert.strictEqual(compVisRes.status, 200, 'Visualizer endpoint must return 200 OK');
    const visData = (await compVisRes.json()) as {
      comparisonId: string;
      verdict: string;
      mape: number;
      wassersteinDistance: number;
      cdfCurves: {
        quantiles: number[];
        simulatedLatenciesUs: number[];
        realLatenciesUs: number[];
      };
      quantileErrors: Record<string, number>;
    };

    assert.ok(visData.cdfCurves.quantiles.length >= 9, 'Must have at least 9 quantiles');
    assert.strictEqual(visData.cdfCurves.simulatedLatenciesUs.length, visData.cdfCurves.quantiles.length);
    assert.strictEqual(visData.cdfCurves.realLatenciesUs.length, visData.cdfCurves.quantiles.length);
    assert.ok(visData.wassersteinDistance > 0, 'Wasserstein distance must be positive');
    assert.ok(visData.quantileErrors.p50 >= 0, 'p50 error must be non-negative');
    assert.ok(visData.quantileErrors.p99 >= 0, 'p99 error must be non-negative');
    console.log(`      Visualizer Verdict:    ${visData.verdict}`);
    console.log(`      Wasserstein Distance:  ${visData.wassersteinDistance}`);
    console.log(`      Evaluated Quantiles:   ${visData.cdfCurves.quantiles.join(', ')}`);
    console.log('✓ Comparison visualizer CDF curves and Wasserstein metric verified\n');

    // -------------------------------------------------------------------------
    // [7/7] Immutability Proof & Architecture Boundary Validation
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying bit-for-bit report artifact immutability & architecture boundaries...');
    if (report.artifactKey) {
      // Download artifact from real MinIO storage
      const downloadedBuffer = await storageService.downloadArtifact(report.artifactKey);
      const actualHash = createHash('sha256').update(downloadedBuffer).digest('hex');
      assert.strictEqual(
        actualHash,
        report.sha256Checksum,
        'Downloaded artifact SHA-256 must match exactly (100% cryptographic immutability)',
      );

      // Verify row exists in MySQL stored_artifacts
      const [artifactRow] = await db
        .select()
        .from(storedArtifacts)
        .where(eq(storedArtifacts.objectKey, report.artifactKey));
      assert.ok(artifactRow, 'Report artifact must be recorded in stored_artifacts');
      assert.strictEqual(artifactRow.tenantId, tenant.id);
      console.log(`      Cryptographic Integrity Validated: ${actualHash.slice(0, 16)}...`);
    }

    // Architecture Boundary Validation
    try {
      execSync('npx depcruise --config .dependency-cruiser.cjs packages apps', {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
      console.log('✓ Architecture boundary rules strictly validated (0 violations)\n');
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      console.error('Dependency cruiser stdout:', e.stdout?.toString());
      console.error('Dependency cruiser stderr:', e.stderr?.toString());
      throw new Error('Architectural boundary violation detected in analytics / observability');
    }

    console.log('========================================================================');
    console.log('   BLACKBOX-X M11 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!            ');
    console.log('========================================================================');
  } finally {
    await app.close();
    await pool.end();
  }
}

runM11Gate().catch((err) => {
  console.error('\n❌ M11 GATE VERIFICATION FAILED:', err);
  process.exit(1);
});
