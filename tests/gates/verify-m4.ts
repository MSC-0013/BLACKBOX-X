import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations, benchmarks, benchmarkComparisons, db } from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import { buildServer } from '../../apps/blackbox-api/src/server.js';
import {
  executeBenchmark,
  computeTwoSampleKsTest,
  computeQuantileRelativeErrors,
  computeWassersteinDistance,
  ComparisonEngine,
} from '@blackbox-x/comparison';

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

async function runM4Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M4 GATE: Real Benchmark Driver & Comparison Engine  ');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 004_benchmarks
  console.log('Ensuring all migrations up through 004_benchmarks are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  // Start real API server
  console.log('Starting real Fastify API server for live benchmarking...');
  const app = buildServer();
  await app.listen({ port: 3001, host: '127.0.0.1' });
  const targetUrl = 'http://127.0.0.1:3001/health/live';
  console.log(`✓ Real API server listening on ${targetUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // [1/7] Real Benchmark Execution Against Real HTTP Server
    // -------------------------------------------------------------------------
    console.log('[1/7] Executing real benchmark against live server (N=500 requests, concurrency=10)...');
    const realResult = await executeBenchmark({
      targetUrl,
      totalRequests: 500,
      concurrency: 10,
    });

    console.log(`      Total: ${realResult.totalRequests}, Successes: ${realResult.successfulRequests}, Failures: ${realResult.failedRequests}`);
    console.log(`      p50: ${realResult.p50Us}us, p90: ${realResult.p90Us}us, p99: ${realResult.p99Us}us, Mean: ${realResult.meanLatencyUs}us`);
    console.log(`      Throughput: ${realResult.throughputRps.toFixed(2)} RPS`);

    assert.strictEqual(realResult.successfulRequests, 500);
    assert.strictEqual(realResult.failedRequests, 0);
    assert(realResult.samplesUs.length === 500, 'Expected 500 latency samples');
    console.log('✓ Real benchmark executed with 100% success and microsecond sample collection\n');

    // -------------------------------------------------------------------------
    // [2/7] Two-Sample Kolmogorov-Smirnov Test Verification
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing Two-Sample Kolmogorov-Smirnov goodness-of-fit test...');
    const selfKs = computeTwoSampleKsTest(realResult.samplesUs, realResult.samplesUs);
    assert.strictEqual(selfKs.statistic, 0, 'Self KS test must have D=0');
    assert.strictEqual(selfKs.rejectNull, false, 'Self KS test must not reject null');

    const shiftedDistribution = realResult.samplesUs.map((x) => x + 50_000); // 50ms shift
    const shiftedKs = computeTwoSampleKsTest(realResult.samplesUs, shiftedDistribution);
    assert(shiftedKs.statistic > 0.5, `Shifted distribution must have large KS statistic (got ${shiftedKs.statistic})`);
    assert.strictEqual(shiftedKs.rejectNull, true, 'Shifted distribution must reject null hypothesis');
    console.log('✓ KS test accurately validates identical vs shifted empirical distributions\n');

    // -------------------------------------------------------------------------
    // [3/7] Quantile Relative Error and MAPE Evaluation
    // -------------------------------------------------------------------------
    console.log('[3/7] Testing quantile relative error and MAPE evaluation...');
    const simulatedQuantiles = {
      p50: realResult.p50Us * 1.05,
      p90: realResult.p90Us * 1.08,
      p95: realResult.p95Us * 1.04,
      p99: realResult.p99Us * 1.06,
    };
    const { errors, mape } = computeQuantileRelativeErrors(simulatedQuantiles, {
      p50: realResult.p50Us,
      p90: realResult.p90Us,
      p95: realResult.p95Us,
      p99: realResult.p99Us,
    });
    console.log(`      Quantile Errors: p50: ${(errors.p50 * 100).toFixed(2)}%, p90: ${(errors.p90 * 100).toFixed(2)}%, MAPE: ${(mape * 100).toFixed(2)}%`);
    assert(mape < 0.10, `Expected MAPE < 10%, got ${(mape * 100).toFixed(2)}%`);
    console.log('✓ Quantile relative errors and MAPE computed accurately\n');

    // -------------------------------------------------------------------------
    // [4/7] 1D Wasserstein Earth Mover's Distance
    // -------------------------------------------------------------------------
    console.log('[4/7] Testing 1D Wasserstein (Earth Mover\'s) Distance...');
    const wassersteinDist = computeWassersteinDistance(realResult.samplesUs, shiftedDistribution);
    console.log(`      Wasserstein Distance for 50ms shifted distribution: ${wassersteinDist.toFixed(2)}us`);
    assert(
      Math.abs(wassersteinDist - 50_000) < 500,
      `Expected Wasserstein distance ~50,000us, got ${wassersteinDist}us`,
    );
    console.log('✓ Wasserstein distance matches expected distribution shift\n');

    // -------------------------------------------------------------------------
    // [5/7] Prediction Interval Coverage Validation & Verdict Synthesis
    // -------------------------------------------------------------------------
    console.log('[5/7] Testing prediction interval coverage and comparison verdicts...');
    const comparator = new ComparisonEngine();

    // Test ALIGNED scenario
    const alignedReport = comparator.compare({
      simulated: {
        p50Us: realResult.p50Us,
        p90Us: realResult.p90Us,
        p95Us: realResult.p95Us,
        p99Us: realResult.p99Us,
        meanLatencyUs: realResult.meanLatencyUs,
        throughputRps: realResult.throughputRps,
        predictionInterval: [realResult.p50Us * 0.8, realResult.p50Us * 1.2],
        samplesUs: realResult.samplesUs,
      },
      real: {
        p50Us: realResult.p50Us,
        p90Us: realResult.p90Us,
        p95Us: realResult.p95Us,
        p99Us: realResult.p99Us,
        meanLatencyUs: realResult.meanLatencyUs,
        throughputRps: realResult.throughputRps,
        samplesUs: realResult.samplesUs,
      },
    });
    assert.strictEqual(alignedReport.verdict, 'ALIGNED');
    assert.strictEqual(alignedReport.predictionIntervalEnclosed, true);

    // Test MISALIGNED scenario where real p50 breaches prediction interval
    const misalignedReport = comparator.compare({
      simulated: {
        p50Us: 1000,
        p90Us: 2000,
        p95Us: 2500,
        p99Us: 3000,
        meanLatencyUs: 1200,
        throughputRps: 500,
        predictionInterval: [800, 1200], // Real p50 is much larger
      },
      real: {
        p50Us: realResult.p50Us,
        p90Us: realResult.p90Us,
        p95Us: realResult.p95Us,
        p99Us: realResult.p99Us,
        meanLatencyUs: realResult.meanLatencyUs,
        throughputRps: realResult.throughputRps,
      },
    });
    assert.strictEqual(misalignedReport.verdict, 'MISALIGNED');
    assert.strictEqual(misalignedReport.predictionIntervalEnclosed, false);
    console.log('✓ Prediction interval coverage and verdict synthesis verified (ALIGNED & MISALIGNED)\n');

    // -------------------------------------------------------------------------
    // [6/7] Database Persistence of Benchmarks & Comparison Reports in Real MySQL
    // -------------------------------------------------------------------------
    console.log('[6/7] Persisting benchmark results and comparison report in real MySQL 8.4...');
    const tenantId = `tnt_m4_${Date.now()}`;
    const projectId = `proj_m4_${Date.now()}`;
    const benchmarkId = `bmk_${Date.now()}`;
    const comparisonId = `cmp_${Date.now()}`;

    // Seed tenant and project
    await pool.query('INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)', [
      tenantId,
      `slug-${tenantId}`,
      'M4 Verification Tenant',
    ]);
    await pool.query('INSERT INTO projects (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)', [
      projectId,
      tenantId,
      'M4 Benchmark Project',
      `slug-${projectId}`,
    ]);

    // Insert benchmark
    await db.insert(benchmarks).values({
      id: benchmarkId,
      tenantId,
      projectId,
      driver: 'HTTP_NATIVE',
      targetUrl,
      status: 'COMPLETED',
      throughputRps: realResult.throughputRps,
      p50Us: realResult.p50Us,
      p90Us: realResult.p90Us,
      p95Us: realResult.p95Us,
      p99Us: realResult.p99Us,
      metricsSummary: {
        totalRequests: realResult.totalRequests,
        successfulRequests: realResult.successfulRequests,
        meanLatencyUs: realResult.meanLatencyUs,
      },
    });

    // Insert comparison
    await db.insert(benchmarkComparisons).values({
      id: comparisonId,
      benchmarkId,
      simulationRunId: `sim_run_${Date.now()}`,
      verdict: alignedReport.verdict,
      ksStatistic: alignedReport.ksTest?.statistic ?? 0,
      mape: alignedReport.mape,
      p50Error: alignedReport.quantileErrors.p50,
      p99Error: alignedReport.quantileErrors.p99,
      predictionIntervalEnclosed: alignedReport.predictionIntervalEnclosed,
      reportData: alignedReport,
    });

    // Query back and verify
    const fetchedBenchmark = await db.query.benchmarks.findFirst({
      where: eq(benchmarks.id, benchmarkId),
    });
    assert(fetchedBenchmark, 'Benchmark should exist in database');
    assert.strictEqual(fetchedBenchmark.status, 'COMPLETED');
    assert.strictEqual(fetchedBenchmark.p50Us, realResult.p50Us);

    const fetchedComparison = await db.query.benchmarkComparisons.findFirst({
      where: eq(benchmarkComparisons.id, comparisonId),
    });
    assert(fetchedComparison, 'Benchmark comparison report should exist in database');
    assert.strictEqual(fetchedComparison.verdict, 'ALIGNED');
    assert.strictEqual(fetchedComparison.predictionIntervalEnclosed, true);

    console.log('✓ Benchmark and comparison report persisted and queried from MySQL 8.4\n');

    // -------------------------------------------------------------------------
    // [7/7] Dependency Cruiser Architecture Verification
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying architectural purity of @blackbox-x/comparison...');
    const compPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'packages', 'comparison', 'package.json'), 'utf8'),
    );
    const allowed = [
      '@blackbox-x/contracts',
      '@blackbox-x/statistics',
      '@blackbox-x/workload-spec',
      '@blackbox-x/simulation-engine',
    ];
    for (const dep of Object.keys(compPkg.dependencies || {})) {
      assert(allowed.includes(dep), `Unauthorized dependency in @blackbox-x/comparison: ${dep}`);
    }
    console.log('✓ Architecture boundary rules strictly validated\n');

    console.log('===============================================================');
    console.log('   BLACKBOX-X M4 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
    console.log('===============================================================');
  } finally {
    await app.close();
  }
}

runM4Gate()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ M4 GATE FAILURE:', err);
    await pool.end();
    process.exit(1);
  });
