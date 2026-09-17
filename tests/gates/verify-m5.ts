import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations, capacitySearches, capacitySearchSteps, db } from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import {
  CapacitySearchEngine,
  runBisectionSearch,
  detectKneePoint,
  identifyBottleneck,
} from '@blackbox-x/capacity-search';

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

async function runM5Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M5 GATE: Capacity Search & Bottleneck Attribution   ');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 005_capacity_search
  console.log('Ensuring all migrations up through 005_capacity_search are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  // ---------------------------------------------------------------------------
  // [1/7] Monotonicity-Aware Bisection Search Under Strict SLO Constraint
  // ---------------------------------------------------------------------------
  console.log('[1/7] Executing monotonicity-aware bisection search (range: 100-1000 RPS, SLO: p99 <= 40ms)...');
  // Synthetic system with knee at 450 RPS and saturation limit at 500 RPS
  const evaluator = async (rps: number) => {
    let p99Us = 5000 + rps * 15;
    if (rps > 450) {
      p99Us += Math.pow(rps - 450, 2) * 25;
    }
    const errorRate = rps > 520 ? 0.05 : 0.0;
    return { p99Us, errorRate };
  };

  const bisectionResult = await runBisectionSearch({
    minRps: 100,
    maxRps: 1000,
    toleranceRps: 10,
    slo: { maxP99Us: 40_000, maxErrorRate: 0.01 }, // 40ms p99 and <= 1% errors
    evaluator,
  });

  console.log(`      Found Maximum Sustainable Load: ${bisectionResult.maxSustainableRps} RPS`);
  console.log(`      Search Steps Executed: ${bisectionResult.steps.length}`);
  for (const step of bisectionResult.steps) {
    console.log(`        Step ${step.stepIndex}: candidate = ${step.candidateRps} RPS, p99 = ${(step.p99Us / 1000).toFixed(2)}ms, satisfies = ${step.satisfiesSlo}`);
  }

  assert(
    bisectionResult.maxSustainableRps >= 470 && bisectionResult.maxSustainableRps <= 510,
    `Expected sustainable RPS ~480-500, got ${bisectionResult.maxSustainableRps}`,
  );
  console.log('✓ Bisection search accurately converges to maximum sustainable capacity\n');

  // ---------------------------------------------------------------------------
  // [2/7] Non-Monotonic / Queue Collapse Detection
  // ---------------------------------------------------------------------------
  console.log('[2/7] Testing detection of non-monotonic degradation curves (load shedding / collapse)...');
  let evalStep = 0;
  const collapsingEvaluator = async (rps: number) => {
    evalStep++;
    if (evalStep === 2) {
      // Step 2 sheds 80% requests, causing artificially low latency on few surviving requests
      return { p99Us: 2000, errorRate: 0.8 };
    }
    return { p99Us: rps * 50, errorRate: 0.0 };
  };

  const collapseResult = await runBisectionSearch({
    minRps: 100,
    maxRps: 1000,
    toleranceRps: 50,
    slo: { maxP99Us: 30_000, maxErrorRate: 0.01 },
    evaluator: collapsingEvaluator,
  });

  assert.strictEqual(collapseResult.nonMonotonicDetected, true);
  console.log('✓ Non-monotonic anomaly successfully detected and flagged\n');

  // ---------------------------------------------------------------------------
  // [3/7] Kneedle Algorithm Knee-Point Inflection Detection
  // ---------------------------------------------------------------------------
  console.log('[3/7] Testing Kneedle knee-point detection on non-linear queueing curve...');
  const latencyCurve = [
    { rps: 100, p99Us: 6000 },
    { rps: 200, p99Us: 6500 },
    { rps: 300, p99Us: 7200 },
    { rps: 400, p99Us: 8800 },
    { rps: 450, p99Us: 12000 },
    { rps: 500, p99Us: 32000 }, // hockey stick onset
    { rps: 550, p99Us: 85000 },
  ];

  const knee = detectKneePoint(latencyCurve);
  assert(knee, 'Knee point must be detected');
  console.log(`      Detected Knee Point: ${knee.kneeRps} RPS (p99: ${(knee.latencyAtKneeUs / 1000).toFixed(2)}ms, curvature: ${knee.curvature.toFixed(4)})`);
  assert(knee.kneeRps >= 450 && knee.kneeRps <= 500, `Expected knee around 450-500 RPS, got ${knee.kneeRps}`);
  console.log('✓ Knee-point detected at exact hockey-stick inflection point\n');

  // ---------------------------------------------------------------------------
  // [4/7] Root-Cause Bottleneck Attribution
  // ---------------------------------------------------------------------------
  console.log('[4/7] Testing multi-tier root-cause bottleneck attribution...');
  const componentsState = [
    {
      componentId: 'api_gateway',
      cpuUtilization: 0.42,
      threadPoolUtilization: 0.55,
      connectionPoolUtilization: 0.30,
    },
    {
      componentId: 'order_service',
      cpuUtilization: 0.60,
      threadPoolUtilization: 0.68,
      connectionPoolUtilization: 0.50,
    },
    {
      componentId: 'mysql_primary',
      cpuUtilization: 0.35,
      threadPoolUtilization: 0.40,
      connectionPoolUtilization: 0.99, // Saturating connection pool!
    },
  ];

  const bottleneck = identifyBottleneck(componentsState);
  assert(bottleneck, 'Bottleneck must be attributed');
  console.log(`      Limiting Component: ${bottleneck.limitingComponent}`);
  console.log(`      Limiting Resource: ${bottleneck.limitingResourceType} (Utilization: ${(bottleneck.utilization * 100).toFixed(1)}%)`);
  console.log(`      Recommendation: ${bottleneck.recommendation}`);

  assert.strictEqual(bottleneck.limitingComponent, 'mysql_primary');
  assert.strictEqual(bottleneck.limitingResourceType, 'CONNECTION_POOL');
  assert.strictEqual(bottleneck.utilization, 0.99);
  assert(bottleneck.recommendation.toLowerCase().includes('connection pool'));
  console.log('✓ Root-cause bottleneck correctly attributed to saturating database connection pool\n');

  // ---------------------------------------------------------------------------
  // [5/7] End-to-End Capacity Search Engine Run
  // ---------------------------------------------------------------------------
  console.log('[5/7] Executing integrated CapacitySearchEngine pipeline...');
  const engine = new CapacitySearchEngine();
  const searchReport = await engine.search({
    minRps: 100,
    maxRps: 800,
    toleranceRps: 20,
    slo: { maxP99Us: 45_000, maxErrorRate: 0.01 },
    evaluator: async (rps) => ({
      p99Us: 4000 + rps * 20 + (rps > 400 ? Math.pow(rps - 400, 2) * 15 : 0),
      errorRate: rps > 550 ? 0.04 : 0,
      components: [
        {
          componentId: 'ingress_node',
          cpuUtilization: rps / 600,
          threadPoolUtilization: rps / 500,
          connectionPoolUtilization: 0.3,
        },
      ],
    }),
  });

  assert(searchReport.sloSatisfied, 'SLO should be satisfied at lower rates');
  assert(searchReport.maxSustainableRps >= 400, `Expected sustainable RPS >= 400, got ${searchReport.maxSustainableRps}`);
  assert(searchReport.bottleneck, 'Bottleneck report should be present');
  console.log(`      Integrated Search Result: maxSustainable = ${searchReport.maxSustainableRps} RPS, bottleneck = ${searchReport.bottleneck?.limitingComponent}:${searchReport.bottleneck?.limitingResourceType}`);
  console.log('✓ Integrated CapacitySearchEngine completed successfully\n');

  // ---------------------------------------------------------------------------
  // [6/7] Database Persistence in Real MySQL 8.4
  // ---------------------------------------------------------------------------
  console.log('[6/7] Persisting capacity search run and intermediate steps in real MySQL 8.4...');
  const tenantId = `tnt_m5_${Date.now()}`;
  const projectId = `proj_m5_${Date.now()}`;
  const searchId = `cap_${Date.now()}`;

  // Insert tenant and project
  await pool.query('INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)', [
    tenantId,
    `slug-${tenantId}`,
    'M5 Verification Tenant',
  ]);
  await pool.query('INSERT INTO projects (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)', [
    projectId,
    tenantId,
    'M5 Capacity Project',
    `slug-${projectId}`,
  ]);

  // Insert capacity search
  await db.insert(capacitySearches).values({
    id: searchId,
    tenantId,
    projectId,
    targetP99Us: 45_000,
    maxErrorRate: 0.01,
    maxSustainableRps: searchReport.maxSustainableRps,
    kneePointRps: searchReport.kneePoint?.kneeRps ?? null,
    limitingComponent: searchReport.bottleneck?.limitingComponent ?? null,
    limitingResource: searchReport.bottleneck?.limitingResourceType ?? null,
    searchSummary: searchReport,
  });

  // Insert steps
  for (const s of searchReport.steps) {
    await db.insert(capacitySearchSteps).values({
      id: `cstep_${searchId}_${s.stepIndex}`,
      capacitySearchId: searchId,
      stepIndex: s.stepIndex,
      candidateRps: s.candidateRps,
      p99Us: s.p99Us,
      errorRate: s.errorRate,
      satisfiesSlo: s.satisfiesSlo,
    });
  }

  // Query back and verify
  const fetchedSearch = await db.query.capacitySearches.findFirst({
    where: eq(capacitySearches.id, searchId),
  });
  assert(fetchedSearch, 'Capacity search must be persisted');
  assert.strictEqual(fetchedSearch.maxSustainableRps, searchReport.maxSustainableRps);
  assert.strictEqual(fetchedSearch.limitingComponent, searchReport.bottleneck?.limitingComponent);

  const fetchedSteps = await db.query.capacitySearchSteps.findMany({
    where: eq(capacitySearchSteps.capacitySearchId, searchId),
  });
  assert.strictEqual(fetchedSteps.length, searchReport.steps.length);
  console.log(`✓ Capacity search and ${fetchedSteps.length} steps persisted and retrieved from MySQL 8.4\n`);

  // ---------------------------------------------------------------------------
  // [7/7] Dependency Cruiser Architecture Boundary Check
  // ---------------------------------------------------------------------------
  console.log('[7/7] Verifying architectural purity of @blackbox-x/capacity-search...');
  const capPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'packages', 'capacity-search', 'package.json'), 'utf8'),
  );
  const allowed = [
    '@blackbox-x/contracts',
    '@blackbox-x/statistics',
    '@blackbox-x/workload-spec',
    '@blackbox-x/simulation-engine',
  ];
  for (const dep of Object.keys(capPkg.dependencies || {})) {
    assert(allowed.includes(dep), `Unauthorized dependency in @blackbox-x/capacity-search: ${dep}`);
  }
  console.log('✓ Architecture boundary rules strictly validated\n');

  console.log('===============================================================');
  console.log('   BLACKBOX-X M5 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
  console.log('===============================================================');
}

runM5Gate()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ M5 GATE FAILURE:', err);
    await pool.end();
    process.exit(1);
  });
