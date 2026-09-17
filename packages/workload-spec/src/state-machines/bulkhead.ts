export type BulkheadAcquireResult = 'EXECUTING' | 'QUEUED' | 'REJECTED';

export interface BulkheadConfig {
  maxConcurrent: number;
  maxQueueCapacity: number;
}

export class PureBulkhead {
  readonly config: BulkheadConfig;
  private _activeCount = 0;
  private _queueCount = 0;
  private _totalAcquired = 0;
  private _totalQueued = 0;
  private _totalRejected = 0;
  private _totalCompleted = 0;

  constructor(config: BulkheadConfig) {
    if (config.maxConcurrent <= 0) {
      throw new Error('maxConcurrent must be greater than 0');
    }
    if (config.maxQueueCapacity < 0) {
      throw new Error('maxQueueCapacity cannot be negative');
    }
    this.config = { ...config };
  }

  get activeCount(): number {
    return this._activeCount;
  }

  get queueCount(): number {
    return this._queueCount;
  }

  get totalAcquired(): number {
    return this._totalAcquired;
  }

  get totalQueued(): number {
    return this._totalQueued;
  }

  get totalRejected(): number {
    return this._totalRejected;
  }

  get totalCompleted(): number {
    return this._totalCompleted;
  }

  get isSaturated(): boolean {
    return this._activeCount >= this.config.maxConcurrent;
  }

  get isQueueFull(): boolean {
    return this._queueCount >= this.config.maxQueueCapacity;
  }

  /**
   * Attempts to acquire execution or queueing capacity.
   */
  tryAcquire(): BulkheadAcquireResult {
    if (this._activeCount < this.config.maxConcurrent) {
      this._activeCount++;
      this._totalAcquired++;
      return 'EXECUTING';
    }

    if (this._queueCount < this.config.maxQueueCapacity) {
      this._queueCount++;
      this._totalQueued++;
      return 'QUEUED';
    }

    this._totalRejected++;
    return 'REJECTED';
  }

  /**
   * Releases an execution slot. If tasks are queued, promotes one to execution.
   */
  release(): void {
    this._totalCompleted++;
    if (this._queueCount > 0) {
      this._queueCount--;
      // Active count stays saturated because the queued item immediately takes the slot
    } else if (this._activeCount > 0) {
      this._activeCount--;
    }
  }

  /**
   * Drops a request that timed out while waiting in queue.
   */
  cancelQueued(): boolean {
    if (this._queueCount > 0) {
      this._queueCount--;
      return true;
    }
    return false;
  }

  /**
   * Resets all internal counters.
   */
  reset(): void {
    this._activeCount = 0;
    this._queueCount = 0;
    this._totalAcquired = 0;
    this._totalQueued = 0;
    this._totalRejected = 0;
    this._totalCompleted = 0;
  }
}
