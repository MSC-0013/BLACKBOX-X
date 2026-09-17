import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SimulationKernel,
  SimulationRunner,
  SimulationRunConfig,
  CpuResource,
  ThreadPoolResource,
  ConnectionPoolResource,
} from '@blackbox-x/simulation-engine';

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

async function runM3Gate() {
  console.log('===============================================================');
  console.log('   BLACKBOX-X M3 GATE: Discrete-Event Simulation Engine        ');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // ---------------------------------------------------------------------------
  // [1/7] Virtual Clock Monotonicity & Deterministic Priority Tie-Breaking
  // ---------------------------------------------------------------------------
  console.log('[1/7] Testing virtual clock monotonicity and deterministic tie-breaking...');
  const kernel = new SimulationKernel();
  const executionOrder: string[] = [];

  kernel.schedule(100, 'EVENT', { name: 'E1_P0' }, 0);
  kernel.schedule(50, 'EVENT', { name: 'E2_P0' }, 0);
  kernel.schedule(100, 'EVENT', { name: 'E3_HIGHER_PRIO' }, -1); // higher priority
  kernel.schedule(100, 'EVENT', { name: 'E4_P0_LATER_SEQ' }, 0);

  let prevTime = 0;
  kernel.registerHandler('EVENT', (event, k) => {
    assert(k.virtualTimeUs >= prevTime, `Time monotonicity violated: ${k.virtualTimeUs} < ${prevTime}`);
    prevTime = k.virtualTimeUs;
    const payload = event.payload as { name: string };
    executionOrder.push(payload.name);
  });

  while (kernel.step()) {
    // draining queue
  }

  assert.deepStrictEqual(executionOrder, ['E2_P0', 'E3_HIGHER_PRIO', 'E1_P0', 'E4_P0_LATER_SEQ']);
  console.log('✓ Virtual clock maintained strict monotonicity with microsecond resolution tie-breaking\n');

  // ---------------------------------------------------------------------------
  // [2/7] Resource Contention Models (CPU, ThreadPool, ConnectionPool)
  // ---------------------------------------------------------------------------
  console.log('[2/7] Testing resource contention models under varying load...');
  // CPU Processor Sharing
  const cpu = new CpuResource({ cores: 4 });
  assert.strictEqual(cpu.calculateExecutionDurationUs(5000), 5000); // 0 tasks -> 1.0x
  for (let i = 0; i < 4; i++) cpu.acquire();
  assert.strictEqual(cpu.calculateExecutionDurationUs(5000), 5000); // 4 tasks on 4 cores -> 1.0x
  for (let i = 0; i < 4; i++) cpu.acquire(); // now 8 tasks on 4 cores
  assert.strictEqual(cpu.calculateExecutionDurationUs(5000), 10000); // stretch 8/4 = 2.0x -> 10,000us

  // ThreadPool Admission & Queue Bounding
  const tp = new ThreadPoolResource({ workerCount: 2, queueCapacity: 3 });
  assert.strictEqual(tp.tryAcquire(), 'IMMEDIATE');
  assert.strictEqual(tp.tryAcquire(), 'IMMEDIATE');
  assert.strictEqual(tp.tryAcquire(), 'QUEUED');
  assert.strictEqual(tp.tryAcquire(), 'QUEUED');
  assert.strictEqual(tp.tryAcquire(), 'QUEUED');
  assert.strictEqual(tp.tryAcquire(), 'REJECTED'); // Queue full -> sheds load
  assert.strictEqual(tp.rejectedCount, 1);

  // ConnectionPool Slots & Waiting
  const cp = new ConnectionPoolResource({ maxConnections: 2, maxWaiters: 2 });
  assert.strictEqual(cp.tryAcquire(), 'ACQUIRED');
  assert.strictEqual(cp.tryAcquire(), 'ACQUIRED');
  assert.strictEqual(cp.tryAcquire(), 'WAITING');
  assert.strictEqual(cp.tryAcquire(), 'WAITING');
  assert.strictEqual(cp.tryAcquire(), 'EXHAUSTED');
  assert.strictEqual(cp.totalRejected, 1);
  console.log('✓ Resource contention models accurately enforce concurrency, queue bounds, and degradation\n');

  // ---------------------------------------------------------------------------
  // [3/7] Multi-Node Topology Simulation with Sync & Async Execution
  // ---------------------------------------------------------------------------
  console.log('[3/7] Executing simulation across multi-tier topology (Gateway -> DB + Kafka)...');
  const multiNodeConfig: SimulationRunConfig = {
    nodes: [
      {
        nodeId: 'gateway_service',
        nodeKind: 'SERVICE',
        cpuCores: 8,
        threadPoolSize: 20,
        threadPoolQueueCapacity: 50,
        connectionPoolSize: 20,
      },
      {
        nodeId: 'mysql_cluster',
        nodeKind: 'DATABASE',
        cpuCores: 16,
        threadPoolSize: 40,
        threadPoolQueueCapacity: 200,
        connectionPoolSize: 50,
      },
    ],
    operations: [
      {
        operationId: 'op_create_order',
        operationName: 'POST /orders',
        nodeId: 'gateway_service',
        baseLatencyUs: 1500,
        dependencies: [
          {
            targetNodeId: 'mysql_cluster',
            targetOperationName: 'INSERT INTO orders',
            executionMode: 'SEQUENTIAL',
            callOrder: 1,
          },
          {
            targetNodeId: 'gateway_service',
            targetOperationName: 'order_created_event',
            executionMode: 'ASYNC',
            callOrder: 2,
          },
        ],
      },
      {
        operationId: 'op_insert_db',
        operationName: 'INSERT INTO orders',
        nodeId: 'mysql_cluster',
        baseLatencyUs: 3500,
      },
      {
        operationId: 'op_kafka_event',
        operationName: 'order_created_event',
        nodeId: 'gateway_service',
        baseLatencyUs: 800,
      },
    ],
    workload: {
      id: 'wkld_orders_sim',
      name: 'Order Ingress Workload',
      arrivalPattern: 'POISSON',
      arrivalParams: { lambdaRps: 200 },
      requestMix: [{ operationName: 'POST /orders', weight: 1.0 }],
      totalDurationSeconds: 2,
    },
    seed: 0x1234_5678n,
  };

  const runner = new SimulationRunner(multiNodeConfig);
  const simResult = runner.run();

  console.log(`      Total Requests: ${simResult.totalRequests}`);
  console.log(`      Successes: ${simResult.successfulRequests}, Failures: ${simResult.failedRequests}`);
  console.log(`      p50: ${simResult.p50Us}us, p90: ${simResult.p90Us}us, p99: ${simResult.p99Us}us`);
  console.log(`      Canonical State Hash: ${simResult.canonicalStateHash}`);

  assert(simResult.successfulRequests > 300, 'Expected at least 300 successful requests in 2s');
  assert.strictEqual(simResult.failedRequests, 0, 'Expected zero failed requests under capacity');
  assert(simResult.p50Us >= 5000, `Latency must include ingress + db roundtrip (got ${simResult.p50Us}us)`);
  console.log('✓ Multi-tier topology executed correctly with sequential and asynchronous dependencies\n');

  // ---------------------------------------------------------------------------
  // [4/7] 100% Bit-For-Bit Determinism & Canonical State Hashing
  // ---------------------------------------------------------------------------
  console.log('[4/7] Testing 100% bit-for-bit repeatability across independent runs...');
  const run1 = new SimulationRunner(multiNodeConfig).run();
  const run2 = new SimulationRunner(multiNodeConfig).run();

  assert.strictEqual(run1.successfulRequests, run2.successfulRequests);
  assert.strictEqual(run1.p50Us, run2.p50Us);
  assert.strictEqual(run1.p99Us, run2.p99Us);
  assert.strictEqual(run1.meanLatencyUs, run2.meanLatencyUs);
  assert.strictEqual(
    run1.canonicalStateHash,
    run2.canonicalStateHash,
    'Independent runs with identical seed must have identical canonical state hash',
  );

  // Different seed produces different hash
  const differentSeedConfig: SimulationRunConfig = {
    ...multiNodeConfig,
    seed: 0xdead_beefn,
  };
  const runDiff = new SimulationRunner(differentSeedConfig).run();
  assert.notStrictEqual(run1.canonicalStateHash, runDiff.canonicalStateHash);
  console.log('✓ 100% bit-for-bit repeatability verified via matching canonical state hashes\n');

  // ---------------------------------------------------------------------------
  // [5/7] Checkpoint Snapshotting and Deterministic Resumption
  // ---------------------------------------------------------------------------
  console.log('[5/7] Testing simulation state checkpoint snapshotting and resumption...');
  const k1 = new SimulationKernel();
  let k1Counter = 0;
  k1.registerHandler('TASK', () => {
    k1Counter++;
  });

  k1.schedule(1000, 'TASK', { id: 1 });
  k1.schedule(2000, 'TASK', { id: 2 });
  k1.schedule(3000, 'TASK', { id: 3 });
  k1.schedule(4000, 'TASK', { id: 4 });

  // Run first 2 events (up to time 2000)
  k1.step();
  k1.step();
  assert.strictEqual(k1.virtualTimeUs, 2000);
  assert.strictEqual(k1Counter, 2);

  const snapshot = k1.createCheckpoint();

  // Resume in brand new kernel instance
  const k2 = new SimulationKernel();
  let k2Counter = 2;
  k2.registerHandler('TASK', () => {
    k2Counter++;
  });
  k2.resumeCheckpoint(snapshot);

  assert.strictEqual(k2.virtualTimeUs, 2000);
  assert.strictEqual(k2.canonicalHash, snapshot.canonicalHash);

  // Run remaining events
  k2.runUntil(5000);
  assert.strictEqual(k2.virtualTimeUs, 4000);
  assert.strictEqual(k2Counter, 4);
  console.log('✓ Kernel snapshot and resumption verified across independent instances\n');

  // ---------------------------------------------------------------------------
  // [6/7] Little's Law Invariant Satisfaction Across Simulation Trace
  // ---------------------------------------------------------------------------
  console.log('[6/7] Validating Little\'s Law (L ≈ λW) invariant...');
  assert.strictEqual(simResult.littlesLawCheck.satisfies, true);
  console.log(`      L_expected: ${simResult.littlesLawCheck.expectedL.toFixed(4)}, relativeError: ${simResult.littlesLawCheck.relativeError}`);
  console.log('✓ Little\'s Law satisfied within queueing tolerance\n');

  // ---------------------------------------------------------------------------
  // [7/7] Architectural Boundaries Purity
  // ---------------------------------------------------------------------------
  console.log('[7/7] Verifying dependency purity for @blackbox-x/simulation-engine...');
  const simPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'packages', 'simulation-engine', 'package.json'), 'utf8'),
  );
  const allowed = [
    '@blackbox-x/contracts',
    '@blackbox-x/domain',
    '@blackbox-x/statistics',
    '@blackbox-x/workload-spec',
  ];
  for (const dep of Object.keys(simPkg.dependencies || {})) {
    assert(allowed.includes(dep), `Unauthorized dependency in @blackbox-x/simulation-engine: ${dep}`);
  }
  console.log('✓ Zero unauthorized dependencies, strictly adhering to architecture boundary rules\n');

  console.log('===============================================================');
  console.log('   BLACKBOX-X M3 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
  console.log('===============================================================');
}

runM3Gate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ M3 GATE FAILURE:', err);
    process.exit(1);
  });
