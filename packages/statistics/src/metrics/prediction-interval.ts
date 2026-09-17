import { WelfordStats } from './welford.js';
import { standardNormalInvCdf } from '../icdf/tables.js';

export interface PredictionIntervalResult {
  mean: number;
  variance: number;
  standardDeviation: number;
  coverage: number;
  lower: number;
  upper: number;
  predictionInterval: [number, number];
}

/**
 * Computes a Monte Carlo prediction interval across independent simulation trial runs.
 * Note: Under the frozen architecture (Pass 3), simulation prediction ranges across trials
 * must be explicitly labeled as a predictionInterval (not a confidence interval).
 */
export function computePredictionInterval(
  samples: number[],
  coverage = 0.9,
): PredictionIntervalResult {
  if (samples.length === 0) {
    throw new Error('Cannot compute prediction interval of empty sample array');
  }

  const welford = new WelfordStats();
  for (const s of samples) {
    welford.update(s);
  }

  const mean = welford.mean;
  const stdDev = welford.standardDeviation;

  // Normal approximation for prediction interval: mean +/- z * sqrt(1 + 1/n) * s
  const alpha = (1 - coverage) / 2;
  const z = standardNormalInvCdf(1 - alpha);
  const factor = z * Math.sqrt(1 + 1 / samples.length) * stdDev;

  const lower = Math.max(0, mean - factor);
  const upper = mean + factor;

  return {
    mean,
    variance: welford.variance,
    standardDeviation: stdDev,
    coverage,
    lower,
    upper,
    predictionInterval: [lower, upper],
  };
}
