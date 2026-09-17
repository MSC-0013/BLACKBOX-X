import { SloConstraint, CapacitySearchStep, SearchStrategy } from '../types.js';

export interface BisectionSearchOptions {
  minRps: number;
  maxRps: number;
  toleranceRps?: number;
  maxIterations?: number;
  slo: SloConstraint;
  evaluator: (rps: number) => Promise<{ p99Us: number; errorRate: number }>;
  enableMonotonicityCheck?: boolean;
}

export async function runBisectionSearch(options: BisectionSearchOptions): Promise<{
  maxSustainableRps: number;
  steps: CapacitySearchStep[];
  nonMonotonicDetected: boolean;
  strategy: SearchStrategy;
}> {
  const {
    minRps,
    maxRps,
    toleranceRps = 10,
    maxIterations = 20,
    slo,
    evaluator,
    enableMonotonicityCheck = true,
  } = options;

  const steps: CapacitySearchStep[] = [];
  let nonMonotonicDetected = false;
  let strategy: SearchStrategy = 'BISECTION';
  void strategy; // strategy is mutated then returned via ADAPTIVE_SWEEP branch or final return

  // 1. Coarse monotonicity pre-check across intervals if enabled
  if (enableMonotonicityCheck && maxRps > minRps + 100) {
    const probePoints = [
      minRps,
      Math.round(minRps + (maxRps - minRps) * 0.33),
      Math.round(minRps + (maxRps - minRps) * 0.66),
      maxRps,
    ];

    const probeResults: Array<{ rps: number; p99Us: number; errorRate: number; satisfiesSlo: boolean }> = [];
    for (const probeRps of probePoints) {
      const { p99Us, errorRate } = await evaluator(probeRps);
      const satisfiesSlo = p99Us <= slo.maxP99Us && errorRate <= slo.maxErrorRate;
      probeResults.push({ rps: probeRps, p99Us, errorRate, satisfiesSlo });
      steps.push({
        stepIndex: steps.length + 1,
        candidateRps: probeRps,
        p99Us,
        errorRate,
        satisfiesSlo,
      });
    }

    // Detect non-monotonicity: e.g. lower point breaches SLO but higher point passes,
    // or error rate spikes while latency collapses (load shedding)
    for (let i = 1; i < probeResults.length; i++) {
      const prev = probeResults[i - 1]!;
      const curr = probeResults[i]!;
      if (!prev.satisfiesSlo && curr.satisfiesSlo) {
        nonMonotonicDetected = true;
      }
      if (curr.errorRate > prev.errorRate && curr.p99Us < prev.p99Us) {
        nonMonotonicDetected = true;
      }
    }

    if (nonMonotonicDetected) {
      strategy = 'ADAPTIVE_SWEEP';
      // Fallback to adaptive sweep from minRps upward with fine steps to find safe boundary
      let bestRps = minRps;
      const stepSize = Math.max(10, Math.round((maxRps - minRps) / 10));
      for (let cand = minRps + stepSize; cand <= maxRps; cand += stepSize) {
        const { p99Us, errorRate } = await evaluator(cand);
        const satisfies = p99Us <= slo.maxP99Us && errorRate <= slo.maxErrorRate;
        steps.push({
          stepIndex: steps.length + 1,
          candidateRps: cand,
          p99Us,
          errorRate,
          satisfiesSlo: satisfies,
        });
        if (satisfies) {
          bestRps = cand;
        } else {
          break; // Stop at first failing boundary
        }
      }
      return {
        maxSustainableRps: bestRps,
        steps,
        nonMonotonicDetected: true,
        strategy: 'ADAPTIVE_SWEEP',
      };
    }
  }

  // 2. Standard Monotonic Bisection Search
  let low = minRps;
  let high = maxRps;
  let bestSustainable = minRps;

  let iteration = 0;
  while (high - low > toleranceRps && iteration < maxIterations) {
    iteration++;
    const mid = Math.round((low + high) / 2);
    const { p99Us, errorRate } = await evaluator(mid);

    const satisfiesSlo = p99Us <= slo.maxP99Us && errorRate <= slo.maxErrorRate;

    // Check monotonicity against previous steps
    if (steps.length > 0) {
      const prev = steps[steps.length - 1]!;
      if (mid > prev.candidateRps && errorRate > prev.errorRate && p99Us < prev.p99Us) {
        nonMonotonicDetected = true;
      }
    }

    steps.push({
      stepIndex: steps.length + 1,
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
    strategy: 'BISECTION',
  };
}
