import { Kafka, Consumer } from 'kafkajs';
import { Redis } from 'ioredis';
import { hostname } from 'node:os';
import { WorkerPool } from './worker-pool.js';
import type { LoadCommand, WorkerTelemetry, WorkerStatus } from '../types.js';

export interface LoadWorkerOptions {
  workerId: string;
  kafkaBrokers: string[];
  redisUrl: string;
  commandTopic?: string;
  telemetryTopic?: string;
}

export class LoadWorker {
  readonly workerId: string;
  private kafka: Kafka;
  private consumer: Consumer;
  private redis: Redis;
  private pool: WorkerPool;
  private commandTopic: string;
  private isRunning = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private activeRunId?: string;
  private currentStatus: WorkerStatus = 'IDLE';
  private stopRequested = false;

  constructor(options: LoadWorkerOptions) {
    this.workerId = options.workerId;
    this.commandTopic = options.commandTopic ?? 'load-commands.v1';
    this.pool = new WorkerPool({ redisUrl: options.redisUrl });
    this.redis = new Redis(options.redisUrl);

    this.kafka = new Kafka({
      clientId: `worker-${this.workerId}`,
      brokers: options.kafkaBrokers,
      retry: { retries: 5 },
    });
    this.consumer = this.kafka.consumer({
      groupId: `worker-group-${this.workerId}-${Date.now()}`,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Register with worker pool
    await this.pool.registerWorker(this.workerId, hostname());

    // Start heartbeat
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.pool.heartbeat(this.workerId, this.currentStatus, this.activeRunId);
      } catch {
        // Suppress transient heartbeat failure
      }
    }, 3000);

    // Connect Kafka consumer
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.commandTopic,
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        try {
          const command = JSON.parse(message.value.toString()) as LoadCommand;
          await this.handleCommand(command);
        } catch {
          // Ignore invalid message
        }
      },
    });
  }

  async handleCommand(command: LoadCommand): Promise<void> {
    if (command.type === 'START_LOAD') {
      if (
        command.assignedWorkers &&
        command.assignedWorkers.length > 0 &&
        !command.assignedWorkers.includes(this.workerId)
      ) {
        return; // Not assigned to this worker
      }

      this.activeRunId = command.runId;
      this.currentStatus = 'BUSY';
      this.stopRequested = false;

      // Run load in background
      this.executeLoad(command).catch(() => {
        this.currentStatus = 'IDLE';
        this.activeRunId = undefined;
      });
    } else if (command.type === 'STOP_LOAD') {
      if (!this.activeRunId || this.activeRunId === command.runId) {
        this.stopRequested = true;
      }
    }
  }

  async executeLoad(command: {
    runId: string;
    targetUrl: string;
    targetRps: number;
    durationSec: number;
    concurrency?: number;
  }): Promise<WorkerTelemetry> {
    this.currentStatus = 'BUSY';
    this.activeRunId = command.runId;
    this.stopRequested = false;

    const concurrency = command.concurrency ?? 5;
    const durationMs = command.durationSec * 1000;
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    const latenciesUs: number[] = [];
    let successes = 0;
    let errors = 0;

    // Concurrency pool
    const runWorkerLoop = async () => {
      while (Date.now() < endTime && !this.stopRequested) {
        const reqStart = process.hrtime.bigint();
        try {
          const res = await fetch(command.targetUrl, {
            method: 'GET',
            headers: { 'User-Agent': `Blackbox-Worker-${this.workerId}` },
            signal: AbortSignal.timeout(5000),
          });
          const reqEnd = process.hrtime.bigint();
          const latencyUs = Number(reqEnd - reqStart) / 1000;
          latenciesUs.push(latencyUs);

          if (res.ok) {
            successes++;
          } else {
            errors++;
          }
        } catch {
          const reqEnd = process.hrtime.bigint();
          const latencyUs = Number(reqEnd - reqStart) / 1000;
          latenciesUs.push(latencyUs);
          errors++;
        }

        // Slight pacing delay based on targetRps and concurrency
        if (command.targetRps > 0) {
          const delayMs = Math.max(1, Math.floor(1000 / (command.targetRps / concurrency)));
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    };

    // Telemetry reporting loop
    const telemetryTimer = setInterval(async () => {
      await this.publishTelemetry(command.runId, successes, errors, latenciesUs);
    }, 500);

    try {
      const workers = Array.from({ length: concurrency }, () => runWorkerLoop());
      await Promise.all(workers);
    } finally {
      clearInterval(telemetryTimer);
    }

    const finalTelemetry = await this.publishTelemetry(command.runId, successes, errors, latenciesUs);

    this.currentStatus = 'IDLE';
    this.activeRunId = undefined;
    return finalTelemetry;
  }

  private async publishTelemetry(
    runId: string,
    successes: number,
    errors: number,
    latenciesUs: number[],
  ): Promise<WorkerTelemetry> {
    const totalRequests = successes + errors;
    const sorted = [...latenciesUs].sort((a, b) => a - b);

    const p50Us = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p90Us = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)] : 0;
    const p99Us = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0;

    const telemetry: WorkerTelemetry = {
      runId,
      workerId: this.workerId,
      timestamp: new Date().toISOString(),
      currentRps: totalRequests,
      requests: totalRequests,
      successes,
      errors,
      latenciesUs: sorted.slice(-100), // Keep latest 100 for sampling
      p50Us,
      p90Us,
      p99Us,
    };

    // Publish to Redis key and history
    const telemetryKey = `blackbox:telemetry:${runId}:${this.workerId}`;
    await this.redis
      .multi()
      .set(telemetryKey, JSON.stringify(telemetry), 'EX', 300)
      .rpush(`blackbox:telemetry_history:${runId}`, JSON.stringify(telemetry))
      .exec();

    return telemetry;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.isRunning = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    await this.pool.deregisterWorker(this.workerId);
    await this.consumer.disconnect();
    await this.pool.close();
    await this.redis.quit();
  }
}
