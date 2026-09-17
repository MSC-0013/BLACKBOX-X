import { EventQueue, SimEvent } from '../events/event-queue.js';
import { CanonicalStateHasher } from '../hashing/canonical-hasher.js';

export type SimEventHandler = (event: SimEvent, kernel: SimulationKernel) => void;

export interface KernelCheckpoint {
  virtualTimeUs: number;
  processedCount: number;
  canonicalHash: string;
  queueState: { nextSequence: string; events: SimEvent[] };
}

export class SimulationKernel {
  readonly queue: EventQueue;
  readonly hasher: CanonicalStateHasher;
  private _virtualTimeUs = 0;
  private _processedCount = 0;
  private handlers = new Map<string, SimEventHandler>();

  constructor(initialHashSeed?: string) {
    this.queue = new EventQueue();
    this.hasher = new CanonicalStateHasher(initialHashSeed);
  }

  get virtualTimeUs(): number {
    return this._virtualTimeUs;
  }

  get processedEvents(): number {
    return this._processedCount;
  }

  get canonicalHash(): string {
    return this.hasher.getHash();
  }

  registerHandler(eventType: string, handler: SimEventHandler): void {
    this.handlers.set(eventType, handler);
  }

  schedule(timeUs: number, eventType: string, payload: unknown, priority = 0): SimEvent {
    if (timeUs < this._virtualTimeUs) {
      throw new Error(
        `Cannot schedule event in the past. Current virtual time: ${this._virtualTimeUs}us, attempted: ${timeUs}us`,
      );
    }
    return this.queue.push(timeUs, eventType, payload, priority);
  }

  scheduleIn(delayUs: number, eventType: string, payload: unknown, priority = 0): SimEvent {
    if (delayUs < 0) {
      throw new Error(`Negative delay ${delayUs}us not permitted`);
    }
    return this.schedule(this._virtualTimeUs + delayUs, eventType, payload, priority);
  }

  step(): boolean {
    const event = this.queue.pop();
    if (!event) return false;

    if (event.timeUs < this._virtualTimeUs) {
      throw new Error(
        `Time monotonicity violation: popped event at ${event.timeUs}us when clock is at ${this._virtualTimeUs}us`,
      );
    }

    this._virtualTimeUs = event.timeUs;
    this.hasher.update(this._virtualTimeUs, event.type, event.payload);

    const handler = this.handlers.get(event.type);
    if (handler) {
      handler(event, this);
    }

    this._processedCount++;
    return true;
  }

  runUntil(maxTimeUs: number, maxEvents?: number): { finished: boolean; reachedTimeLimit: boolean } {
    while (!this.queue.isEmpty) {
      const next = this.queue.peek();
      if (!next || next.timeUs > maxTimeUs) {
        return { finished: false, reachedTimeLimit: true };
      }

      if (maxEvents !== undefined && this._processedCount >= maxEvents) {
        return { finished: false, reachedTimeLimit: false };
      }

      this.step();
    }
    return { finished: true, reachedTimeLimit: false };
  }

  createCheckpoint(): KernelCheckpoint {
    return {
      virtualTimeUs: this._virtualTimeUs,
      processedCount: this._processedCount,
      canonicalHash: this.hasher.getHash(),
      queueState: this.queue.serializeState(),
    };
  }

  resumeCheckpoint(checkpoint: KernelCheckpoint): void {
    this._virtualTimeUs = checkpoint.virtualTimeUs;
    this._processedCount = checkpoint.processedCount;
    this.hasher.restore(checkpoint.canonicalHash);
    this.queue.restoreState(checkpoint.queueState);
  }

  reset(): void {
    this._virtualTimeUs = 0;
    this._processedCount = 0;
    this.hasher.restore('0000000000000000000000000000000000000000000000000000000000000000');
    while (!this.queue.isEmpty) {
      this.queue.pop();
    }
  }
}
