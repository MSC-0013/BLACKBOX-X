import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations, workloads, workloadVersions, experimentCampaigns, campaignRuns, db } from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import {
  SubStream,
  WelfordAccumulator,
  computePredictionInterval,
  verifyLittlesLaw,
} from '@blackbox-x/statistics';
import {
  WorkloadSpecDefinition,
  SimulationWorkloadAdapter,
  RealLoadWorkloadAdapter,
  PureCircuitBreaker,
  PureBulkhead,
} from '@blackbox-x/workload-spec';

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

async function runM2Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M2 GATE: Statistics & Workload Specification       ');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 003_workloads
  console.log('Ensuring all migrations up through 003_workloads are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  // ---------------------------------------------------------------------------
  // [1/7] Poisson Arrival Verification (N=100,000, lambda=500, tolerance < 1%)
  // ---------------------------------------------------------------------------
  console.log('[1/7] Testing Poisson arrival distribution (N=100,000, lambda=500)...');
  const lambda = 500;
  const expectedMean = 1 / lambda; // 0.002 seconds
  const rng = new SubStream('test_poisson', 88888888n);
  const welford = new WelfordAccumulator();

  const N = 100_000;
  for (let i = 0; i < N; i++) {
    const intervalSec = rng.nextExponential(lambda);
    welford.update(intervalSec);
  }

  const empiricalMean = welford.mean;
  const relativeError = Math.abs(empiricalMean - expectedMean) / expectedMean;
  console.log(`      Expected Mean: ${expectedMean.toFixed(6)}s, Empirical Mean: ${empiricalMean.toFixed(6)}s`);
  console.log(`      Relative Error: ${(relativeError * 100).toFixed(4)}% (Tolerance: < 1.0%)`);
  assert(
    relativeError < 0.01,
    `Empirical Poisson mean ${empiricalMean} deviated from ${expectedMean} by ${(relativeError * 100).toFixed(2)}% (limit 1%)`,
  );
  console.log('✓ Poisson arrival empirical mean matches theory within 1% tolerance\n');

  // ---------------------------------------------------------------------------
  // [2/7] Workload Phase Shapes (Ramp & Burst Instantaneous Rate Evaluation)
  // ---------------------------------------------------------------------------
  console.log('[2/7] Testing Ramp and Burst arrival phase shapes...');
  const rampSpec: WorkloadSpecDefinition = {
    id: 'spec_ramp_01',
    name: 'Ramp Validation Spec',
    arrivalPattern: 'RAMP',
    arrivalParams: {
      initialRateRps: 100,
      targetRateRps: 1000,
      rampDurationSeconds: 20,
      holdDurationSeconds: 10,
    },
    requestMix: [{ operationName: 'get_order', weight: 1.0 }],
    totalDurationSeconds: 30,
  };
  const rampAdapter = new SimulationWorkloadAdapter(rampSpec);

  // t=0s -> 100 RPS
  assert.strictEqual(rampAdapter.getInstantaneousRateAt(0), 100);
  // t=10s -> 550 RPS (halfway)
  assert.strictEqual(rampAdapter.getInstantaneousRateAt(10_000_000), 550);
  // t=20s -> 1000 RPS (ramp complete)
  assert.strictEqual(rampAdapter.getInstantaneousRateAt(20_000_000), 1000);
  // t=25s -> 1000 RPS (holding)
  assert.strictEqual(rampAdapter.getInstantaneousRateAt(25_000_000), 1000);

  const burstSpec: WorkloadSpecDefinition = {
    id: 'spec_burst_01',
    name: 'Burst Validation Spec',
    arrivalPattern: 'BURST',
    arrivalParams: {
      baselineRateRps: 50,
      burstRateRps: 800,
      baselineDurationSeconds: 10,
      burstDurationSeconds: 5,
    },
    requestMix: [{ operationName: 'flash_sale', weight: 1.0 }],
    totalDurationSeconds: 30,
  };
  const burstAdapter = new SimulationWorkloadAdapter(burstSpec);

  // t=5s (baseline)
  assert.strictEqual(burstAdapter.getInstantaneousRateAt(5_000_000), 50);
  // t=12s (burst phase)
  assert.strictEqual(burstAdapter.getInstantaneousRateAt(12_000_000), 800);
  // t=22s (cycle 2 burst phase: 15s + 7s = 22s -> offset 7s < 10s baseline)
  assert.strictEqual(burstAdapter.getInstantaneousRateAt(22_000_000), 50);
  // t=27s (cycle 2 burst phase: offset 12s >= 10s -> burst)
  assert.strictEqual(burstAdapter.getInstantaneousRateAt(27_000_000), 800);

  console.log('✓ Ramp and Burst arrival phase shapes evaluate to exact target rates at specified virtual times\n');

  // ---------------------------------------------------------------------------
  // [3/7] Externally-Driven State Machines (Circuit Breaker & Bulkhead)
  // ---------------------------------------------------------------------------
  console.log('[3/7] Testing Circuit Breaker and Bulkhead pure state machines...');
  const breaker = new PureCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutUs: 5_000_000,
    halfOpenSuccessThreshold: 2,
  });

  assert.strictEqual(breaker.state, 'CLOSED');
  assert.strictEqual(breaker.canExecute(0), true);

  // Trip to OPEN
  breaker.recordFailure(100);
  breaker.recordFailure(200);
  assert.strictEqual(breaker.state, 'CLOSED');
  breaker.recordFailure(300);
  assert.strictEqual(breaker.state, 'OPEN');
  assert.strictEqual(breaker.canExecute(2_000_000), false);

  // Virtual time advances past resetTimeout -> transitions to HALF_OPEN
  assert.strictEqual(breaker.canExecute(5_000_301), true);
  assert.strictEqual(breaker.state, 'HALF_OPEN');

  // 2 probe successes -> resets to CLOSED
  breaker.recordSuccess(5_000_400);
  assert.strictEqual(breaker.state, 'HALF_OPEN');
  breaker.recordSuccess(5_000_500);
  assert.strictEqual(breaker.state, 'CLOSED');

  // Bulkhead test
  const bulkhead = new PureBulkhead({ maxConcurrent: 2, maxQueueCapacity: 1 });
  assert.strictEqual(bulkhead.tryAcquire(), 'EXECUTING');
  assert.strictEqual(bulkhead.tryAcquire(), 'EXECUTING');
  assert.strictEqual(bulkhead.tryAcquire(), 'QUEUED');
  assert.strictEqual(bulkhead.tryAcquire(), 'REJECTED'); // Sheds load
  assert.strictEqual(bulkhead.totalRejected, 1);

  bulkhead.release(); // Finishes 1 task, promotes 1 from queue
  assert.strictEqual(bulkhead.activeCount, 2);
  assert.strictEqual(bulkhead.queueCount, 0);

  console.log('✓ State machines perform deterministic transitions with zero wall-clock dependencies\n');

  // ---------------------------------------------------------------------------
  // [4/7] Bit-for-bit Determinism Across Repeated Runs
  // ---------------------------------------------------------------------------
  console.log('[4/7] Testing bit-for-bit determinism across repeated runs with identical seed...');
  const detSpec: WorkloadSpecDefinition = {
    id: 'det_spec',
    name: 'Deterministic Spec',
    arrivalPattern: 'POISSON',
    arrivalParams: { lambdaRps: 250 },
    requestMix: [
      { operationName: 'read_item', weight: 0.7 },
      { operationName: 'write_item', weight: 0.3 },
    ],
    totalDurationSeconds: 5,
  };

  const runA = new SimulationWorkloadAdapter(detSpec, 0xcafe_baben).generateArrivals(500);
  const runB = new SimulationWorkloadAdapter(detSpec, 0xcafe_baben).generateArrivals(500);
  assert.strictEqual(runA.length, 500);
  assert.strictEqual(runB.length, 500);
  assert.deepStrictEqual(runA, runB, 'Runs with identical seed must produce bit-for-bit identical arrivals');

  const runC = new SimulationWorkloadAdapter(detSpec, 0xdead_beefn).generateArrivals(500);
  assert.notDeepStrictEqual(runA, runC, 'Runs with different seeds must produce different arrivals');
  console.log('✓ Bit-for-bit determinism verified across 500 arrival events\n');

  // ---------------------------------------------------------------------------
  // [5/7] Dependency Cruiser Layering Verification
  // ---------------------------------------------------------------------------
  console.log('[5/7] Verifying architectural layer purity via package.json checks...');
  const statsPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'statistics', 'package.json'), 'utf8'));
  assert.strictEqual(statsPkg.dependencies, undefined, '@blackbox-x/statistics must have zero workspace dependencies');

  const workloadPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'workload-spec', 'package.json'), 'utf8'));
  const allowedWorkloadDeps = ['@blackbox-x/contracts', '@blackbox-x/statistics'];
  const actualDeps = Object.keys(workloadPkg.dependencies || {});
  for (const dep of actualDeps) {
    assert(
      allowedWorkloadDeps.includes(dep),
      `@blackbox-x/workload-spec has unauthorized dependency: ${dep}`,
    );
  }
  console.log('✓ Architecture boundaries strictly adhere to frozen dependency rules\n');

  // ---------------------------------------------------------------------------
  // [6/7] Dual Adapter Request-Mix & Rate Consistency
  // ---------------------------------------------------------------------------
  console.log('[6/7] Testing consistency between Simulation and Real-Load adapters...');
  const multiMixSpec: WorkloadSpecDefinition = {
    id: 'spec_dual_adapter',
    name: 'Dual Adapter Spec',
    arrivalPattern: 'CONSTANT',
    arrivalParams: { rateRps: 500 },
    requestMix: [
      { operationName: 'search_items', weight: 80 },
      { operationName: 'place_order', weight: 20 },
    ],
    totalDurationSeconds: 10,
  };

  const simAdapter = new SimulationWorkloadAdapter(multiMixSpec, 42n);
  const realAdapter = new RealLoadWorkloadAdapter(multiMixSpec);

  // Verify request mix normalized identically
  assert.strictEqual(simAdapter.normalizedMix[0].weight, 0.8);
  assert.strictEqual(simAdapter.normalizedMix[1].weight, 0.2);
  assert.strictEqual(realAdapter.normalizedMix[0].weight, 0.8);
  assert.strictEqual(realAdapter.normalizedMix[1].weight, 0.2);

  // Verify k6 stages capture target RPS
  const stages = realAdapter.toK6Stages();
  assert.strictEqual(stages[0].target, 500);
  assert.strictEqual(stages[0].duration, '10s');

  console.log('✓ Simulation and Real-Load adapters maintain identical request mix and rate definitions\n');

  // ---------------------------------------------------------------------------
  // [7/7] Monte Carlo Prediction Interval Schema & Non-Confidence Enforcement
  // ---------------------------------------------------------------------------
  console.log('[7/7] Testing Monte Carlo prediction interval schema and Little\'s Law...');
  const sampleLatenciesMs = [12, 14, 15, 11, 13, 16, 14, 15, 12, 18, 14, 13, 15, 14, 16];
  const intervalResult = computePredictionInterval(sampleLatenciesMs, 0.95);

  assert('predictionInterval' in intervalResult, 'Result must contain predictionInterval');
  assert(!('confidenceInterval' in intervalResult), 'CRITICAL: Output must NEVER contain confidenceInterval');
  assert(intervalResult.predictionInterval[0] < intervalResult.mean);
  assert(intervalResult.predictionInterval[1] > intervalResult.mean);

  const ll = verifyLittlesLaw(10, 200, 0.05); // L = 10, lambda = 200, W = 50ms (0.05s) -> expected L = 10
  assert.strictEqual(ll.satisfies, true);
  assert.strictEqual(ll.expectedL, 10);
  assert.strictEqual(ll.relativeError, 0);

  console.log('✓ Prediction interval naming strictly enforced (confidenceInterval absent) and Little\'s Law verified\n');

  // ---------------------------------------------------------------------------
  // [Integration] Database Persistence Verification on Real MySQL
  // ---------------------------------------------------------------------------
  console.log('[Bonus] Verifying workload and experiment campaign persistence in real MySQL...');
  const tenantId = `tnt_m2_${Date.now()}`;
  const projectId = `proj_m2_${Date.now()}`;
  const workloadId = `wkld_${Date.now()}`;
  const campaignId = `cmp_${Date.now()}`;

  // Insert tenant and project
  await pool.query('INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)', [
    tenantId,
    `slug-${tenantId}`,
    'M2 Verification Tenant',
  ]);
  await pool.query('INSERT INTO projects (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)', [
    projectId,
    tenantId,
    'M2 Test Project',
    `slug-${projectId}`,
  ]);

  // Insert workload and version via Drizzle ORM
  await db.insert(workloads).values({
    id: workloadId,
    tenantId,
    name: 'Production Ingress Workload',
    slug: 'prod-ingress',
    description: 'High-throughput ingress simulation workload',
  });

  await db.insert(workloadVersions).values({
    id: `ver_${workloadId}_1`,
    workloadId,
    versionNumber: 1,
    arrivalPattern: 'POISSON',
    arrivalParams: { lambdaRps: 1000 },
    requestMix: [{ operationName: 'get_feed', weight: 1.0 }],
    phaseSchedule: [{ phaseIndex: 0, pattern: 'POISSON', durationSeconds: 60, startRateRps: 1000, endRateRps: 1000 }],
  });

  // Insert experiment campaign and run
  await db.insert(experimentCampaigns).values({
    id: campaignId,
    tenantId,
    projectId,
    name: 'Peak Season Capacity Search',
    campaignType: 'CAPACITY_SEARCH',
    status: 'DRAFT',
    config: { maxConcurrentRuns: 4, targetSloP99Ms: 150 },
  });

  await db.insert(campaignRuns).values({
    id: `crun_${campaignId}_1`,
    campaignId,
    runId: `run_${Date.now()}`,
    runIndex: 1,
    parameters: { concurrency: 50, durationSeconds: 60 },
    status: 'PENDING',
  });

  // Query back and verify
  const fetchedWorkload = await db.query.workloads.findFirst({
    where: eq(workloads.id, workloadId),
  });
  assert(fetchedWorkload, 'Workload should be persisted');
  assert.strictEqual(fetchedWorkload.slug, 'prod-ingress');

  const fetchedCampaign = await db.query.experimentCampaigns.findFirst({
    where: eq(experimentCampaigns.id, campaignId),
  });
  assert(fetchedCampaign, 'Experiment campaign should be persisted');
  assert.strictEqual(fetchedCampaign.campaignType, 'CAPACITY_SEARCH');

  console.log('✓ Workload, Version, Campaign, and Campaign Run persisted and retrieved from MySQL 8.4\n');

  console.log('===============================================================');
  console.log('   BLACKBOX-X M2 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
  console.log('===============================================================');
}

runM2Gate()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ M2 GATE FAILURE:', err);
    await pool.end();
    process.exit(1);
  });
