export type ThreadPoolAcquireResult = 'IMMEDIATE' | 'QUEUED' | 'REJECTED';

export interface ThreadPoolConfig {
  workerCount: number;
  queueCapacity: number;
}

export class ThreadPoolResource {
  readonly workerCount: number;
  readonly queueCapacity: number;
  private activeWorkers = 0;
  private queuedTasks = 0;
  private totalExecuted = 0;
  private totalRejected = 0;

  constructor(config: ThreadPoolConfig) {
    if (config.workerCount <= 0) {
      throw new Error('workerCount must be strictly positive');
    }
    if (config.queueCapacity < 0) {
      throw new Error('queueCapacity cannot be negative');
    }
    this.workerCount = config.workerCount;
    this.queueCapacity = config.queueCapacity;
  }

  get currentActive(): number {
    return this.activeWorkers;
  }

  get currentQueued(): number {
    return this.queuedTasks;
  }

  get rejectedCount(): number {
    return this.totalRejected;
  }

  get executedCount(): number {
    return this.totalExecuted;
  }

  tryAcquire(): ThreadPoolAcquireResult {
    if (this.activeWorkers < this.workerCount) {
      this.activeWorkers++;
      this.totalExecuted++;
      return 'IMMEDIATE';
    }

    if (this.queuedTasks < this.queueCapacity) {
      this.queuedTasks++;
      return 'QUEUED';
    }

    this.totalRejected++;
    return 'REJECTED';
  }

  release(): { promotedFromQueue: boolean } {
    if (this.queuedTasks > 0) {
      this.queuedTasks--;
      this.totalExecuted++;
      return { promotedFromQueue: true };
    }

    if (this.activeWorkers > 0) {
      this.activeWorkers--;
    }
    return { promotedFromQueue: false };
  }

  reset(): void {
    this.activeWorkers = 0;
    this.queuedTasks = 0;
    this.totalExecuted = 0;
    this.totalRejected = 0;
  }
}
