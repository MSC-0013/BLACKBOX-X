export interface KsTestResult {
  statistic: number;
  criticalValue: number;
  rejectNull: boolean; // true if distributions are significantly different at alpha = 0.05
}

/**
 * Computes two-sample Kolmogorov-Smirnov test statistic D between two sample arrays.
 * D = max |F1(x) - F2(x)|
 */
export function computeTwoSampleKsTest(sample1: number[], sample2: number[], alpha = 0.05): KsTestResult {
  if (sample1.length === 0 || sample2.length === 0) {
    throw new Error('Samples must be non-empty for KS test');
  }

  const s1 = sample1.slice().sort((a, b) => a - b);
  const s2 = sample2.slice().sort((a, b) => a - b);

  const n1 = s1.length;
  const n2 = s2.length;

  let i = 0;
  let j = 0;
  let dMax = 0;

  while (i < n1 && j < n2) {
    const v1 = s1[i];
    const v2 = s2[j];

    if (v1 <= v2) {
      i++;
    }
    if (v2 <= v1) {
      j++;
    }

    const cdf1 = i / n1;
    const cdf2 = j / n2;
    const diff = Math.abs(cdf1 - cdf2);
    if (diff > dMax) {
      dMax = diff;
    }
  }

  // Handle remaining elements
  while (i < n1) {
    i++;
    const diff = Math.abs(i / n1 - 1.0);
    if (diff > dMax) dMax = diff;
  }
  while (j < n2) {
    j++;
    const diff = Math.abs(1.0 - j / n2);
    if (diff > dMax) dMax = diff;
  }

  // Critical value for two-sample KS test: c(alpha) * sqrt((n1 + n2) / (n1 * n2))
  // c(0.05) = 1.358, c(0.01) = 1.628
  const cAlpha = alpha === 0.01 ? 1.628 : 1.358;
  const criticalValue = cAlpha * Math.sqrt((n1 + n2) / (n1 * n2));

  return {
    statistic: dMax,
    criticalValue,
    rejectNull: dMax > criticalValue,
  };
}
