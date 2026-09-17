import { describe, it, expect } from 'vitest';
import {
  normalizeRequestMix,
  PureCircuitBreaker,
  PureBulkhead,
  SimulationWorkloadAdapter,
  RealLoadWorkloadAdapter,
  WorkloadSpecDefinition,
} from '../index.js';

describe('Workload Specification & State Machines', () => {
  describe('normalizeRequestMix', () => {
    it('normalizes weights to sum to 1.0', () => {
      const mix = [
        { operationName: 'read', weight: 30 },
        { operationName: 'write', weight: 70 },
      ];
      const normalized = normalizeRequestMix(mix);
      expect(normalized[0].weight).toBeCloseTo(0.3);
      expect(normalized[1].weight).toBeCloseTo(0.7);
    });

    it('throws error if empty or negative weight', () => {
      expect(() => normalizeRequestMix([])).toThrow();
      expect(() => normalizeRequestMix([{ operationName: 'a', weight: -1 }])).toThrow();
    });
  });

  describe('PureCircuitBreaker', () => {
    it('transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED driven by virtual time', () => {
      const cb = new PureCircuitBreaker({
        failureThreshold: 3,
        resetTimeoutUs: 5_000_000, // 5s
        halfOpenSuccessThreshold: 2,
      });

      expect(cb.state).toBe('CLOSED');
      expect(cb.canExecute(0)).toBe(true);

      // Record 2 failures - still closed
      cb.recordFailure(100);
      cb.recordFailure(200);
      expect(cb.state).toBe('CLOSED');

      // 3rd failure trips to OPEN
      cb.recordFailure(300);
      expect(cb.state).toBe('OPEN');
      expect(cb.lastOpenedAtUs).toBe(300);

      // Within timeout: cannot execute
      expect(cb.canExecute(4_000_000)).toBe(false);

      // Past timeout (300 + 5_000_000 = 5_000_300): transitions to HALF_OPEN on canExecute
      expect(cb.canExecute(5_000_301)).toBe(true);
      expect(cb.state).toBe('HALF_OPEN');

      // First success in HALF_OPEN
      cb.recordSuccess(5_000_350);
      expect(cb.state).toBe('HALF_OPEN');

      // Second success in HALF_OPEN -> closes breaker!
      cb.recordSuccess(5_000_400);
      expect(cb.state).toBe('CLOSED');
    });

    it('re-trips to OPEN if failure occurs in HALF_OPEN', () => {
      const cb = new PureCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutUs: 1_000_000,
      });

      cb.recordFailure(100);
      cb.recordFailure(200);
      expect(cb.state).toBe('OPEN');

      // Trigger HALF_OPEN
      expect(cb.canExecute(1_500_000)).toBe(true);
      expect(cb.state).toBe('HALF_OPEN');

      // Failure trips back to OPEN
      cb.recordFailure(1_500_100);
      expect(cb.state).toBe('OPEN');
      expect(cb.lastOpenedAtUs).toBe(1_500_100);
    });
  });

  describe('PureBulkhead', () => {
    it('manages concurrent execution slots, queue, and load shedding', () => {
      const bulkhead = new PureBulkhead({
        maxConcurrent: 2,
        maxQueueCapacity: 2,
      });

      // Acquire active slots
      expect(bulkhead.tryAcquire()).toBe('EXECUTING');
      expect(bulkhead.tryAcquire()).toBe('EXECUTING');
      expect(bulkhead.isSaturated).toBe(true);

      // Enqueue waiting requests
      expect(bulkhead.tryAcquire()).toBe('QUEUED');
      expect(bulkhead.tryAcquire()).toBe('QUEUED');
      expect(bulkhead.isQueueFull).toBe(true);

      // Shed load when queue is full
      expect(bulkhead.tryAcquire()).toBe('REJECTED');
      expect(bulkhead.totalRejected).toBe(1);

      // Releasing finishes one and promotes one from queue
      bulkhead.release();
      expect(bulkhead.activeCount).toBe(2);
      expect(bulkhead.queueCount).toBe(1);
    });
  });

  describe('SimulationWorkloadAdapter', () => {
    const spec: WorkloadSpecDefinition = {
      id: 'test-workload-1',
      name: 'Test Poisson Workload',
      arrivalPattern: 'POISSON',
      arrivalParams: { lambdaRps: 100 },
      requestMix: [
        { operationName: 'get_user', weight: 0.8 },
        { operationName: 'update_user', weight: 0.2 },
      ],
      totalDurationSeconds: 10,
    };

    it('is bit-for-bit deterministic for identical seeds', () => {
      const adapter1 = new SimulationWorkloadAdapter(spec, 9999n);
      const arrivals1 = adapter1.generateArrivals(200);

      const adapter2 = new SimulationWorkloadAdapter(spec, 9999n);
      const arrivals2 = adapter2.generateArrivals(200);

      expect(arrivals1.length).toBe(200);
      expect(arrivals2.length).toBe(200);
      expect(arrivals1).toEqual(arrivals2);
    });

    it('produces different sequences for different seeds', () => {
      const adapter1 = new SimulationWorkloadAdapter(spec, 1111n);
      const arrivals1 = adapter1.generateArrivals(50);

      const adapter2 = new SimulationWorkloadAdapter(spec, 2222n);
      const arrivals2 = adapter2.generateArrivals(50);

      expect(arrivals1[0].virtualTimeUs).not.toBe(arrivals2[0].virtualTimeUs);
    });
  });

  describe('RealLoadWorkloadAdapter', () => {
    it('translates workload spec into k6 stages and autocannon profiles', () => {
      const rampSpec: WorkloadSpecDefinition = {
        id: 'ramp-test',
        name: 'Ramp Test',
        arrivalPattern: 'RAMP',
        arrivalParams: {
          initialRateRps: 100,
          targetRateRps: 1000,
          rampDurationSeconds: 30,
        },
        requestMix: [{ operationName: 'checkout', weight: 1.0 }],
        totalDurationSeconds: 60,
      };

      const adapter = new RealLoadWorkloadAdapter(rampSpec);
      const k6Stages = adapter.toK6Stages();

      expect(k6Stages).toEqual([
        { duration: '30s', target: 1000 },
        { duration: '30s', target: 1000 },
      ]);

      const autocannon = adapter.toAutocannonConfig({ connections: 20 });
      expect(autocannon.duration).toBe(60);
      expect(autocannon.overallRate).toBe(1000);
      expect(autocannon.connections).toBe(20);
    });
  });
});
