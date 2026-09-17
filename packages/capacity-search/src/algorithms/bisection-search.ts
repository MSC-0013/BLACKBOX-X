import { SloConstraint, CapacitySearchStep } from '../types.js';

export interface BisectionSearchOptions {
  minRps: number;
  maxRps: number;
  toleranceRps?: number;
  maxIterations?: number;
  slo: SloConstraint;
  evaluator: (rps: number) => Promise<{ p99Us: number; errorRate: number }>;
}

export async function runBisectionSearch(options: BisectionSearchOptions): Promise<{
  maxSustainableRps: number;
  steps: CapacitySearchStep[];
  nonMonotonicDetected: boolean;
}> {
  const {
    minRps,
    maxRps,
    toleranceRps = 10,
    maxIterations = 20,
    slo,
    evaluator,
  } = options;

  let low = minRps;
  let high = maxRps;
  let bestSustainable = minRps;
  const steps: CapacitySearchStep[] = [];
  let nonMonotonicDetected = false;

  let iteration = 0;
  while (high - low > toleranceRps && iteration < maxIterations) {
    iteration++;
    const mid = Math.round((low + high) / 2);
    const { p99Us, errorRate } = await evaluator(mid);

    const satisfiesSlo = p99Us <= slo.maxP99Us && errorRate <= slo.maxErrorRate;

    // Check monotonicity against previous steps
    if (steps.length > 0) {
      const prev = steps[steps.length - 1];
      if (mid > prev.candidateRps && errorRate > prev.errorRate && p99Us < prev.p99Us) {
        // High error rate dropped latency via load-shedding
        nonMonotonicDetected = true;
      }
    }

    steps.push({
      stepIndex: iteration,
      candidateRps: mid,
      p99Us,
      errorRate,
      satisfiesSlo,
    });

    if (satisfiesSlo) {
      bestSustainable = mid;
      low = mid; // Try higher load
    } else {
      high = mid; // Back off
    }
  }

  return {
    maxSustainableRps: bestSustainable,
    steps,
    nonMonotonicDetected,
  };
}
