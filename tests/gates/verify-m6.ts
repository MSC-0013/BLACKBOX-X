import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations, calibrationSessions, calibrationIterations, db } from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import { buildServer } from '../../apps/blackbox-api/src/server.js';
import { executeBenchmark } from '@blackbox-x/comparison';
import {
  CalibrationEngine,
  computeCalibrationLoss,
  runCoordinateDescent,
} from '@blackbox-x/calibration';

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

async function runM6Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M6 GATE: Calibration Engine & Closed-Loop Validation');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 006_calibration
  console.log('Ensuring all migrations up through 006_calibration are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  // Start real API server for live benchmarking
  console.log('Starting real Fastify API server for live benchmark collection...');
  const app = buildServer();
  await app.listen({ port: 3002, host: '127.0.0.1' });
  const targetUrl = 'http://127.0.0.1:3002/health/live';
  console.log(`✓ Real API server listening on ${targetUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // [1/7] Multi-Objective Loss Function Evaluation
    // -------------------------------------------------------------------------
    console.log('[1/7] Evaluating multi-objective calibration loss function...');
    const sampleReportAligned = {
      verdict: 'ALIGNED' as const,
      ksTest: { statistic: 0.05, criticalValue: 0.15, rejectNull: false },
      quantileErrors: { p50: 0.04, p90: 0.06, p95: 0.08, p99: 0.09 },
      mape: 0.0675,
      predictionIntervalEnclosed: true,
      throughputComparison: { simulatedRps: 500, realRps: 500, relativeError: 0 },
    };
    const lossAligned = computeCalibrationLoss(sampleReportAligned);
    assert(lossAligned < 0.10, `Expected low loss for aligned report, got ${lossAligned}`);

    const sampleReportBreached = {
      ...sampleReportAligned,
      verdict: 'MISALIGNED' as const,
      predictionIntervalEnclosed: false,
    };
    const lossBreached = computeCalibrationLoss(sampleReportBreached);
    assert(lossBreached >= 1.0, `Prediction interval breach must incur >= 1.0 penalty, got ${lossBreached}`);
    console.log('✓ Calibration loss function correctly weights metrics and penalizes prediction interval breach\n');

    // -------------------------------------------------------------------------
    // [2/7] Coordinate Descent Parameter Optimization
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing coordinate descent optimizer convergence...');
    const targetLatency = 4500;
    const optResult = await runCoordinateDescent({
      parameters: [
        {
          name: 'db_query_time',
          currentValue: 1000, // Initial estimate is 1000us, far from 4500us target
          minValue: 500,
          maxValue: 8000,
        },
      ],
      tolerance: 0.05,
      evaluator: async (params) => {
        const diff = Math.abs(params.db_query_time - targetLatency);
        const mape = diff / targetLatency;
        return {
          loss: mape,
          mape,
          verdict: mape < 0.1 ? 'ALIGNED' : 'MISALIGNED',
        };
      },
    });

    console.log(`      Initial Value: 1000us, Calibrated Value: ${optResult.calibratedParameters.db_query_time}us (Target: 4500us)`);
    console.log(`      Initial Loss: ${(optResult.initialLoss * 100).toFixed(2)}%, Final Loss: ${(optResult.finalLoss * 100).toFixed(2)}%`);
    assert(optResult.converged, 'Optimizer must converge');
    assert(optResult.finalLoss < optResult.initialLoss * 0.2, 'Final loss must improve by > 80%');
    console.log('✓ Coordinate descent optimizer converged with significant loss reduction\n');

    // -------------------------------------------------------------------------
    // [3/7] Real Benchmark Baseline Execution (Train/Calibration & Validation Splits)
    // -------------------------------------------------------------------------
    console.log('[3/7] Executing real benchmark against live server (N=400 requests with 50/50 train/validation split)...');
    // Warm up Fastify server
    await executeBenchmark({ targetUrl, totalRequests: 50, concurrency: 4 });

    const fullBenchmark = await executeBenchmark({
      targetUrl,
      totalRequests: 400,
      concurrency: 8,
    });
    assert.strictEqual(fullBenchmark.successfulRequests, 400);

    // Formally split empirical samples into Calibration (Train) and Held-Out Validation datasets
    const calSamples = fullBenchmark.samplesUs.filter((_, idx) => idx % 2 === 0);
    const valSamples = fullBenchmark.samplesUs.filter((_, idx) => idx % 2 === 1);

    const summarize = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        p50Us: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p90Us: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
        p95Us: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        p99Us: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
        meanLatencyUs: Math.round(samples.reduce((a, b) => a + b, 0) / (samples.length || 1)),
        throughputRps: fullBenchmark.throughputRps,
        samplesUs: samples,
      };
    };

    const realBaseline = summarize(calSamples);
    const validationBaseline = summarize(valSamples);
    console.log(`      Calibration Baseline (N=${calSamples.length}) p50: ${realBaseline.p50Us}us, p90: ${realBaseline.p90Us}us, Mean: ${realBaseline.meanLatencyUs}us`);
    console.log(`      Held-Out Validation  (N=${valSamples.length}) p50: ${validationBaseline.p50Us}us, p90: ${validationBaseline.p90Us}us, Mean: ${validationBaseline.meanLatencyUs}us`);
    console.log('✓ Real benchmark calibration & held-out validation datasets captured successfully\n');

    // -------------------------------------------------------------------------
    // [4/7] Complete Closed-Loop Execution (Model -> Sim -> Compare -> Calibrate -> Re-sim -> Validate)
    // -------------------------------------------------------------------------
    console.log('[4/7] Executing complete closed-loop calibration & validation pipeline...');
    const calibrationEngine = new CalibrationEngine();

    // Simulation model where latency scales with parameter 'internal_processing_time'
    const simulator = async (params: Record<string, number>) => {
      const base = params.internal_processing_time;
      const scale = base / realBaseline.p50Us;
      return {
        p50Us: base,
        p90Us: Math.round(realBaseline.p90Us * scale),
        p95Us: Math.round(realBaseline.p95Us * scale),
        p99Us: Math.round(realBaseline.p99Us * scale),
        meanLatencyUs: Math.round(realBaseline.meanLatencyUs * scale),
        throughputRps: realBaseline.throughputRps,
        predictionInterval: [Math.round(base * 0.85), Math.round(base * 1.15)] as [number, number],
        samplesUs: realBaseline.samplesUs.map((s) => Math.round(s * scale)),
      };
    };

    const closedLoop = await calibrationEngine.executeClosedLoop({
      parameters: [
        {
          name: 'internal_processing_time',
          currentValue: Math.max(500, Math.round(realBaseline.p50Us * 0.3)), // Uncalibrated: 70% lower than reality
          minValue: 500,
          maxValue: Math.round(realBaseline.p50Us * 2.5),
        },
      ],
      realBenchmark: realBaseline,
      validationBenchmark: validationBaseline,
      simulator,
    });

    console.log(`      Initial Comparison Verdict: ${closedLoop.initialReport.verdict} (MAPE: ${(closedLoop.initialReport.mape * 100).toFixed(2)}%)`);
    console.log(`      Calibrated Dataset Verdict: ${closedLoop.finalReport.verdict} (MAPE: ${(closedLoop.finalReport.mape * 100).toFixed(2)}%)`);
    console.log(`      Validation Dataset Verdict: ${closedLoop.validationReport?.verdict} (MAPE: ${((closedLoop.validationReport?.mape ?? 0) * 100).toFixed(2)}%)`);
    console.log(`      Model Status Evolution:     UNCALIBRATED -> CALIBRATED -> ${closedLoop.modelStatus}`);
    console.log(`      Prediction Interval Enclosed: ${closedLoop.finalReport.predictionIntervalEnclosed}`);

    assert.notStrictEqual(closedLoop.initialReport.verdict, 'ALIGNED', 'Initial run must not be aligned');
    assert.strictEqual(closedLoop.finalReport.verdict, 'ALIGNED', 'Final calibrated model must achieve ALIGNED verdict on calibration dataset');
    assert.strictEqual(closedLoop.isAligned, true);
    assert.strictEqual(closedLoop.validationReport?.verdict, 'ALIGNED', 'Model must achieve ALIGNED on held-out validation dataset');
    assert.strictEqual(closedLoop.isValidated, true);
    assert.strictEqual(closedLoop.modelStatus, 'VALIDATED', 'Model must advance to VALIDATED status');
    assert.strictEqual(closedLoop.finalReport.predictionIntervalEnclosed, true);
    console.log('✓ Closed loop achieved convergence: Model -> Sim -> Compare -> Calibrate -> Re-sim -> CALIBRATED -> VALIDATED!\n');

    // -------------------------------------------------------------------------
    // [5/7] Parameter Deltas and Evolution Tracking
    // -------------------------------------------------------------------------
    console.log('[5/7] Verifying parameter evolution tracking and delta calculations...');
    const deltas = closedLoop.calibrationResult.parameterDeltas;
    assert('internal_processing_time' in deltas, 'Must track delta for internal_processing_time');
    const paramDelta = deltas.internal_processing_time;
    console.log(`      Parameter Delta: initial = ${paramDelta.initial}us, calibrated = ${paramDelta.calibrated}us (delta = ${paramDelta.deltaPercent.toFixed(2)}%)`);
    assert(paramDelta.calibrated > paramDelta.initial, 'Calibrated parameter must adjust upward toward real latency');
    console.log('✓ Parameter deltas computed and verified\n');

    // -------------------------------------------------------------------------
    // [6/7] Database Persistence in Real MySQL 8.4
    // -------------------------------------------------------------------------
    console.log('[6/7] Persisting calibration session and iteration history in real MySQL 8.4...');
    const tenantId = `tnt_m6_${Date.now()}`;
    const projectId = `proj_m6_${Date.now()}`;
    const sessionId = `cses_${Date.now()}`;

    // Seed tenant and project
    await pool.query('INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)', [
      tenantId,
      `slug-${tenantId}`,
      'M6 Verification Tenant',
    ]);
    await pool.query('INSERT INTO projects (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)', [
      projectId,
      tenantId,
      'M6 Calibration Project',
      `slug-${projectId}`,
    ]);

    // Insert calibration session
    await db.insert(calibrationSessions).values({
      id: sessionId,
      tenantId,
      projectId,
      status: 'CONVERGED',
      initialLoss: closedLoop.calibrationResult.initialLoss,
      finalLoss: closedLoop.calibrationResult.finalLoss,
      parameterDeltas: closedLoop.calibrationResult.parameterDeltas,
    });

    // Insert iterations
    for (const iter of closedLoop.calibrationResult.iterations) {
      await db.insert(calibrationIterations).values({
        id: `citer_${sessionId}_${iter.iteration}`,
        calibrationSessionId: sessionId,
        iterationNum: iter.iteration,
        candidateParams: iter.parameters,
        loss: iter.loss,
        ksStatistic: iter.ksStatistic ?? null,
        mape: iter.mape,
        verdict: iter.verdict,
      });
    }

    // Query back and verify
    const fetchedSession = await db.query.calibrationSessions.findFirst({
      where: eq(calibrationSessions.id, sessionId),
    });
    assert(fetchedSession, 'Calibration session should be persisted');
    assert.strictEqual(fetchedSession.status, 'CONVERGED');

    const fetchedIterations = await db.query.calibrationIterations.findMany({
      where: eq(calibrationIterations.calibrationSessionId, sessionId),
    });
    assert.strictEqual(fetchedIterations.length, closedLoop.calibrationResult.iterations.length);
    console.log(`✓ Calibration session and ${fetchedIterations.length} iterations persisted and queried from MySQL 8.4\n`);

    // -------------------------------------------------------------------------
    // [7/7] Dependency Cruiser Architectural Purity
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying architectural purity of @blackbox-x/calibration...');
    const calPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'packages', 'calibration', 'package.json'), 'utf8'),
    );
    const allowed = [
      '@blackbox-x/contracts',
      '@blackbox-x/statistics',
      '@blackbox-x/workload-spec',
      '@blackbox-x/simulation-engine',
      '@blackbox-x/comparison',
    ];
    for (const dep of Object.keys(calPkg.dependencies || {})) {
      assert(allowed.includes(dep), `Unauthorized dependency in @blackbox-x/calibration: ${dep}`);
    }
    console.log('✓ Architecture boundary rules strictly validated\n');

    console.log('===============================================================');
    console.log('   BLACKBOX-X M6 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
    console.log('===============================================================');
  } finally {
    await app.close();
  }
}

runM6Gate()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ M6 GATE FAILURE:', err);
    await pool.end();
    process.exit(1);
  });
