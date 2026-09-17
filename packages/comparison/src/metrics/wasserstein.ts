/**
 * Computes 1-Wasserstein (Earth Mover's) Distance between two 1D empirical distributions.
 * Uses uniform quantile sampling to support differing sample sizes.
 */
export function computeWassersteinDistance(sample1: number[], sample2: number[], steps = 100): number {
  if (sample1.length === 0 || sample2.length === 0) {
    throw new Error('Samples must be non-empty for Wasserstein distance');
  }

  const s1 = sample1.slice().sort((a, b) => a - b);
  const s2 = sample2.slice().sort((a, b) => a - b);

  const getQuantile = (sorted: number[], q: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
  };

  let totalDiff = 0;
  for (let k = 0; k < steps; k++) {
    const q = (k + 0.5) / steps;
    const v1 = getQuantile(s1, q);
    const v2 = getQuantile(s2, q);
    totalDiff += Math.abs(v1 - v2);
  }

  return totalDiff / steps;
}
