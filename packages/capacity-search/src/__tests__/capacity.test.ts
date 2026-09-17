import { describe, it, expect } from 'vitest';
import {
  runBisectionSearch,
  detectKneePoint,
  identifyBottleneck,
  CapacitySearchEngine,
} from '../index.js';

describe('Capacity Search Package', () => {
  describe('runBisectionSearch', () => {
    it('converges to maximum sustainable RPS under latency SLO', async () => {
      // System capacity is ~500 RPS. Above 500, p99 exceeds 50,000us (50ms).
      const evaluator = async (rps: number) => {
        const p99Us = rps <= 500 ? 10_000 + rps * 20 : 10_000 + rps * 20 + Math.pow(rps - 500, 2) * 50;
        const errorRate = rps > 600 ? 0.05 : 0.0;
        return { p99Us, errorRate };
      };

      const result = await runBisectionSearch({
        minRps: 100,
        maxRps: 1000,
        toleranceRps: 10,
        slo: { maxP99Us: 50_000, maxErrorRate: 0.01 },
        evaluator,
      });

      expect(result.maxSustainableRps).toBeGreaterThanOrEqual(490);
      expect(result.maxSustainableRps).toBeLessThanOrEqual(530);
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('flags non-monotonic degradation curves and falls back to adaptive sweep', async () => {
      // Non-monotonic curve: passes at 100, fails at 397 (lock contention), passes at 694 (load-shedding false latency drop), fails at 1000
      const evaluator = async (rps: number) => {
        if (rps >= 300 && rps < 500) {
          // Contention region: high latency
          return { p99Us: 80_000, errorRate: 0.05 };
        }
        if (rps >= 500 && rps < 800) {
          // Load shedding region: false latency drop but error rate spike
          return { p99Us: 20_000, errorRate: 0.20 };
        }
        return { p99Us: rps * 30, errorRate: 0.0 };
      };

      const result = await runBisectionSearch({
        minRps: 100,
        maxRps: 1000,
        toleranceRps: 50,
        slo: { maxP99Us: 50_000, maxErrorRate: 0.01 },
        evaluator,
      });

      expect(result.nonMonotonicDetected).toBe(true);
      expect(result.strategy).toBe('ADAPTIVE_SWEEP');
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe('detectKneePoint', () => {
    it('accurately identifies hockey-stick inflection point', () => {
      const curve = [
        { rps: 100, p99Us: 5000 },
        { rps: 200, p99Us: 5200 },
        { rps: 300, p99Us: 5600 },
        { rps: 400, p99Us: 6500 },
        { rps: 500, p99Us: 9000 },
        { rps: 600, p99Us: 25000 }, // hockey-stick inflection
        { rps: 700, p99Us: 80000 },
      ];

      const knee = detectKneePoint(curve);
      expect(knee).toBeDefined();
      expect(knee?.kneeRps).toBeGreaterThanOrEqual(400);
      expect(knee?.kneeRps).toBeLessThanOrEqual(600);
    });
  });

  describe('identifyBottleneck', () => {
    it('attributes saturation to limiting resource and suggests recommendation', () => {
      const components = [
        {
          componentId: 'gateway',
          cpuUtilization: 0.45,
          threadPoolUtilization: 0.50,
          connectionPoolUtilization: 0.30,
        },
        {
          componentId: 'mysql_cluster',
          cpuUtilization: 0.30,
          threadPoolUtilization: 0.40,
          connectionPoolUtilization: 0.98, // Saturating resource!
        },
      ];

      const bottleneck = identifyBottleneck(components);
      expect(bottleneck?.limitingComponent).toBe('mysql_cluster');
      expect(bottleneck?.limitingResourceType).toBe('CONNECTION_POOL');
      expect(bottleneck?.utilization).toBe(0.98);
      expect(bottleneck?.recommendation).toContain('connection pool');
    });
  });

  describe('CapacitySearchEngine', () => {
    it('executes full capacity search and outputs unified report', async () => {
      const engine = new CapacitySearchEngine();
      const report = await engine.search({
        minRps: 50,
        maxRps: 500,
        toleranceRps: 20,
        slo: { maxP99Us: 30_000, maxErrorRate: 0.01 },
        evaluator: async (rps) => ({
          p99Us: 2000 + rps * 40,
          errorRate: rps > 400 ? 0.02 : 0,
          components: [
            {
              componentId: 'app_service',
              cpuUtilization: rps / 500,
              threadPoolUtilization: rps / 400,
              connectionPoolUtilization: 0.2,
            },
          ],
        }),
      });

      expect(report.sloSatisfied).toBe(true);
      expect(report.maxSustainableRps).toBeGreaterThanOrEqual(300);
      expect(report.bottleneck?.limitingComponent).toBe('app_service');
    });
  });
});
