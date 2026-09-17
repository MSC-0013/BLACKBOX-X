import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  pool,
  runMigrations,
  chaosExperiments,
  chaosExperimentRuns,
  tenants,
  projects,
  db,
} from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import {
  FaultInjector,
  CascadeAnalyzer,
  ResilienceEvaluator,
  ChaosEngine,
  type FaultSchedule,
} from '@blackbox-x/chaos-engine';

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

async function runM9Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M9 GATE: Simulation Chaos & Failure Propagation    ');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 009_chaos
  console.log('Ensuring all migrations up through 009_chaos are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  try {
    // -------------------------------------------------------------------------
    // [1/7] Fault Window Activation & Latency Injection
    // -------------------------------------------------------------------------
    console.log('[1/7] Testing fault window scheduling and latency injection...');
    const latencySchedule: FaultSchedule = {
      id: 'sched-latency-1',
      type: 'LATENCY_INJECTION',
      targetNodeId: 'primary-db',
      startVirtualTimeUs: 1000000, // 1.0s
      durationVirtualTimeUs: 3000000, // 3.0s
      parameters: { addedLatencyUs: 150000 }, // +150ms
    };

    // Before fault: normal latency
    const beforeCall = FaultInjector.evaluateCall(latencySchedule, 'primary-db', 500000, 5000);
    assert.strictEqual(beforeCall.latencyUs, 5000);
    assert.strictEqual(beforeCall.degraded, false);

    // During fault: elevated latency
    const duringCall = FaultInjector.evaluateCall(latencySchedule, 'primary-db', 2000000, 5000);
    assert.strictEqual(duringCall.latencyUs, 155000);
    assert.strictEqual(duringCall.degraded, true);

    // After fault: recovered
    const afterCall = FaultInjector.evaluateCall(latencySchedule, 'primary-db', 4500000, 5000);
    assert.strictEqual(afterCall.latencyUs, 5000);
    assert.strictEqual(afterCall.degraded, false);


    console.log(`      Baseline: ${beforeCall.latencyUs}us -> Under Fault: ${duringCall.latencyUs}us -> Recovered: ${afterCall.latencyUs}us`);
    console.log('✓ Latency fault schedule correctly activated and deactivated\n');

    // -------------------------------------------------------------------------
    // [2/7] Error & Circuit Breaker Fault Injection
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing error rate injection and circuit breaker tripping...');
    const cbSchedule: FaultSchedule = {
      id: 'sched-cb-1',
      type: 'CIRCUIT_BREAKER_TRIP',
      targetNodeId: 'node-auth-service',
      startVirtualTimeUs: 1000000,
      durationVirtualTimeUs: 2000000,
      parameters: {},
    };

    const cbCall = FaultInjector.evaluateCall(cbSchedule, 'node-auth-service', 1500000, 3000);
    assert.strictEqual(cbCall.circuitTripped, true);
    assert.strictEqual(cbCall.failed, true);

    console.log('      Circuit breaker successfully tripped under simulated fault condition');
    console.log('✓ Circuit breaker trip and error injection verified\n');

    // -------------------------------------------------------------------------
    // [3/7] Topological Blast Radius & Cycle-Safe Cascade Traversal
    // -------------------------------------------------------------------------
    console.log('[3/7] Analyzing failure cascade propagation across directed topology graph (with cycle-safe visited-state tracking)...');
    // Ingress -> OrderService -> PrimaryDB
    // Ingress -> PaymentService -> PrimaryDB
    const topologyEdges = [
      { sourceNodeId: 'ingress-gateway', targetNodeId: 'order-svc', edgeKind: 'SYNC_HTTP' },
      { sourceNodeId: 'ingress-gateway', targetNodeId: 'payment-svc', edgeKind: 'SYNC_HTTP' },
      { sourceNodeId: 'order-svc', targetNodeId: 'primary-db', edgeKind: 'DB_QUERY' },
      { sourceNodeId: 'payment-svc', targetNodeId: 'primary-db', edgeKind: 'DB_QUERY' },
    ];

    const cascade = CascadeAnalyzer.analyzeBlastRadius('primary-db', topologyEdges);
    assert.strictEqual(cascade.targetNodeId, 'primary-db');
    assert.strictEqual(cascade.blastRadius, 3, 'Blast radius must include 3 upstream callers');
    assert.ok(cascade.upstreamNodeIds.includes('order-svc'));
    assert.ok(cascade.upstreamNodeIds.includes('payment-svc'));
    assert.ok(cascade.upstreamNodeIds.includes('ingress-gateway'));
    assert.strictEqual(cascade.isCascade, true, 'Multi-tier failure must be flagged as cascade');

    // Cycle-safe traversal check: graph containing a Kafka-mediated feedback loop
    const cyclicEdges = [
      { sourceNodeId: 'order-svc', targetNodeId: 'kafka-broker', edgeKind: 'KAFKA_PUBLISH' },
      { sourceNodeId: 'kafka-broker', targetNodeId: 'notification-svc', edgeKind: 'KAFKA_CONSUME' },
      { sourceNodeId: 'notification-svc', targetNodeId: 'kafka-broker', edgeKind: 'KAFKA_PUBLISH' },
      { sourceNodeId: 'kafka-broker', targetNodeId: 'order-svc', edgeKind: 'KAFKA_CONSUME' },
      { sourceNodeId: 'order-svc', targetNodeId: 'primary-db', edgeKind: 'DB_QUERY' },
    ];
    const cyclicCascade = CascadeAnalyzer.analyzeBlastRadius('primary-db', cyclicEdges);
    assert.strictEqual(cyclicCascade.targetNodeId, 'primary-db');
    assert.strictEqual(cyclicCascade.blastRadius, 3);
    assert.ok(cyclicCascade.upstreamNodeIds.includes('order-svc'));
    assert.ok(cyclicCascade.upstreamNodeIds.includes('kafka-broker'));
    assert.ok(cyclicCascade.upstreamNodeIds.includes('notification-svc'));

    console.log(`      Target Node:   ${cascade.targetNodeId}`);
    console.log(`      Blast Radius:  ${cascade.blastRadius} upstream components`);
    console.log(`      Cascade Depth: ${cascade.depth} tiers (cycle-safe traversal verified on async loop)`);
    console.log('✓ Cascade propagation and blast radius accurately attributed across cyclic and acyclic graphs\n');

    // -------------------------------------------------------------------------
    // [4/7] BLACKBOX-X Resilience Score & Simulated MTTR Evaluation
    // -------------------------------------------------------------------------
    console.log('[4/7] Evaluating BLACKBOX-X Resilience Score and simulated MTTR...');
    const resilience = ResilienceEvaluator.evaluate({
      blastRadius: cascade.blastRadius,
      cascadeDetected: cascade.isCascade,
      totalRequests: 1000,
      failedRequests: 50,
      degradedRequests: 150,
      fallbackRequests: 30,
      faultDurationUs: 3000000,
      recoveryTimeUs: 40000, // 40ms
    });

    assert.ok(resilience.resilienceScore >= 0 && resilience.resilienceScore <= 100);
    assert.strictEqual(resilience.mttrMs, 40);
    assert.strictEqual(resilience.blastRadius, 3);
    assert.strictEqual(resilience.cascadeDetected, true);

    console.log(`      BLACKBOX-X Resilience Score: ${resilience.resilienceScore.toFixed(2)} / 100`);
    console.log(`      Simulated MTTR:              ${resilience.mttrMs} ms`);
    console.log('✓ BLACKBOX-X Resilience Score and simulated MTTR computed accurately\n');

    // -------------------------------------------------------------------------
    // [5/7] End-to-End Chaos Experiment Execution
    // -------------------------------------------------------------------------
    console.log('[5/7] Running end-to-end chaos experiment simulation (baseline vs chaos)...');
    const experimentResult = ChaosEngine.runExperiment({
      experimentId: `exp-${Date.now()}`,
      schedule: latencySchedule,
      topologyEdges,
      totalRequests: 400,
      baseLatencyUs: 4000,
    });

    assert.ok(experimentResult.chaosMetrics.p99Us > experimentResult.baselineMetrics.p99Us);
    assert.strictEqual(experimentResult.resilience.blastRadius, 3);

    console.log(`      Baseline p99:   ${experimentResult.baselineMetrics.p99Us}us`);
    console.log(`      Chaos p99:      ${experimentResult.chaosMetrics.p99Us}us`);
    console.log(`      Resilience:     ${experimentResult.resilience.resilienceScore} / 100`);
    console.log('✓ Closed-loop chaos experiment simulation executed successfully\n');

    // -------------------------------------------------------------------------
    // [6/7] Persisting Chaos Experiment & Run in MySQL 8.4
    // -------------------------------------------------------------------------
    console.log('[6/7] Persisting chaos experiment and run records in MySQL 8.4...');
    const [tenant] = await db.select().from(tenants).limit(1);
    assert.ok(tenant, 'Default tenant must exist');

    let [project] = await db.select().from(projects).limit(1);
    if (!project) {
      const projId = `proj-chaos-${Date.now()}`;
      await db.insert(projects).values({
        id: projId,
        tenantId: tenant.id,
        name: 'Chaos Verification Project',
        slug: 'chaos-verify',
      });
      [project] = await db.select().from(projects).where(eq(projects.id, projId));
    }

    const expDbId = `exp-db-${Date.now()}`;
    await db.insert(chaosExperiments).values({
      id: expDbId,
      tenantId: tenant.id,
      projectId: project!.id,
      name: 'Primary DB Latency Injection Experiment',
      status: 'COMPLETED',
      faultType: latencySchedule.type,
      targetNodeId: latencySchedule.targetNodeId,
      parameters: latencySchedule.parameters,
      durationSec: 3,
    });

    const runDbId = `crun-${Date.now()}`;
    await db.insert(chaosExperimentRuns).values({
      id: runDbId,
      experimentId: expDbId,
      resilienceScore: experimentResult.resilience.resilienceScore,
      blastRadius: experimentResult.resilience.blastRadius,
      mttrMs: experimentResult.resilience.mttrMs,
      cascadeDetected: experimentResult.resilience.cascadeDetected,
      totalRequests: experimentResult.resilience.totalRequests,
      failedRequests: experimentResult.resilience.failedRequests,
      degradedRequests: experimentResult.resilience.degradedRequests,
      startedAt: new Date(Date.now() - 3000),
      completedAt: new Date(),
    });

    const [savedExp] = await db
      .select()
      .from(chaosExperiments)
      .where(eq(chaosExperiments.id, expDbId));

    assert.ok(savedExp, 'Saved experiment must exist');
    assert.strictEqual(savedExp.targetNodeId, latencySchedule.targetNodeId);

    const [savedRun] = await db
      .select()
      .from(chaosExperimentRuns)
      .where(eq(chaosExperimentRuns.id, runDbId));

    assert.ok(savedRun, 'Saved run must exist');
    assert.strictEqual(savedRun.blastRadius, 3);
    console.log(`      Persisted Chaos Experiment: ${savedExp.id}, Run: ${savedRun.id}`);
    console.log('✓ Chaos experiment and run history successfully persisted in MySQL 8.4\n');

    // -------------------------------------------------------------------------
    // [7/7] Architecture Boundary Validation via Dependency Cruiser
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying architectural purity of @blackbox-x/chaos-engine...');
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
      throw new Error('Architectural boundary violation detected in chaos-engine');
    }

    console.log('===============================================================');
    console.log('   BLACKBOX-X M9 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
    console.log('===============================================================');
  } finally {
    await pool.end();
  }
}

runM9Gate().catch((err) => {
  console.error('\n❌ M9 GATE VERIFICATION FAILED:', err);
  process.exit(1);
});
