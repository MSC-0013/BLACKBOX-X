import { SloConstraint, CapacitySearchResult } from '../types.js';
import { runBisectionSearch } from '../algorithms/bisection-search.js';
import { detectKneePoint } from '../algorithms/knee-point.js';
import { identifyBottleneck, ComponentResourceMetrics } from '../algorithms/bottleneck-finder.js';

export interface CapacitySearchConfig {
  minRps: number;
  maxRps: number;
  toleranceRps?: number;
  slo: SloConstraint;
  evaluator: (rps: number) => Promise<{
    p99Us: number;
    errorRate: number;
    components?: ComponentResourceMetrics[];
  }>;
}

export class CapacitySearchEngine {
  async search(config: CapacitySearchConfig): Promise<CapacitySearchResult> {
    let lastComponents: ComponentResourceMetrics[] | undefined;

    const bisectionResult = await runBisectionSearch({
      minRps: config.minRps,
      maxRps: config.maxRps,
      toleranceRps: config.toleranceRps ?? 10,
      slo: config.slo,
      evaluator: async (rps) => {
        const evalRes = await config.evaluator(rps);
        if (evalRes.components) {
          lastComponents = evalRes.components;
        }
        return { p99Us: evalRes.p99Us, errorRate: evalRes.errorRate };
      },
    });

    const kneePoint = detectKneePoint(
      bisectionResult.steps.map((s) => ({ rps: s.candidateRps, p99Us: s.p99Us })),
    );

    const bottleneck = lastComponents ? identifyBottleneck(lastComponents) : undefined;

    const sloSatisfied = bisectionResult.steps.some((s) => s.satisfiesSlo);

    return {
      maxSustainableRps: bisectionResult.maxSustainableRps,
      kneePoint,
      bottleneck,
      steps: bisectionResult.steps,
      sloSatisfied,
      strategy: bisectionResult.strategy,
      nonMonotonicDetected: bisectionResult.nonMonotonicDetected,
    };
  }
}
