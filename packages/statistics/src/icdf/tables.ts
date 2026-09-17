export interface ICDFTable {
  readonly name: string;
  readonly algorithmVersion: string;
  readonly tableVersion: string;
  readonly size: number;
  sample(p: number): number;
  getBuckets(): Int32Array;
}

/**
 * Standard Normal inverse CDF approximation (Acklam's algorithm).
 */
export function standardNormalInvCdf(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

export function createNormalICDFTable(
  meanUs: number,
  stdDevUs: number,
  minUs = 1,
  size = 4096,
): ICDFTable {
  const buckets = new Int32Array(size);

  for (let i = 0; i < size; i++) {
    const p = (i + 0.5) / size;
    const z = standardNormalInvCdf(p);
    const val = Math.round(meanUs + z * stdDevUs);
    buckets[i] = Math.max(minUs, val);
  }

  return {
    name: `normal_${meanUs}_${stdDevUs}`,
    algorithmVersion: 'acklam.v1',
    tableVersion: 'table.v1',
    size,
    sample(p: number): number {
      const idx = Math.min(size - 1, Math.max(0, Math.floor(p * size)));
      return buckets[idx]!;
    },
    getBuckets(): Int32Array {
      return buckets;
    },
  };
}

export function createLognormalICDFTable(
  medianUs: number,
  sigma: number,
  minUs = 1,
  size = 4096,
): ICDFTable {
  const mu = Math.log(medianUs);
  const buckets = new Int32Array(size);

  for (let i = 0; i < size; i++) {
    const p = (i + 0.5) / size;
    const z = standardNormalInvCdf(p);
    const val = Math.round(Math.exp(mu + z * sigma));
    buckets[i] = Math.max(minUs, val);
  }

  return {
    name: `lognormal_${medianUs}_${sigma}`,
    algorithmVersion: 'acklam_lognormal.v1',
    tableVersion: 'table.v1',
    size,
    sample(p: number): number {
      const idx = Math.min(size - 1, Math.max(0, Math.floor(p * size)));
      return buckets[idx]!;
    },
    getBuckets(): Int32Array {
      return buckets;
    },
  };
}
