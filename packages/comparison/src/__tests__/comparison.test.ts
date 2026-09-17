import { describe, it, expect } from 'vitest';
import {
  computeTwoSampleKsTest,
  computeQuantileRelativeErrors,
  computeWassersteinDistance,
  ComparisonEngine,
} from '../index.js';

describe('Comparison Package', () => {
  describe('computeTwoSampleKsTest', () => {
    it('returns D=0 and rejectNull=false for identical distributions', () => {
      const s1 = [10, 20, 30, 40, 50];
      const s2 = [10, 20, 30, 40, 50];
      const res = computeTwoSampleKsTest(s1, s2);

      expect(res.statistic).toBeCloseTo(0);
      expect(res.rejectNull).toBe(false);
    });

    it('detects significant distribution divergence', () => {
      const s1 = [10, 20, 30, 40, 50];
      const s2 = [100, 200, 300, 400, 500];
      const res = computeTwoSampleKsTest(s1, s2);

      expect(res.statistic).toBe(1.0);
      expect(res.rejectNull).toBe(true);
    });
  });

  describe('computeQuantileRelativeErrors', () => {
    it('calculates accurate relative errors and MAPE', () => {
      const sim = { p50: 100, p90: 200, p95: 250, p99: 300 };
      const real = { p50: 100, p90: 220, p95: 250, p99: 330 };

      const { errors, mape } = computeQuantileRelativeErrors(sim, real);
      expect(errors.p50).toBe(0);
      expect(errors.p90).toBeCloseTo(20 / 220);
      expect(errors.p95).toBe(0);
      expect(errors.p99).toBeCloseTo(30 / 330);
      expect(mape).toBeGreaterThan(0);
    });
  });

  describe('computeWassersteinDistance', () => {
    it('measures shift between distributions accurately', () => {
      const s1 = [10, 20, 30, 40, 50];
      const s2 = [15, 25, 35, 45, 55];

      const dist = computeWassersteinDistance(s1, s2);
      expect(dist).toBeCloseTo(5);
    });
  });

  describe('ComparisonEngine', () => {
    const engine = new ComparisonEngine();

    it('returns ALIGNED when simulated and real closely match', () => {
      const report = engine.compare({
        simulated: {
          p50Us: 5000,
          p90Us: 8000,
          p95Us: 9000,
          p99Us: 12000,
          meanLatencyUs: 5500,
          throughputRps: 500,
          predictionInterval: [4500, 5500],
          samplesUs: [4800, 5000, 5200, 8000, 12000],
        },
        real: {
          p50Us: 5100,
          p90Us: 8100,
          p95Us: 9100,
          p99Us: 12100,
          meanLatencyUs: 5600,
          throughputRps: 495,
          samplesUs: [4900, 5100, 5300, 8100, 12100],
        },
      });

      expect(report.verdict).toBe('ALIGNED');
      expect(report.predictionIntervalEnclosed).toBe(true);
      expect(report.mape).toBeLessThan(0.05);
    });

    it('returns MISALIGNED when prediction interval is breached', () => {
      const report = engine.compare({
        simulated: {
          p50Us: 5000,
          p90Us: 8000,
          p95Us: 9000,
          p99Us: 12000,
          meanLatencyUs: 5500,
          throughputRps: 500,
          predictionInterval: [4500, 5500],
        },
        real: {
          p50Us: 9000, // Breaches [4500, 5500]
          p90Us: 15000,
          p95Us: 18000,
          p99Us: 25000,
          meanLatencyUs: 9500,
          throughputRps: 300,
        },
      });

      expect(report.verdict).toBe('MISALIGNED');
      expect(report.predictionIntervalEnclosed).toBe(false);
    });
  });
});
