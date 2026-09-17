export type ModelStatus = 'UNCALIBRATED' | 'CALIBRATED' | 'VALIDATED';

export interface CalibrationParameter {
  name: string;
  currentValue: number;
  minValue: number;
  maxValue: number;
  stepSize?: number;
}

export interface CalibrationLossWeights {
  ksWeight: number;
  mapeWeight: number;
  p99Weight: number;
}

export interface CalibrationIteration {
  iteration: number;
  parameters: Record<string, number>;
  loss: number;
  ksStatistic?: number;
  mape: number;
  verdict: string;
}

export interface CalibrationResult {
  converged: boolean;
  initialLoss: number;
  finalLoss: number;
  calibratedParameters: Record<string, number>;
  parameterDeltas: Record<string, { initial: number; calibrated: number; deltaPercent: number }>;
  iterations: CalibrationIteration[];
}
