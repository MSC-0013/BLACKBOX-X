import { describe, it, expect } from 'vitest';
import {
  computeCalibrationLoss,
  runCoordinateDescent,
  CalibrationEngine,
} from '../index.js';

describe('Calibration Package', () => {
  describe('computeCalibrationLoss', () => {
    it('calculates weighted loss correctly', () => {
      const report = {
        verdict: 'ALIGNED' as const,
        ksTest: { statistic: 0.1, criticalValue: 0.2, rejectNull: false },
        quantileErrors: { p50: 0.05, p90: 0.08, p95: 0.09, p99: 0.12 },
        mape: 0.085,
        predictionIntervalEnclosed: true,
        throughputComparison: { simulatedRps: 100, realRps: 100, relativeError: 0 },
      };

      const loss = computeCalibrationLoss(report);
      // 0.4 * 0.1 + 0.4 * 0.085 + 0.2 * 0.12 = 0.04 + 0.034 + 0.024 = 0.098
      expect(loss).toBeCloseTo(0.098);
    });

    it('adds 1.0 penalty when prediction interval is breached', () => {
      const report = {
        verdict: 'MISALIGNED' as const,
        quantileErrors: { p50: 0.4, p90: 0.5, p95: 0.5, p99: 0.6 },
        mape: 0.5,
        predictionIntervalEnclosed: false, // Breached
        throughputComparison: { simulatedRps: 100, realRps: 100, relativeError: 0 },
      };

      const loss = computeCalibrationLoss(report);
      expect(loss).toBeGreaterThan(1.0);
    });
  });

  describe('runCoordinateDescent', () => {
    it('adjusts parameter to target value minimizing loss', async () => {
      // True real target is 5000us
      const targetUs = 5000;

      const result = await runCoordinateDescent({
        parameters: [
          {
            name: 'op_latency',
            currentValue: 1000, // Miscalibrated initial guess
            minValue: 500,
            maxValue: 10000,
          },
        ],
        evaluator: async (params) => {
          const val = params.op_latency;
          const mape = Math.abs(val - targetUs) / targetUs;
          return {
            loss: mape,
            mape,
            verdict: mape < 0.1 ? 'ALIGNED' : 'MISALIGNED',
          };
        },
      });

      expect(result.converged).toBe(true);
      expect(result.finalLoss).toBeLessThan(result.initialLoss);
      expect(result.calibratedParameters.op_latency).toBeGreaterThanOrEqual(4000);
      expect(result.calibratedParameters.op_latency).toBeLessThanOrEqual(6000);
    });
  });

  describe('CalibrationEngine', () => {
    it('executes full closed loop from MISALIGNED to ALIGNED', async () => {
      const engine = new CalibrationEngine();

      // Real benchmark values
      const realBenchmark = {
        p50Us: 4000,
        p90Us: 6000,
        p95Us: 7000,
        p99Us: 9000,
        meanLatencyUs: 4500,
        throughputRps: 500,
        samplesUs: [3800, 4000, 4200, 6000, 9000],
      };

      const result = await engine.executeClosedLoop({
        parameters: [
          {
            name: 'service_latency',
            currentValue: 1500, // Initial estimate is too low (1500 vs 4000)
            minValue: 1000,
            maxValue: 8000,
          },
        ],
        realBenchmark,
        simulator: async (params) => {
          const base = params.service_latency;
          return {
            p50Us: base,
            p90Us: base * 1.5,
            p95Us: base * 1.75,
            p99Us: base * 2.25,
            meanLatencyUs: base * 1.1,
            throughputRps: 500,
            predictionInterval: [base * 0.85, base * 1.15],
            samplesUs: [base * 0.95, base, base * 1.05, base * 1.5, base * 2.25],
          };
        },
      });

      expect(result.initialReport.verdict).not.toBe('ALIGNED');
      expect(result.finalReport.verdict).toBe('ALIGNED');
      expect(result.isAligned).toBe(true);
      expect(result.calibrationResult.finalLoss).toBeLessThan(result.calibrationResult.initialLoss);
    });
  });
});
