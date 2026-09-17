import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { db, executionLeases, eq } from '@blackbox-x/db';
import type { Lease } from '../types.js';

export interface LeaseManagerOptions {
  redisUrl: string;
}

export class LeaseManager {
  private redis: Redis;

  constructor(options: LeaseManagerOptions) {
    this.redis = new Redis(options.redisUrl);
  }

  async acquire(resourceId: string, holderId: string, ttlMs = 5000): Promise<Lease> {
    const lockKey = `blackbox:lease:${resourceId}`;
    const epochKey = `blackbox:lease_epoch:${resourceId}`;

    const rawCurrent = await this.redis.get(lockKey);
    if (rawCurrent) {
      const current = JSON.parse(rawCurrent) as { holderId: string; epoch: number };
      if (current.holderId !== holderId) {
        throw new Error(`LEASE_HELD_BY_ANOTHER: Resource ${resourceId} is held by ${current.holderId}`);
      }
      return this.renew(resourceId, holderId, ttlMs);
    }

    // Allocate strictly monotonic incrementing epoch
    const epoch = await this.redis.incr(epochKey);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const leaseData = {
      holderId,
      epoch,
      expiresAt: expiresAt.toISOString(),
    };

    // Set lock key with millisecond TTL
    await this.redis.set(lockKey, JSON.stringify(leaseData), 'PX', ttlMs);

    // Upsert into MySQL execution_leases
    const existing = await db
      .select()
      .from(executionLeases)
      .where(eq(executionLeases.resourceId, resourceId));

    const leaseId = existing.length > 0 ? existing[0]!.id : `lease-${randomUUID()}`;

    if (existing.length > 0) {
      await db
        .update(executionLeases)
        .set({
          holderId,
          epoch,
          status: 'ACTIVE',
          expiresAt,
          acquiredAt: now,
          renewedAt: now,
        })
        .where(eq(executionLeases.resourceId, resourceId));
    } else {
      await db.insert(executionLeases).values({
        id: leaseId,
        resourceId,
        holderId,
        epoch,
        status: 'ACTIVE',
        expiresAt,
        acquiredAt: now,
        renewedAt: now,
      });
    }

    return {
      id: leaseId,
      resourceId,
      holderId,
      epoch,
      status: 'ACTIVE',
      expiresAt,
      acquiredAt: now,
      renewedAt: now,
    };
  }

  async renew(resourceId: string, holderId: string, ttlMs = 5000): Promise<Lease> {
    const lockKey = `blackbox:lease:${resourceId}`;
    const rawCurrent = await this.redis.get(lockKey);

    if (!rawCurrent) {
      throw new Error(`LEASE_EXPIRED_OR_LOST: Resource ${resourceId} lease has expired`);
    }

    const current = JSON.parse(rawCurrent) as { holderId: string; epoch: number };
    if (current.holderId !== holderId) {
      throw new Error(`LEASE_HELD_BY_ANOTHER: Resource ${resourceId} is held by ${current.holderId}`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const leaseData = {
      holderId,
      epoch: current.epoch,
      expiresAt: expiresAt.toISOString(),
    };

    await this.redis.set(lockKey, JSON.stringify(leaseData), 'PX', ttlMs);

    await db
      .update(executionLeases)
      .set({
        status: 'ACTIVE',
        expiresAt,
        renewedAt: now,
      })
      .where(eq(executionLeases.resourceId, resourceId));

    const [updated] = await db
      .select()
      .from(executionLeases)
      .where(eq(executionLeases.resourceId, resourceId));

    return {
      id: updated!.id,
      resourceId,
      holderId,
      epoch: current.epoch,
      status: 'ACTIVE',
      expiresAt,
      acquiredAt: updated!.acquiredAt,
      renewedAt: now,
    };
  }

  async release(resourceId: string, holderId: string): Promise<void> {
    const lockKey = `blackbox:lease:${resourceId}`;
    const rawCurrent = await this.redis.get(lockKey);

    if (rawCurrent) {
      const current = JSON.parse(rawCurrent) as { holderId: string };
      if (current.holderId === holderId) {
        await this.redis.del(lockKey);
      }
    }

    await db
      .update(executionLeases)
      .set({ status: 'RELEASED' })
      .where(eq(executionLeases.resourceId, resourceId));
  }

  async getCurrentEpoch(resourceId: string): Promise<number> {
    const epochKey = `blackbox:lease_epoch:${resourceId}`;
    const raw = await this.redis.get(epochKey);
    return raw ? parseInt(raw, 10) : 0;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
