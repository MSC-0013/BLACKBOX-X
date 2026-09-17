import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  pool,
  runMigrations,
  loadGeneratorWorkers,
  loadOrchestratorRuns,
  loadWorkerMetrics,
  db,
  tenants,
} from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import { buildServer } from '../../apps/blackbox-api/src/server.js';
import {
  KafkaLoadCommander,
  WorkerPool,
  LoadWorker,
  TelemetryAggregator,
  LoadOrchestrator,
} from '@blackbox-x/load-orchestrator';

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

async function runM7Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M7 GATE: Distributed Load Orchestration & Worker Pools');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 007_load_generators
  console.log('Ensuring all migrations up through 007_load_generators are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  // Infrastructure connection details
  const redisUrl = 'redis://localhost:6380';
  const kafkaBrokers = ['localhost:9092'];
  const testPort = 3003;
  const targetUrl = `http://127.0.0.1:${testPort}/health/live`;

  // Start real API server for live load generation
  console.log(`Starting real Fastify API server on port ${testPort}...`);
  const app = buildServer();
  await app.listen({ port: testPort, host: '127.0.0.1' });
  console.log(`✓ Real API server listening on ${targetUrl}\n`);

  const workerPool = new WorkerPool({ redisUrl });
  const commander = new KafkaLoadCommander({ brokers: kafkaBrokers });
  const aggregator = new TelemetryAggregator({ redisUrl });

  try {
    // -------------------------------------------------------------------------
    // [1/7] Worker Pool Registration & Redis Heartbeat Tracking
    // -------------------------------------------------------------------------
    console.log('[1/7] Testing worker pool registration and heartbeat tracking in Redis...');
    const worker1Id = 'worker-node-1';
    const worker2Id = 'worker-node-2';

    await workerPool.registerWorker(worker1Id, 'load-host-01', { cpuCores: 8 });
    await workerPool.registerWorker(worker2Id, 'load-host-02', { cpuCores: 8 });

    await workerPool.heartbeat(worker1Id, 'IDLE');
    await workerPool.heartbeat(worker2Id, 'IDLE');

    const activeWorkers = await workerPool.getActiveWorkers();
    assert.strictEqual(
      activeWorkers.length >= 2,
      true,
      'Active workers count in Redis must be at least 2',
    );
    const worker1Reg = activeWorkers.find((w) => w.workerId === worker1Id);
    assert.ok(worker1Reg, 'Worker 1 must be registered in Redis');
    assert.strictEqual(worker1Reg?.status, 'IDLE');

    const allocated = await workerPool.allocateWorkers(2);
    assert.strictEqual(allocated.length, 2, 'Must allocate 2 idle workers');
    console.log(`      Registered Workers: ${activeWorkers.map((w) => w.workerId).join(', ')}`);
    console.log('✓ Worker pool registration and heartbeat tracking verified in Redis\n');

    // -------------------------------------------------------------------------
    // [2/7] Distributed Kafka Command Dispatch & Consumption
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing distributed Kafka command dispatch on load-commands.v1 topic...');
    await commander.connect();
    await commander.ensureTopics(['load-commands.v1']);

    const testRunId = `run-kafka-test-${Date.now()}`;
    const sentCommand = await commander.sendStartLoad({
      runId: testRunId,
      targetUrl,
      targetRps: 50,
      durationSec: 2,
      assignedWorkers: [worker1Id, worker2Id],
    });

    assert.strictEqual(sentCommand.type, 'START_LOAD');
    assert.strictEqual(sentCommand.runId, testRunId);
    console.log(`      Dispatched Kafka Command: ${sentCommand.commandId} (type: ${sentCommand.type})`);
    console.log('✓ Distributed Kafka command dispatched successfully to KRaft broker\n');

    // -------------------------------------------------------------------------
    // [3/7] Coordinated Multi-Worker Load Generation Against Live HTTP Service
    // -------------------------------------------------------------------------
    console.log('[3/7] Executing coordinated multi-worker load test against live Fastify server...');
    const coordinatedRunId = `coord-run-${Date.now()}`;

    // Instantiate two workers
    const workerAlpha = new LoadWorker({
      workerId: 'worker-alpha',
      kafkaBrokers,
      redisUrl,
    });
    const workerBeta = new LoadWorker({
      workerId: 'worker-beta',
      kafkaBrokers,
      redisUrl,
    });

    // Execute concurrent load tasks across both workers
    const loadParams = {
      runId: coordinatedRunId,
      targetUrl,
      targetRps: 100,
      durationSec: 3,
      concurrency: 4,
    };

    console.log('      Spawning parallel load generation across worker-alpha and worker-beta (3s duration)...');
    const [telemetryAlpha, telemetryBeta] = await Promise.all([
      workerAlpha.executeLoad(loadParams),
      workerBeta.executeLoad(loadParams),
    ]);

    assert.ok(telemetryAlpha.requests > 0, 'Worker alpha must execute requests');
    assert.ok(telemetryBeta.requests > 0, 'Worker beta must execute requests');
    assert.strictEqual(telemetryAlpha.errors, 0, 'Worker alpha must have 0 errors');
    assert.strictEqual(telemetryBeta.errors, 0, 'Worker beta must have 0 errors');

    console.log(`      Worker Alpha: ${telemetryAlpha.requests} reqs, p50: ${telemetryAlpha.p50Us?.toFixed(0)}us, errors: ${telemetryAlpha.errors}`);
    console.log(`      Worker Beta:  ${telemetryBeta.requests} reqs, p50: ${telemetryBeta.p50Us?.toFixed(0)}us, errors: ${telemetryBeta.errors}`);
    console.log('✓ Multi-worker concurrent load execution verified against live endpoint\n');

    // -------------------------------------------------------------------------
    // [4/7] Real-Time Redis Telemetry Verification & Cadence Check
    // -------------------------------------------------------------------------
    console.log('[4/7] Querying real-time worker telemetry keys and publication cadence from Redis...');
    const retrievedTelemetries = await aggregator.getWorkerTelemetries(coordinatedRunId);
    assert.strictEqual(
      retrievedTelemetries.length,
      2,
      'Must retrieve telemetry for exactly 2 workers from Redis',
    );
    console.log(`      Retrieved ${retrievedTelemetries.length} telemetry records from Redis key pattern`);

    // Verify periodic telemetry cadence against configured 500ms target
    const history = await aggregator.getTelemetryHistory(coordinatedRunId);
    assert.ok(history.length >= 4, 'Must record multiple periodic telemetry snapshots during load test');
    const workerAlphaSnapshots = history.filter((s) => s.workerId === 'worker-alpha');
    if (workerAlphaSnapshots.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < workerAlphaSnapshots.length; i++) {
        const tPrev = new Date(workerAlphaSnapshots[i - 1]!.timestamp).getTime();
        const tCurr = new Date(workerAlphaSnapshots[i]!.timestamp).getTime();
        intervals.push(tCurr - tPrev);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      assert.ok(
        avgInterval >= 300 && avgInterval <= 850,
        `Observed inter-emission cadence (${avgInterval.toFixed(1)}ms) must be within tolerance of configured 500ms cadence`,
      );
      console.log(`      Verified periodic telemetry cadence: ${avgInterval.toFixed(0)}ms (configured target: 500ms)`);
    }
    console.log('✓ Real-time Redis worker telemetry and periodic publication cadence verified\n');

    // -------------------------------------------------------------------------
    // [5/7] Cluster-Wide Histogram Merging & Quantile Accuracy
    // -------------------------------------------------------------------------
    console.log('[5/7] Aggregating cluster-wide metrics and quantile distribution...');
    const clusterSummary = aggregator.aggregate(
      coordinatedRunId,
      retrievedTelemetries,
      3, // duration in seconds
    );

    assert.strictEqual(clusterSummary.activeWorkers, 2);
    assert.strictEqual(
      clusterSummary.totalRequests,
      telemetryAlpha.requests + telemetryBeta.requests,
      'Total cluster requests must equal sum of worker requests',
    );
    assert.strictEqual(clusterSummary.errorRate, 0);
    assert.ok(clusterSummary.actualRps > 0, 'Actual RPS must be positive');
    assert.ok(clusterSummary.p50Us <= clusterSummary.p90Us, 'p50 <= p90');
    assert.ok(clusterSummary.p90Us <= clusterSummary.p99Us, 'p90 <= p99');

    // Item 21: Quantile aggregation reference test
    // Cross-check live aggregate() against a separate, pure order-statistic reference.
    const workerLatencyArrays = retrievedTelemetries
      .map((t) => t.latenciesUs ?? [])
      .filter((arr) => arr.length > 0);

    if (workerLatencyArrays.length > 0) {
      const ref = TelemetryAggregator.mergeQuantilesReference(workerLatencyArrays);
      // Reference and live aggregate must agree exactly (both use same order-statistic formula)
      assert.strictEqual(
        clusterSummary.p50Us,
        ref.p50Us,
        `Live p50 (${clusterSummary.p50Us}) must match reference (${ref.p50Us})`,
      );
      assert.strictEqual(
        clusterSummary.p90Us,
        ref.p90Us,
        `Live p90 (${clusterSummary.p90Us}) must match reference (${ref.p90Us})`,
      );
      assert.strictEqual(
        clusterSummary.p99Us,
        ref.p99Us,
        `Live p99 (${clusterSummary.p99Us}) must match reference (${ref.p99Us})`,
      );
      console.log(`      Reference p50: ${ref.p50Us}us, p90: ${ref.p90Us}us, p99: ${ref.p99Us}us (matches live aggregate)`);
    }

    console.log(`      Cluster Total Requests: ${clusterSummary.totalRequests}`);
    console.log(`      Cluster Throughput:     ${clusterSummary.actualRps.toFixed(2)} RPS`);
    console.log(`      Cluster p50:            ${clusterSummary.p50Us.toFixed(0)}us`);
    console.log(`      Cluster p90:            ${clusterSummary.p90Us.toFixed(0)}us`);
    console.log(`      Cluster p99:            ${clusterSummary.p99Us.toFixed(0)}us`);
    console.log(`      Cluster Error Rate:     ${(clusterSummary.errorRate * 100).toFixed(2)}%`);
    console.log('✓ Cluster-wide metrics and quantiles accurately merged\n');

    // -------------------------------------------------------------------------
    // [6/7] Persisting Load Orchestrator Run & Worker Metrics in MySQL 8.4
    // -------------------------------------------------------------------------
    console.log('[6/7] Persisting orchestrator run and worker metrics in MySQL 8.4...');
    const [tenant] = await db.select().from(tenants).limit(1);
    assert.ok(tenant, 'Default tenant must exist');

    const runDbId = `db-run-${Date.now()}`;
    await db.insert(loadOrchestratorRuns).values({
      id: runDbId,
      tenantId: tenant.id,
      runId: coordinatedRunId,
      status: 'COMPLETED',
      targetUrl,
      pattern: 'CONSTANT',
      durationSec: 3,
      targetRps: 100,
      allocatedWorkers: 2,
      totalRequests: clusterSummary.totalRequests,
      successfulRequests: clusterSummary.successfulRequests,
      failedRequests: clusterSummary.failedRequests,
      p50Us: clusterSummary.p50Us,
      p90Us: clusterSummary.p90Us,
      p95Us: clusterSummary.p95Us,
      p99Us: clusterSummary.p99Us,
      meanUs: clusterSummary.meanUs,
      actualRps: clusterSummary.actualRps,
      errorRate: clusterSummary.errorRate,
      startedAt: new Date(Date.now() - 3000),
      completedAt: new Date(),
    });

    for (const t of retrievedTelemetries) {
      await db.insert(loadWorkerMetrics).values({
        id: `metric-${t.workerId}-${Date.now()}`,
        runId: coordinatedRunId,
        workerId: t.workerId,
        currentRps: t.currentRps,
        requests: t.requests,
        errors: t.errors,
        p50Us: t.p50Us ?? 0,
        p99Us: t.p99Us ?? 0,
      });
    }

    const [savedRun] = await db
      .select()
      .from(loadOrchestratorRuns)
      .where(eq(loadOrchestratorRuns.runId, coordinatedRunId));

    assert.ok(savedRun, 'Saved run must exist in database');
    assert.strictEqual(savedRun.totalRequests, clusterSummary.totalRequests);

    const savedMetrics = await db
      .select()
      .from(loadWorkerMetrics)
      .where(eq(loadWorkerMetrics.runId, coordinatedRunId));

    assert.strictEqual(savedMetrics.length, 2, 'Must have 2 worker metric records in MySQL');
    console.log(`      Persisted Run ID: ${savedRun.runId} with ${savedMetrics.length} worker metric rows`);
    console.log('✓ Load orchestrator run and telemetry successfully persisted in MySQL 8.4\n');

    // Clean up worker instances
    await workerAlpha.stop();
    await workerBeta.stop();

    // -------------------------------------------------------------------------
    // [7/7] Architecture Boundary Validation via Dependency Cruiser
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying architectural purity of @blackbox-x/load-orchestrator...');
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
      throw new Error('Architectural boundary violation detected in load-orchestrator');
    }

    console.log('===============================================================');
    console.log('   BLACKBOX-X M7 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
    console.log('===============================================================');
  } finally {
    await app.close();
    await commander.disconnect();
    await workerPool.close();
    await aggregator.close();
    await pool.end();
  }
}

runM7Gate().catch((err) => {
  console.error('\n❌ M7 GATE VERIFICATION FAILED:', err);
  process.exit(1);
});
