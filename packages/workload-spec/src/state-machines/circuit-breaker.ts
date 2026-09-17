export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutUs: number;
  halfOpenSuccessThreshold?: number;
}

export class PureCircuitBreaker {
  readonly config: Required<CircuitBreakerConfig>;
  private _state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccessesInHalfOpen = 0;
  private openedAtUs = 0;

  constructor(config: CircuitBreakerConfig) {
    if (config.failureThreshold <= 0) {
      throw new Error('failureThreshold must be greater than 0');
    }
    if (config.resetTimeoutUs <= 0) {
      throw new Error('resetTimeoutUs must be greater than 0');
    }
    this.config = {
      failureThreshold: config.failureThreshold,
      resetTimeoutUs: config.resetTimeoutUs,
      halfOpenSuccessThreshold: config.halfOpenSuccessThreshold ?? 1,
    };
  }

  get state(): CircuitBreakerState {
    return this._state;
  }

  get consecutiveFailureCount(): number {
    return this.consecutiveFailures;
  }

  get lastOpenedAtUs(): number {
    return this.openedAtUs;
  }

  /**
   * Evaluates if a call can proceed at the given virtual time.
   * Purely deterministic with zero wall-clock timer dependencies.
   */
  canExecute(virtualTimeUs: number): boolean {
    if (this._state === 'CLOSED') {
      return true;
    }

    if (this._state === 'OPEN') {
      if (virtualTimeUs >= this.openedAtUs + this.config.resetTimeoutUs) {
        // Transition to HALF_OPEN
        this._state = 'HALF_OPEN';
        this.consecutiveSuccessesInHalfOpen = 0;
        return true;
      }
      return false;
    }

    if (this._state === 'HALF_OPEN') {
      // In HALF_OPEN, allow probe calls up to threshold
      return this.consecutiveSuccessesInHalfOpen < this.config.halfOpenSuccessThreshold;
    }

    return false;
  }

  /**
   * Records a successful execution at virtual time.
   */
  recordSuccess(_virtualTimeUs: number): void {
    if (this._state === 'CLOSED') {
      this.consecutiveFailures = 0;
      return;
    }

    if (this._state === 'HALF_OPEN') {
      this.consecutiveSuccessesInHalfOpen++;
      if (this.consecutiveSuccessesInHalfOpen >= this.config.halfOpenSuccessThreshold) {
        this._state = 'CLOSED';
        this.consecutiveFailures = 0;
        this.consecutiveSuccessesInHalfOpen = 0;
      }
    }
  }

  /**
   * Records a failed execution at virtual time.
   */
  recordFailure(virtualTimeUs: number): void {
    if (this._state === 'CLOSED') {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this._state = 'OPEN';
        this.openedAtUs = virtualTimeUs;
      }
      return;
    }

    if (this._state === 'HALF_OPEN') {
      // Any failure during HALF_OPEN immediately trips back to OPEN
      this._state = 'OPEN';
      this.openedAtUs = virtualTimeUs;
      this.consecutiveSuccessesInHalfOpen = 0;
    }
  }

  /**
   * Force reset to CLOSED state.
   */
  reset(): void {
    this._state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccessesInHalfOpen = 0;
    this.openedAtUs = 0;
  }
}
