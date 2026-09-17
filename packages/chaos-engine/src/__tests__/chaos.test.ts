import { describe, it, expect } from 'vitest';
import {
  FaultInjector,
  CascadeAnalyzer,
  ResilienceEvaluator,
  ChaosEngine,
  type FaultSchedule,
} from '../index.js';

describe('ChaosEngine Unit Tests', () => {
  it('identifies fault window activity correctly', () => {
    const schedule: FaultSchedule = {
      id: 'fault-1',
      type: 'LATENCY_INJECTION',
      targetNodeId: 'node-db',
      startVirtualTimeUs: 1000,
      durationVirtualTimeUs: 2000,
      parameters: { addedLatencyUs: 50000 },
    };

    expect(FaultInjector.isActive(schedule, 500)).toBe(false);
    expect(FaultInjector.isActive(schedule, 1000)).toBe(true);
    expect(FaultInjector.isActive(schedule, 2000)).toBe(true);
    expect(FaultInjector.isActive(schedule, 3000)).toBe(false);
  });

  it('analyzes topological blast radius and cascade depth', () => {
    // Gateway -> OrderService -> InventoryDB
    // PaymentService -> InventoryDB
    const edges = [
      { sourceNodeId: 'gateway', targetNodeId: 'order-service', edgeKind: 'SYNC_HTTP' },
      { sourceNodeId: 'order-service', targetNodeId: 'inventory-db', edgeKind: 'DB_QUERY' },
      { sourceNodeId: 'payment-service', targetNodeId: 'inventory-db', edgeKind: 'DB_QUERY' },
    ];

    const result = CascadeAnalyzer.analyzeBlastRadius('inventory-db', edges);
    expect(result.targetNodeId).toBe('inventory-db');
    expect(result.upstreamNodeIds).toContain('order-service');
    expect(result.upstreamNodeIds).toContain('payment-service');
    expect(result.upstreamNodeIds).toContain('gateway');
    expect(result.blastRadius).toBe(3);
    expect(result.isCascade).toBe(true);
  });

  it('computes resilience score and MTTR accurately', () => {
    const metrics = ResilienceEvaluator.evaluate({
      blastRadius: 2,
      cascadeDetected: true,
      totalRequests: 100,
      failedRequests: 10,
      degradedRequests: 20,
      fallbackRequests: 5,
      faultDurationUs: 2000000,
      recoveryTimeUs: 45000,
    });

    expect(metrics.resilienceScore).toBeGreaterThan(0);
    expect(metrics.resilienceScore).toBeLessThanOrEqual(100);
    expect(metrics.mttrMs).toBe(45);
  });

  it('runs complete chaos experiment simulation', () => {
    const schedule: FaultSchedule = {
      id: 'exp-1',
      type: 'LATENCY_INJECTION',
      targetNodeId: 'db-1',
      startVirtualTimeUs: 1000,
      durationVirtualTimeUs: 5000,
      parameters: { addedLatencyUs: 20000 },
    };

    const edges = [
      { sourceNodeId: 'api', targetNodeId: 'db-1', edgeKind: 'DB_QUERY' },
    ];

    const result = ChaosEngine.runExperiment({
      experimentId: 'exp-1',
      schedule,
      topologyEdges: edges,
      totalRequests: 200,
      baseLatencyUs: 5000,
    });

    expect(result.experimentId).toBe('exp-1');
    expect(result.chaosMetrics.p99Us).toBeGreaterThan(result.baselineMetrics.p99Us);
    expect(result.resilience.blastRadius).toBe(1);
  });
});
