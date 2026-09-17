export interface CpuConfig {
  cores: number;
}

export class CpuResource {
  readonly cores: number;
  private activeTasks = 0;
  private peakConcurrent = 0;

  constructor(config: CpuConfig) {
    if (config.cores <= 0) {
      throw new Error('Cpu cores must be strictly positive');
    }
    this.cores = config.cores;
  }

  get currentActiveTasks(): number {
    return this.activeTasks;
  }

  get peakActiveTasks(): number {
    return this.peakConcurrent;
  }

  /**
   * Calculates execution duration under processor-sharing concurrency.
   * If concurrency exceeds core count, duration stretches proportionally.
   */
  calculateExecutionDurationUs(baseDurationUs: number): number {
    const concurrency = Math.max(1, this.activeTasks);
    const stretch = concurrency > this.cores ? concurrency / this.cores : 1.0;
    return Math.round(baseDurationUs * stretch);
  }

  acquire(): void {
    this.activeTasks++;
    if (this.activeTasks > this.peakConcurrent) {
      this.peakConcurrent = this.activeTasks;
    }
  }

  release(): void {
    if (this.activeTasks > 0) {
      this.activeTasks--;
    }
  }

  reset(): void {
    this.activeTasks = 0;
    this.peakConcurrent = 0;
  }
}
