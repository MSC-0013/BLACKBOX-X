export interface LittlesLawResult {
  expectedL: number;
  observedL: number;
  relativeError: number;
  satisfies: boolean;
}

/**
 * Verifies Little's Law (L ≈ λ * W) over a steady-state measurement window.
 *
 * @param observedL Observed average concurrency / queue length
 * @param lambdaRps Arrival rate in requests per second
 * @param meanWaitTimeSec Mean time spent in system (latency) in seconds
 * @param tolerancePercent Acceptable relative error threshold (default 0.05 for 5%)
 */
export function verifyLittlesLaw(
  observedL: number,
  lambdaRps: number,
  meanWaitTimeSec: number,
  tolerancePercent = 0.05,
): LittlesLawResult {
  const expectedL = lambdaRps * meanWaitTimeSec;
  const denominator = observedL === 0 ? 1 : observedL;
  const relativeError = Math.abs(observedL - expectedL) / denominator;
  const satisfies = relativeError <= tolerancePercent;

  return {
    expectedL,
    observedL,
    relativeError,
    satisfies,
  };
}
