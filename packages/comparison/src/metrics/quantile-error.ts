export interface QuantileErrors {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export function computeQuantileRelativeErrors(
  simQuantiles: { p50: number; p90: number; p95: number; p99: number },
  realQuantiles: { p50: number; p90: number; p95: number; p99: number },
): { errors: QuantileErrors; mape: number } {
  const computeErr = (sim: number, real: number) => {
    if (real === 0) return sim === 0 ? 0 : 1.0;
    return Math.abs(sim - real) / real;
  };

  const p50 = computeErr(simQuantiles.p50, realQuantiles.p50);
  const p90 = computeErr(simQuantiles.p90, realQuantiles.p90);
  const p95 = computeErr(simQuantiles.p95, realQuantiles.p95);
  const p99 = computeErr(simQuantiles.p99, realQuantiles.p99);

  const mape = (p50 + p90 + p95 + p99) / 4;

  return {
    errors: { p50, p90, p95, p99 },
    mape,
  };
}
