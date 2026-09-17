import { KneePointResult } from '../types.js';

/**
 * Detects the performance knee-point using the Kneedle algorithm (maximum distance to chord).
 */
export function detectKneePoint(points: { rps: number; p99Us: number }[]): KneePointResult | undefined {
  if (points.length < 3) {
    return undefined;
  }

  const sorted = points.slice().sort((a, b) => a.rps - b.rps);

  const minX = sorted[0].rps;
  const maxX = sorted[sorted.length - 1].rps;
  const minY = sorted[0].p99Us;
  const maxY = sorted[sorted.length - 1].p99Us;

  if (maxX === minX || maxY === minY) {
    return undefined;
  }

  // Normalized coordinates [0, 1]
  const normalized = sorted.map((p) => ({
    orig: p,
    nx: (p.rps - minX) / (maxX - minX),
    ny: (p.p99Us - minY) / (maxY - minY),
  }));

  // Line from first (0,0) to last (1,1) has equation: nx - ny = 0
  // Distance from point (x0, y0) to line x - y = 0 is |x0 - y0| / sqrt(2)
  let maxDist = -1;
  let kneeIdx = 0;

  for (let i = 1; i < normalized.length - 1; i++) {
    const p = normalized[i];
    // In queueing curves, latency bends upward, so ny > nx
    const dist = Math.abs(p.ny - p.nx);
    if (dist > maxDist) {
      maxDist = dist;
      kneeIdx = i;
    }
  }

  const kneePoint = sorted[kneeIdx];
  return {
    kneeRps: kneePoint.rps,
    curvature: maxDist,
    latencyAtKneeUs: kneePoint.p99Us,
  };
}
