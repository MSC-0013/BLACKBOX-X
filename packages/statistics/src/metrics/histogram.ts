const GAMMA = 1.02;
const BUCKET_COUNT = 512;
const LOG_GAMMA = Math.log(GAMMA);

const BOUNDARIES_US: Int32Array = (() => {
  const b = new Int32Array(BUCKET_COUNT + 1);
  b[0] = 0;
  for (let i = 1; i <= BUCKET_COUNT; i++) {
    b[i] = Math.round(Math.pow(GAMMA, i - 1));
  }
  return b;
})();

export class LogLinearHistogram {
  private readonly counts: Int32Array;
  private total = 0;
  private minUs = Number.MAX_SAFE_INTEGER;
  private maxUs = 0;

  constructor(counts?: Int32Array) {
    if (counts) {
      if (counts.length !== BUCKET_COUNT) {
        throw new Error(`Histogram must have ${BUCKET_COUNT} buckets, got ${counts.length}`);
      }
      this.counts = Int32Array.from(counts);
      for (let i = 0; i < BUCKET_COUNT; i++) {
        const c = this.counts[i]!;
        if (c > 0) {
          this.total += c;
          const low = BOUNDARIES_US[i]!;
          const high = BOUNDARIES_US[i + 1]!;
          if (low < this.minUs) this.minUs = low;
          if (high > this.maxUs) this.maxUs = high;
        }
      }
      if (this.total === 0) {
        this.minUs = 0;
      }
    } else {
      this.counts = new Int32Array(BUCKET_COUNT);
    }
  }

  get count(): number {
    return this.total;
  }

  get min(): number {
    return this.total === 0 ? 0 : this.minUs;
  }

  get max(): number {
    return this.maxUs;
  }

  record(valUs: number): void {
    if (valUs < 0) return;
    this.total++;
    if (valUs < this.minUs) this.minUs = valUs;
    if (valUs > this.maxUs) this.maxUs = valUs;

    let bucketIdx = 0;
    if (valUs > 1) {
      bucketIdx = Math.floor(Math.log(valUs) / LOG_GAMMA) + 1;
      if (bucketIdx >= BUCKET_COUNT) {
        bucketIdx = BUCKET_COUNT - 1;
      }
    }
    this.counts[bucketIdx]++;
  }

  quantile(q: number): number {
    if (this.total === 0) return 0;
    if (q <= 0) return this.min;
    if (q >= 1) return this.max;

    const rank = Math.ceil(q * this.total);
    let running = 0;

    for (let i = 0; i < BUCKET_COUNT; i++) {
      running += this.counts[i]!;
      if (running >= rank) {
        const low = BOUNDARIES_US[i]!;
        const high = BOUNDARIES_US[i + 1]!;
        return Math.round((low + high) / 2);
      }
    }

    return this.max;
  }

  p50(): number {
    return this.quantile(0.5);
  }

  p90(): number {
    return this.quantile(0.9);
  }

  p95(): number {
    return this.quantile(0.95);
  }

  p99(): number {
    return this.quantile(0.99);
  }

  merge(other: LogLinearHistogram): void {
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.counts[i] += other.counts[i]!;
    }
    this.total += other.total;
    if (other.minUs < this.minUs) this.minUs = other.minUs;
    if (other.maxUs > this.maxUs) this.maxUs = other.maxUs;
  }

  getRawCounts(): Int32Array {
    return this.counts;
  }
}
