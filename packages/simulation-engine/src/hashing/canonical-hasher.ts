import crypto from 'node:crypto';

export function canonicalizeJson(val: unknown): string {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val !== 'object') {
    if (typeof val === 'bigint') {
      return val.toString();
    }
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((v) => canonicalizeJson(v)).join(',') + ']';
  }
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

export class CanonicalStateHasher {
  private currentHash: string;

  constructor(initialSeed = '0000000000000000000000000000000000000000000000000000000000000000') {
    this.currentHash = initialSeed;
  }

  getHash(): string {
    return this.currentHash;
  }

  /**
   * Incrementally hashes an event state transition.
   */
  update(timeUs: number, eventType: string, payload: unknown): void {
    const canonicalPayload = canonicalizeJson(payload);
    const data = `${this.currentHash}:${timeUs}:${eventType}:${canonicalPayload}`;
    this.currentHash = crypto.createHash('sha256').update(data).digest('hex');
  }

  restore(hash: string): void {
    this.currentHash = hash;
  }
}
