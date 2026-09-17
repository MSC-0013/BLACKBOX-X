import { ComparisonEngine, ComparisonReport, LatencyDistributionSummary } from '@blackbox-x/comparison';
import { CalibrationParameter, CalibrationResult } from '../types.js';
import { computeCalibrationLoss } from '../loss/loss-function.js';
import { runCoordinateDescent } from '../optimizer/coordinate-descent.js';

export interface ClosedLoopOptions {
  parameters: CalibrationParameter[];
  realBenchmark: LatencyDistributionSummary & { throughputRps: number };
  simulator: (params: Record<string, number>) => Promise<LatencyDistributionSummary & {
    throughputRps: number;
    predictionInterval?: [number, number];
  }>;
}

export interface ClosedLoopResult {
  initialReport: ComparisonReport;
  finalReport: ComparisonReport;
  calibrationResult: CalibrationResult;
  isAligned: boolean;
}

export class CalibrationEngine {
  private readonly comparator = new ComparisonEngine();

  async executeClosedLoop(options: ClosedLoopOptions): Promise<ClosedLoopResult> {
    const { parameters, realBenchmark, simulator } = options;

    // Initial simulation & comparison
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

    // Re-simulate with calibrated parameters
    const finalSim = await simulator(calibrationResult.calibratedParameters);
    const finalReport = this.comparator.compare({
      simulated: finalSim,
      real: realBenchmark,
    });

    return {
      initialReport,
      finalReport,
      calibrationResult,
      isAligned: finalReport.verdict === 'ALIGNED',
    };
  }
}
