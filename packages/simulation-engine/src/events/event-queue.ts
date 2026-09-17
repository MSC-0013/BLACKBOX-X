export interface SimEvent<T = unknown> {
  id: string;
  timeUs: number;
  priority: number; // lower number = higher priority
  sequenceNum: bigint; // strict deterministic tie-breaker
  type: string;
  payload: T;
  cancelled?: boolean;
}

export class EventQueue {
  private heap: SimEvent[] = [];
  private eventIndexMap = new Map<string, number>();
  private nextSequenceNum = 0n;

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Pushes a new simulation event into the priority queue.
   */
  push<T>(
    timeUs: number,
    type: string,
    payload: T,
    priority = 0,
    customId?: string,
  ): SimEvent<T> {
    const sequenceNum = this.nextSequenceNum++;
    const event: SimEvent<T> = {
      id: customId ?? `ev_${sequenceNum}_${timeUs}`,
      timeUs,
      priority,
      sequenceNum,
      type,
      payload,
      cancelled: false,
    };

    this.heap.push(event);
    const index = this.heap.length - 1;
    this.eventIndexMap.set(event.id, index);
    this.siftUp(index);

    return event;
  }

  /**
   * Peeks at the next upcoming event without removing it.
   */
  peek(): SimEvent | undefined {
    this.pruneCancelled();
    return this.heap[0];
  }

  /**
   * Pops and returns the next earliest simulation event.
   */
  pop(): SimEvent | undefined {
    this.pruneCancelled();
    if (this.heap.length === 0) return undefined;

    const root = this.heap[0];
    this.eventIndexMap.delete(root.id);

    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.eventIndexMap.set(last.id, 0);
      this.siftDown(0);
    }

    return root;
  }

  /**
   * Marks an event as cancelled. Cancelled events are skipped on pop.
   */
  cancel(eventId: string): boolean {
    const idx = this.eventIndexMap.get(eventId);
    if (idx !== undefined && idx < this.heap.length) {
      const ev = this.heap[idx];
      if (ev.id === eventId && !ev.cancelled) {
        ev.cancelled = true;
        return true;
      }
    }
    return false;
  }

  /**
   * Serializes the queue state for snapshotting.
   */
  serializeState(): { nextSequence: string; events: SimEvent[] } {
    return {
      nextSequence: this.nextSequenceNum.toString(),
      events: this.heap.filter((e) => !e.cancelled),
    };
  }

  /**
   * Restores the queue state from a snapshot.
   */
  restoreState(state: { nextSequence: string; events: SimEvent[] }): void {
    this.nextSequenceNum = BigInt(state.nextSequence);
    this.heap = [];
    this.eventIndexMap.clear();

    for (const ev of state.events) {
      this.heap.push({ ...ev });
    }

    // Rebuild heap order
    for (let i = Math.floor(this.heap.length / 2); i >= 0; i--) {
      this.siftDown(i);
    }

    // Rebuild index map
    for (let i = 0; i < this.heap.length; i++) {
      this.eventIndexMap.set(this.heap[i].id, i);
    }
  }

  private compare(a: SimEvent, b: SimEvent): number {
    if (a.timeUs !== b.timeUs) {
      return a.timeUs - b.timeUs;
    }
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    if (a.sequenceNum < b.sequenceNum) return -1;
    if (a.sequenceNum > b.sequenceNum) return 1;
    return 0;
  }

  private siftUp(index: number): void {
    let curr = index;
    while (curr > 0) {
      const parent = (curr - 1) >> 1;
      if (this.compare(this.heap[curr], this.heap[parent]) < 0) {
        this.swap(curr, parent);
        curr = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    let curr = index;
    const len = this.heap.length;

    while ((curr << 1) + 1 < len) {
      let smallest = (curr << 1) + 1;
      const right = smallest + 1;

      if (right < len && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (this.compare(this.heap[smallest], this.heap[curr]) < 0) {
        this.swap(curr, smallest);
        curr = smallest;
      } else {
        break;
      }
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
    this.eventIndexMap.set(this.heap[i].id, i);
    this.eventIndexMap.set(this.heap[j].id, j);
  }

  private pruneCancelled(): void {
    while (this.heap.length > 0 && this.heap[0].cancelled) {
      const root = this.heap[0];
      this.eventIndexMap.delete(root.id);
      const last = this.heap.pop()!;
      if (this.heap.length > 0) {
        this.heap[0] = last;
        this.eventIndexMap.set(last.id, 0);
        this.siftDown(0);
      }
    }
  }
}
