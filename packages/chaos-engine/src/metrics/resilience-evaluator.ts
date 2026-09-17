import type { ResilienceMetrics } from '../types.js';

export class ResilienceEvaluator {
  static evaluate(params: {
    blastRadius: number;
    cascadeDetected: boolean;
    totalRequests: number;
    failedRequests: number;
    degradedRequests: number;
    fallbackRequests: number;
    faultDurationUs: number;
    recoveryTimeUs: number;
  }): ResilienceMetrics {
    const {
      blastRadius,
      cascadeDetected,
      totalRequests,
      failedRequests,
      degradedRequests,
      fallbackRequests,
      recoveryTimeUs,
    } = params;

    let resilienceScore = 100;
    if (totalRequests > 0) {
      // Degraded calls penalize at 50% weight; outright failures penalize at 100% weight
      // Fallback calls soften the penalty (successful fallback counts as partial survival)
      const effectiveLoss = failedRequests + 0.5 * degradedRequests - 0.25 * fallbackRequests;
      const unconstrainedScore = 100 * (1 - Math.max(0, effectiveLoss) / totalRequests);
      resilienceScore = Math.max(0, Math.min(100, Math.round(unconstrainedScore * 100) / 100));
    }

    const mttrMs = recoveryTimeUs / 1000;

    return {
      resilienceScore,
      blastRadius,
      mttrMs,
      cascadeDetected,
      totalRequests,
      failedRequests,
      degradedRequests,
      fallbackRequests,
    };
  }
}
