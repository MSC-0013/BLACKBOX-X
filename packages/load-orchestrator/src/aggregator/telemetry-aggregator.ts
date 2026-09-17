import { Redis } from 'ioredis';
import type { WorkerTelemetry, AggregatedClusterTelemetry } from '../types.js';

export interface TelemetryAggregatorOptions {
  redisUrl: string;
}

export class TelemetryAggregator {
  private redis: Redis;

  constructor(options: TelemetryAggregatorOptions) {
    this.redis = new Redis(options.redisUrl);
  }

  async getWorkerTelemetries(runId: string): Promise<WorkerTelemetry[]> {
    const keys = await this.redis.keys(`blackbox:telemetry:${runId}:*`);
    if (keys.length === 0) return [];

    const rawValues = await this.redis.mget(...keys);
    const telemetries: WorkerTelemetry[] = [];

    for (const raw of rawValues) {
      if (raw) {
        telemetries.push(JSON.parse(raw) as WorkerTelemetry);
      }
    }

    return telemetries;
  }

  /**
   * Reference quantile aggregation for Item 21.
   * Given multiple worker latency arrays, merges them and computes quantiles
   * using a pure order-statistic approach (independent of the live aggregate() path).
   * Used as a deterministic ground-truth to cross-check the live aggregation.
   */
  static computeQuantile(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(Math.floor(sorted.length * q), sorted.length - 1);
    return sorted[idx] ?? 0;
  }

  static mergeQuantilesReference(
    workerLatencies: number[][],
  ): { p50Us: number; p90Us: number; p95Us: number; p99Us: number; meanUs: number } {
    const merged: number[] = [];
    for (const arr of workerLatencies) {
      merged.push(...arr);
    }
    merged.sort((a, b) => a - b);

    const meanUs = merged.length > 0 ? merged.reduce((s, v) => s + v, 0) / merged.length : 0;

    return {
      p50Us: TelemetryAggregator.computeQuantile(merged, 0.50),
      p90Us: TelemetryAggregator.computeQuantile(merged, 0.90),
      p95Us: TelemetryAggregator.computeQuantile(merged, 0.95),
      p99Us: TelemetryAggregator.computeQuantile(merged, 0.99),
      meanUs,
    };
  }

  aggregate(
    runId: string,
    telemetries: WorkerTelemetry[],
    durationSec: number,
  ): AggregatedClusterTelemetry {
    if (telemetries.length === 0) {
      return {
        runId,
        activeWorkers: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        actualRps: 0,
        errorRate: 0,
        p50Us: 0,
        p90Us: 0,
        p95Us: 0,
        p99Us: 0,
        meanUs: 0,
      };
    }

    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    const allLatencies: number[] = [];

    for (const t of telemetries) {
      totalRequests += t.requests;
      successfulRequests += t.successes;
      failedRequests += t.errors;
      if (t.latenciesUs && t.latenciesUs.length > 0) {
        allLatencies.push(...t.latenciesUs);
      }
    }

    allLatencies.sort((a, b) => a - b);
    const n = allLatencies.length;

    const p50Us = n > 0 ? allLatencies[Math.floor(n * 0.50)] : 0;
    const p90Us = n > 0 ? allLatencies[Math.floor(n * 0.90)] : 0;
    const p95Us = n > 0 ? allLatencies[Math.floor(n * 0.95)] : 0;
    const p99Us = n > 0 ? allLatencies[Math.floor(n * 0.99)] : 0;

    const sumLatency = allLatencies.reduce((acc, v) => acc + v, 0);
    const meanUs = n > 0 ? sumLatency / n : 0;

    const actualRps = durationSec > 0 ? totalRequests / durationSec : 0;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

    return {
      runId,
      activeWorkers: telemetries.length,
      totalRequests,
      successfulRequests,
      failedRequests,
      actualRps,
      errorRate,
      p50Us,
      p90Us,
      p95Us,
      p99Us,
      meanUs,
    };
  }

  async aggregateFromRedis(
    runId: string,
    durationSec: number,
  ): Promise<AggregatedClusterTelemetry> {
    const telemetries = await this.getWorkerTelemetries(runId);
    return this.aggregate(runId, telemetries, durationSec);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
