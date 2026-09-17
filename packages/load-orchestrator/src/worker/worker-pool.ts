import { Redis } from 'ioredis';
import type { WorkerRegistration, WorkerStatus } from '../types.js';

export interface WorkerPoolOptions {
  redisUrl: string;
  heartbeatTtlSec?: number;
}

export class WorkerPool {
  private redis: Redis;
  private heartbeatTtlSec: number;
  private keyPrefix = 'blackbox:worker:';
  private activeSetKey = 'blackbox:workers:active';

  constructor(options: WorkerPoolOptions) {
    this.redis = new Redis(options.redisUrl);
    this.heartbeatTtlSec = options.heartbeatTtlSec ?? 15;
  }

  async registerWorker(
    workerId: string,
    hostname: string,
    metadata?: Record<string, unknown>,
  ): Promise<WorkerRegistration> {
    const now = new Date().toISOString();
    const registration: WorkerRegistration = {
      workerId,
      hostname,
      status: 'IDLE',
      registeredAt: now,
      heartbeatAt: now,
      metadata,
    };

    const workerKey = `${this.keyPrefix}${workerId}`;
    await this.redis
      .multi()
      .set(workerKey, JSON.stringify(registration), 'EX', this.heartbeatTtlSec)
      .sadd(this.activeSetKey, workerId)
      .exec();

    return registration;
  }

  async heartbeat(
    workerId: string,
    status: WorkerStatus = 'IDLE',
    activeRunId?: string,
  ): Promise<void> {
    const workerKey = `${this.keyPrefix}${workerId}`;
    const raw = await this.redis.get(workerKey);
    const now = new Date().toISOString();

    let registration: WorkerRegistration;
    if (raw) {
      registration = JSON.parse(raw) as WorkerRegistration;
      registration.status = status;
      registration.heartbeatAt = now;
      registration.activeRunId = activeRunId;
    } else {
      registration = {
        workerId,
        hostname: 'unknown',
        status,
        registeredAt: now,
        heartbeatAt: now,
        activeRunId,
      };
    }

    await this.redis
      .multi()
      .set(workerKey, JSON.stringify(registration), 'EX', this.heartbeatTtlSec)
      .sadd(this.activeSetKey, workerId)
      .exec();
  }

  async deregisterWorker(workerId: string): Promise<void> {
    const workerKey = `${this.keyPrefix}${workerId}`;
    await this.redis
      .multi()
      .del(workerKey)
      .srem(this.activeSetKey, workerId)
      .exec();
  }

  async getActiveWorkers(): Promise<WorkerRegistration[]> {
    const workerIds = await this.redis.smembers(this.activeSetKey);
    if (workerIds.length === 0) return [];

    const keys = workerIds.map((id: string) => `${this.keyPrefix}${id}`);
    const results = await this.redis.mget(...keys);


    const activeWorkers: WorkerRegistration[] = [];
    const expiredWorkerIds: string[] = [];

    for (let i = 0; i < workerIds.length; i++) {
      const raw = results[i];
      if (raw) {
        activeWorkers.push(JSON.parse(raw) as WorkerRegistration);
      } else {
        expiredWorkerIds.push(workerIds[i]!);
      }
    }

    if (expiredWorkerIds.length > 0) {
      await this.redis.srem(this.activeSetKey, ...expiredWorkerIds);
    }

    return activeWorkers;
  }

  async allocateWorkers(count: number): Promise<string[]> {
    const active = await this.getActiveWorkers();
    const idle = active.filter((w) => w.status === 'IDLE');

    if (idle.length < count) {
      // Return whatever idle workers exist, or active ones if needed
      return active.slice(0, count).map((w) => w.workerId);
    }

    return idle.slice(0, count).map((w) => w.workerId);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
