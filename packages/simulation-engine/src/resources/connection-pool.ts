export type ConnectionAcquireResult = 'ACQUIRED' | 'WAITING' | 'EXHAUSTED';

export interface ConnectionPoolConfig {
  maxConnections: number;
  maxWaiters?: number;
}

export class ConnectionPoolResource {
  readonly maxConnections: number;
  readonly maxWaiters: number;
  private activeConnections = 0;
  private waitingWaiters = 0;
  private totalAcquisitions = 0;
  private totalExhausted = 0;

  constructor(config: ConnectionPoolConfig) {
    if (config.maxConnections <= 0) {
      throw new Error('maxConnections must be strictly positive');
    }
    this.maxConnections = config.maxConnections;
    this.maxWaiters = config.maxWaiters ?? 100;
  }

  get active(): number {
    return this.activeConnections;
  }

  get waiting(): number {
    return this.waitingWaiters;
  }

  get totalAcquired(): number {
    return this.totalAcquisitions;
  }

  get totalRejected(): number {
    return this.totalExhausted;
  }

  tryAcquire(): ConnectionAcquireResult {
    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      this.totalAcquisitions++;
      return 'ACQUIRED';
    }

    if (this.waitingWaiters < this.maxWaiters) {
      this.waitingWaiters++;
      return 'WAITING';
    }

    this.totalExhausted++;
    return 'EXHAUSTED';
  }

  release(): { unblockedWaiter: boolean } {
    if (this.waitingWaiters > 0) {
      this.waitingWaiters--;
      this.totalAcquisitions++;
      return { unblockedWaiter: true };
    }

    if (this.activeConnections > 0) {
      this.activeConnections--;
    }
    return { unblockedWaiter: false };
  }

  reset(): void {
    this.activeConnections = 0;
    this.waitingWaiters = 0;
    this.totalAcquisitions = 0;
    this.totalExhausted = 0;
  }
}
