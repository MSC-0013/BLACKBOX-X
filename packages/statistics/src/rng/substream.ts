const MASK_64 = 0xffffffffffffffffn;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

export class SubStream {
  readonly name: string;
  readonly initialSeed: bigint;
  private state: bigint;
  private draws = 0;

  constructor(name: string, seed: bigint) {
    this.name = name;
    this.initialSeed = seed;
    this.state = seed === 0n ? 0x9e3779b97f4a7c15n : seed & MASK_64;
  }

  get drawCount(): number {
    return this.draws;
  }

  /**
   * SplitMix64 generator producing a 64-bit unsigned integer.
   */
  nextUint64(): bigint {
    this.draws++;
    this.state = (this.state + GOLDEN_GAMMA) & MASK_64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    return (z ^ (z >> 31n)) & MASK_64;
  }

  /**
   * Generates a 32-bit unsigned integer [0, 4294967295].
   */
  nextUint32(): number {
    const val64 = this.nextUint64();
    return Number((val64 >> 32n) & 0xffffffffn);
  }

  /**
   * Generates a uniform float in range [0, 1).
   */
  nextFloat01(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Generates an integer in range [min, max] inclusive.
   */
  nextIntRange(min: number, max: number): number {
    if (min >= max) return min;
    const range = max - min + 1;
    return min + (this.nextUint32() % range);
  }

  /**
   * Generates an exponential random variate with rate parameter lambda.
   * Expected mean is 1 / lambda.
   */
  nextExponential(lambda: number): number {
    if (lambda <= 0) {
      throw new Error(`Lambda must be positive, got ${lambda}`);
    }
    let u = this.nextFloat01();
    while (u === 0 || u >= 1) {
      u = this.nextFloat01();
    }
    return -Math.log(1 - u) / lambda;
  }

  /**
   * Generates an exponential inter-arrival time in integer microseconds.
   */
  nextExponentialUs(lambdaRps: number): number {
    const seconds = this.nextExponential(lambdaRps);
    return Math.max(1, Math.round(seconds * 1_000_000));
  }
}
