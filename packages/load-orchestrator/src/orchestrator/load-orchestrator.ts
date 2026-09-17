import { randomUUID } from 'node:crypto';
import { KafkaLoadCommander } from '../protocol/kafka-commander.js';
import { WorkerPool } from '../worker/worker-pool.js';
import { TelemetryAggregator } from '../aggregator/telemetry-aggregator.js';
import type { OrchestratorConfig, OrchestratorRunResult } from '../types.js';

export class LoadOrchestrator {
  private commander: KafkaLoadCommander;
  private pool: WorkerPool;
  private aggregator: TelemetryAggregator;

  constructor(config: OrchestratorConfig) {
    this.commander = new KafkaLoadCommander({
      brokers: config.kafkaBrokers,
      commandTopic: config.commandTopic,
    });
    this.pool = new WorkerPool({
      redisUrl: config.redisUrl,
      heartbeatTtlSec: config.heartbeatTtlSec,
    });
    this.aggregator = new TelemetryAggregator({
      redisUrl: config.redisUrl,
    });
  }

  async initialize(): Promise<void> {
    await this.commander.connect();
    await this.commander.ensureTopics();
  }

  async startRun(params: {
    runId?: string;
    targetUrl: string;
    targetRps: number;
    durationSec: number;
    pattern?: 'CONSTANT' | 'POISSON' | 'RAMP' | 'BURST';
    workerCount?: number;
  }): Promise<{ runId: string; assignedWorkers: string[] }> {
    const runId = params.runId ?? `load-run-${randomUUID()}`;
    const workerCount = params.workerCount ?? 1;

    const assignedWorkers = await this.pool.allocateWorkers(workerCount);

    await this.commander.sendStartLoad({
      runId,
      targetUrl: params.targetUrl,
      targetRps: params.targetRps,
      durationSec: params.durationSec,
      pattern: params.pattern,
      assignedWorkers,
    });

    return { runId, assignedWorkers };
  }

  async stopRun(runId: string): Promise<void> {
    await this.commander.sendStopLoad(runId);
  }

  async collectResults(
    runId: string,
    targetUrl: string,
    targetRps: number,
    durationSec: number,
    startedAt: string,
  ): Promise<OrchestratorRunResult> {
    const agg = await this.aggregator.aggregateFromRedis(runId, durationSec);
    const completedAt = new Date().toISOString();

    return {
      runId,
      status: 'COMPLETED',
      targetUrl,
      targetRps,
      durationSec,
      allocatedWorkers: agg.activeWorkers,
      totalRequests: agg.totalRequests,
      successfulRequests: agg.successfulRequests,
      failedRequests: agg.failedRequests,
      actualRps: agg.actualRps,
      errorRate: agg.errorRate,
      p50Us: agg.p50Us,
      p90Us: agg.p90Us,
      p95Us: agg.p95Us,
      p99Us: agg.p99Us,
      meanUs: agg.meanUs,
      startedAt,
      completedAt,
    };
  }

  async shutdown(): Promise<void> {
    await this.commander.disconnect();
    await this.pool.close();
    await this.aggregator.close();
  }
}
