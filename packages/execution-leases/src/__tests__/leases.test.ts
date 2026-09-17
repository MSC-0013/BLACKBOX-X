import { describe, it, expect } from 'vitest';
import { EpochFenceGuard, EpochFenceError } from '../leases/epoch-fence.js';

describe('EpochFenceGuard Unit Tests', () => {
  it('allows write when claimed epoch matches or exceeds active epoch', () => {
    expect(() => {
      EpochFenceGuard.assertValidEpoch('resource-sim-1', 5, 5);
    }).not.toThrow();

    expect(() => {
      EpochFenceGuard.assertValidEpoch('resource-sim-1', 6, 5);
    }).not.toThrow();
  });

  it('rejects stale write when claimed epoch is smaller than active epoch', () => {
    expect(() => {
      EpochFenceGuard.assertValidEpoch('resource-sim-1', 4, 5);
    }).toThrow(EpochFenceError);

    try {
      EpochFenceGuard.assertValidEpoch('resource-sim-1', 4, 5);
    } catch (err) {
      expect(err).toBeInstanceOf(EpochFenceError);
      const e = err as EpochFenceError;
      expect(e.claimedEpoch).toBe(4);
      expect(e.activeEpoch).toBe(5);
      expect(e.message).toContain('STALE_EPOCH_FENCED');
    }
  });
});
