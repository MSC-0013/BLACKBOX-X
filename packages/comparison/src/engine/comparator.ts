import { computeTwoSampleKsTest, KsTestResult } from '../metrics/ks-test.js';
import { computeQuantileRelativeErrors, QuantileErrors } from '../metrics/quantile-error.js';
import { computeWassersteinDistance } from '../metrics/wasserstein.js';

export type ComparisonVerdict = 'ALIGNED' | 'CALIBRATION_REQUIRED' | 'MISALIGNED';

export interface LatencyDistributionSummary {
  p50Us: number;
  p90Us: number;
  p95Us: number;
  p99Us: number;
  meanLatencyUs: number;
  samplesUs?: number[];
}

export interface ComparisonInput {
  simulated: LatencyDistributionSummary & {
    throughputRps: number;
    predictionInterval?: [number, number];
  };
  real: LatencyDistributionSummary & {
    throughputRps: number;
  };
}

export interface ComparisonReport {
  verdict: ComparisonVerdict;
  ksTest?: KsTestResult;
  quantileErrors: QuantileErrors;
  mape: number;
  wassersteinDistance?: number;
  predictionIntervalEnclosed: boolean;
  throughputComparison: {
    simulatedRps: number;
    realRps: number;
    relativeError: number;
  };
}

export class ComparisonEngine {
  /**
   * Compares simulated performance metrics with real benchmark measurements.
   */
  compare(input: ComparisonInput): ComparisonReport {
    const { simulated, real } = input;

    // 1. Quantile relative errors
    const { errors: quantileErrors, mape } = computeQuantileRelativeErrors(
      { p50: simulated.p50Us, p90: simulated.p90Us, p95: simulated.p95Us, p99: simulated.p99Us },
      { p50: real.p50Us, p90: real.p90Us, p95: real.p95Us, p99: real.p99Us },
    );

    // 2. Throughput comparison
    const throughputError = real.throughputRps > 0
      ? Math.abs(simulated.throughputRps - real.throughputRps) / real.throughputRps
      : 0;

    // 3. KS Test & Wasserstein Distance (if sample arrays provided)
    let ksTest: KsTestResult | undefined;
    let wassersteinDistance: number | undefined;

    if (simulated.samplesUs && simulated.samplesUs.length > 0 && real.samplesUs && real.samplesUs.length > 0) {
      ksTest = computeTwoSampleKsTest(simulated.samplesUs, real.samplesUs);
      wassersteinDistance = computeWassersteinDistance(simulated.samplesUs, real.samplesUs);
    }

    // 4. Prediction Interval coverage
    let predictionIntervalEnclosed = true;
    if (simulated.predictionInterval) {
      const [lower, upper] = simulated.predictionInterval;
      predictionIntervalEnclosed = real.p50Us >= lower && real.p50Us <= upper;
    }

    // 5. Verdict synthesis
    //
    // KS test escalation uses a *practically meaningful* statistic threshold (> 0.20) in
    // addition to the formal alpha=0.05 rejection flag.  With large N (≥ 400) the KS
    // critical value is ~0.096, so even minor OS-timer jitter or GC pauses between two
    // sequential benchmark runs produces `rejectNull = true` while MAPE remains well
    // within the ≤ 15% engineering tolerance.  Requiring statistic > 0.20 ensures the
    // KS criterion only fires when the distributional shift is practically significant
    // (≈ 20% of the CDF range differs), consistent with the calibration SLA.
    const ksEscalation = ksTest && ksTest.rejectNull && ksTest.statistic > 0.20;
    const ksMisaligned   = ksTest && ksTest.statistic > 0.35 && ksTest.rejectNull;

    let verdict: ComparisonVerdict = 'ALIGNED';
    if (mape > 0.35 || ksMisaligned || !predictionIntervalEnclosed) {
      verdict = 'MISALIGNED';
    } else if (mape > 0.15 || ksEscalation) {
      verdict = 'CALIBRATION_REQUIRED';
    }

    return {
      verdict,
      ksTest,
      quantileErrors,
      mape,
      wassersteinDistance,
      predictionIntervalEnclosed,
      throughputComparison: {
        simulatedRps: simulated.throughputRps,
        realRps: real.throughputRps,
        relativeError: throughputError,
      },
    };
  }
}
