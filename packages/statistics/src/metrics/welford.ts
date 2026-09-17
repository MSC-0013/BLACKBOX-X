export class WelfordStats {
  private n = 0;
  private m = 0;
  private s = 0;

  get count(): number {
    return this.n;
  }

  get mean(): number {
    return this.m;
  }

  get variance(): number {
    return this.n > 1 ? this.s / (this.n - 1) : 0;
  }

  get standardDeviation(): number {
    return Math.sqrt(this.variance);
  }

  update(x: number): void {
    this.n++;
    const delta = x - this.m;
    this.m += delta / this.n;
    const delta2 = x - this.m;
    this.s += delta * delta2;
  }

  merge(other: WelfordStats): void {
    if (other.n === 0) return;
    if (this.n === 0) {
      this.n = other.n;
      this.m = other.m;
      this.s = other.s;
      return;
    }

    const newN = this.n + other.n;
    const delta = other.m - this.m;
    this.m += (delta * other.n) / newN;
    this.s += other.s + (delta * delta * this.n * other.n) / newN;
    this.n = newN;
  }
}

export const WelfordAccumulator = WelfordStats;
export type WelfordAccumulator = WelfordStats;
