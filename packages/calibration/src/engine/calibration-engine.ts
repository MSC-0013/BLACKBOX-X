import { ComparisonEngine, ComparisonReport, LatencyDistributionSummary } from '@blackbox-x/comparison';
import { CalibrationParameter, CalibrationResult, ModelStatus } from '../types.js';
import { computeCalibrationLoss } from '../loss/loss-function.js';
import { runCoordinateDescent } from '../optimizer/coordinate-descent.js';

export interface ClosedLoopOptions {
  parameters: CalibrationParameter[];
  realBenchmark: LatencyDistributionSummary & { throughputRps: number };
  validationBenchmark?: LatencyDistributionSummary & { throughputRps: number };
  simulator: (params: Record<string, number>) => Promise<LatencyDistributionSummary & {
    throughputRps: number;
    predictionInterval?: [number, number];
  }>;
}

export interface ClosedLoopResult {
  modelStatus: ModelStatus;
  initialReport: ComparisonReport;
  finalReport: ComparisonReport;
  validationReport?: ComparisonReport;
  calibrationResult: CalibrationResult;
  isAligned: boolean;
  isValidated: boolean;
}

export class CalibrationEngine {
  private readonly comparator = new ComparisonEngine();

  async executeClosedLoop(options: ClosedLoopOptions): Promise<ClosedLoopResult> {
    const { parameters, realBenchmark, validationBenchmark, simulator } = options;

    // Initial simulation & comparison (Model status: UNCALIBRATED)
    const initialParams: Record<string, number> = {};
    for (const p of parameters) {
      initialParams[p.name] = p.currentValue;
    }

    const initialSim = await simulator(initialParams);
    const initialReport = this.comparator.compare({
      simulated: initialSim,
      real: realBenchmark,
    });

    // Run calibration optimization
    const calibrationResult = await runCoordinateDescent({
      parameters,
      maxCycles: 5,
      tolerance: 0.02,
      evaluator: async (candidateParams) => {
        const sim = await simulator(candidateParams);
        const report = this.comparator.compare({
          simulated: sim,
          real: realBenchmark,
        });
        const loss = computeCalibrationLoss(report);
        return {
          loss,
          ksStatistic: report.ksTest?.statistic,
          mape: report.mape,
          verdict: report.verdict,
        };
      },
    });

    // Re-simulate with calibrated parameters against calibration benchmark
    const finalSim = await simulator(calibrationResult.calibratedParameters);
    const finalReport = this.comparator.compare({
      simulated: finalSim,
      real: realBenchmark,
    });

    const isAligned = finalReport.verdict === 'ALIGNED';
    let modelStatus: ModelStatus = isAligned ? 'CALIBRATED' : 'UNCALIBRATED';
    let validationReport: ComparisonReport | undefined;
    let isValidated = false;

    // Evaluate against independent held-out validation dataset split
    if (validationBenchmark) {
      validationReport = this.comparator.compare({
        simulated: finalSim,
        real: validationBenchmark,
      });
      if (validationReport.verdict === 'ALIGNED') {
        modelStatus = 'VALIDATED';
        isValidated = true;
      }
    }

    return {
      modelStatus,
      initialReport,
      finalReport,
      validationReport,
      calibrationResult,
      isAligned,
      isValidated,
    };
  }
}
