import { describe, it, expect } from 'vitest';
import { TelemetryAggregator } from '../aggregator/telemetry-aggregator.js';
import type { WorkerTelemetry } from '../types.js';

describe('TelemetryAggregator Unit Tests', () => {
  it('aggregates multi-worker metrics correctly', () => {
    const aggregator = new TelemetryAggregator({ redisUrl: 'redis://localhost:6380' });

    const worker1: WorkerTelemetry = {
      runId: 'run-1',
      workerId: 'worker-1',
      timestamp: new Date().toISOString(),
      currentRps: 100,
      requests: 100,
      successes: 98,
      errors: 2,
      latenciesUs: [1000, 1500, 2000, 2500, 3000],
    };

    const worker2: WorkerTelemetry = {
      runId: 'run-1',
      workerId: 'worker-2',
      timestamp: new Date().toISOString(),
      currentRps: 100,
      requests: 100,
      successes: 100,
      errors: 0,
      latenciesUs: [1100, 1600, 2100, 2600, 3100],
    };

    const result = aggregator.aggregate('run-1', [worker1, worker2], 2);

    expect(result.activeWorkers).toBe(2);
    expect(result.totalRequests).toBe(200);
    expect(result.successfulRequests).toBe(198);
    expect(result.failedRequests).toBe(2);
    expect(result.actualRps).toBe(100);
    expect(result.errorRate).toBe(0.01);
    expect(result.p50Us).toBeGreaterThan(1500);
    expect(result.p99Us).toBeGreaterThanOrEqual(3000);
  });

  it('handles empty telemetry arrays gracefully', () => {
    const aggregator = new TelemetryAggregator({ redisUrl: 'redis://localhost:6380' });
    const result = aggregator.aggregate('run-empty', [], 10);

    expect(result.totalRequests).toBe(0);
    expect(result.actualRps).toBe(0);
    expect(result.errorRate).toBe(0);
    expect(result.p50Us).toBe(0);
  });
});
