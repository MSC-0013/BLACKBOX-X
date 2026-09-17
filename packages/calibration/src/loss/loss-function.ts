import { ComparisonReport } from '@blackbox-x/comparison';
import { CalibrationLossWeights } from '../types.js';

export const DEFAULT_LOSS_WEIGHTS: CalibrationLossWeights = {
  ksWeight: 0.4,
  mapeWeight: 0.4,
  p99Weight: 0.2,
};

/**
 * Evaluates the multi-objective calibration loss function:
 * J = w_ks * D_ks + w_mape * MAPE + w_p99 * error_p99
 */
export function computeCalibrationLoss(
  report: ComparisonReport,
  weights: CalibrationLossWeights = DEFAULT_LOSS_WEIGHTS,
): number {
  const ksTerm = report.ksTest ? report.ksTest.statistic : 0;
  const mapeTerm = report.mape;
  const p99Term = report.quantileErrors.p99;

  // Heavy penalty if prediction interval is breached
  const penalty = report.predictionIntervalEnclosed ? 0 : 1.0;

  return (
    weights.ksWeight * ksTerm +
    weights.mapeWeight * mapeTerm +
    weights.p99Weight * p99Term +
    penalty
  );
}
