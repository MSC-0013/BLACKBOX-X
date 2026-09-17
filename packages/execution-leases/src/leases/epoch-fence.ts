import { db, executionLeases, eq } from '@blackbox-x/db';

export class EpochFenceError extends Error {
  readonly claimedEpoch: number;
  readonly activeEpoch: number;
  readonly resourceId: string;

  constructor(resourceId: string, claimedEpoch: number, activeEpoch: number) {
    super(
      `STALE_EPOCH_FENCED: Write rejected for resource '${resourceId}'. Claimed epoch ${claimedEpoch} is less than active epoch ${activeEpoch}.`,
    );
    this.name = 'EpochFenceError';
    this.resourceId = resourceId;
    this.claimedEpoch = claimedEpoch;
    this.activeEpoch = activeEpoch;
  }
}

export class EpochFenceGuard {
  static assertValidEpoch(resourceId: string, claimedEpoch: number, activeEpoch: number): void {
    if (claimedEpoch < activeEpoch) {
      throw new EpochFenceError(resourceId, claimedEpoch, activeEpoch);
    }
  }

  static async assertValidEpochFromDb(resourceId: string, claimedEpoch: number): Promise<void> {
    const [record] = await db
      .select({ epoch: executionLeases.epoch })
      .from(executionLeases)
      .where(eq(executionLeases.resourceId, resourceId));

    if (record && claimedEpoch < record.epoch) {
      throw new EpochFenceError(resourceId, claimedEpoch, record.epoch);
    }
  }
}
