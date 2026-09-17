import { describe, it, expect } from 'vitest';
import {
  SubStream,
  deriveStreamSeed,
  createNormalICDFTable,
  LogLinearHistogram,
  WelfordStats,
  computePredictionInterval,
  verifyLittlesLaw,
} from '../index.js';

describe('Statistics Package', () => {
  it('guarantees deterministic PRNG outputs for identical seeds', () => {
    const seed1 = 0x1234567890abcdefn;
    const stream1 = new SubStream('streamA', seed1);
    const stream2 = new SubStream('streamA', seed1);

    for (let i = 0; i < 100; i++) {
      expect(stream1.nextUint64()).toBe(stream2.nextUint64());
      expect(stream1.nextFloat01()).toBe(stream2.nextFloat01());
    }
  });

  it('derives distinct substream seeds using FNV-1a splitter', () => {
    const rootSeed = 0xabcdef0123456789n;
    const seedA = deriveStreamSeed(rootSeed, 'traffic_arrivals');
    const seedB = deriveStreamSeed(rootSeed, 'cache_latency');
    expect(seedA).not.toBe(seedB);
  });

  it('generates exponential inter-arrival times matching 1/lambda', () => {
    const stream = new SubStream('poisson', 0x42n);
    const lambda = 500;
    const n = 50000;
    let sum = 0;

    for (let i = 0; i < n; i++) {
      sum += stream.nextExponential(lambda);
    }

    const empiricalMean = sum / n;
    const theoreticalMean = 1 / lambda;
    // Within 2% error for 50k samples
    const relativeError = Math.abs(empiricalMean - theoreticalMean) / theoreticalMean;
    expect(relativeError).toBeLessThan(0.02);
  });

  it('samples normal distribution via versioned ICDF table', () => {
    const table = createNormalICDFTable(1000, 200);
    expect(table.algorithmVersion).toBe('acklam.v1');
    expect(table.tableVersion).toBe('table.v1');

    // Median (p=0.5) should be very close to mean
    const median = table.sample(0.5);
    expect(Math.abs(median - 1000)).toBeLessThanOrEqual(5);
  });

  it('records and merges LogLinearHistogram percentiles', () => {
    const h1 = new LogLinearHistogram();
    const h2 = new LogLinearHistogram();

    for (let i = 1; i <= 500; i++) h1.record(i * 10);
    for (let i = 501; i <= 1000; i++) h2.record(i * 10);

    h1.merge(h2);
    expect(h1.count).toBe(1000);
    expect(h1.min).toBeLessThanOrEqual(10);
    expect(h1.max).toBeGreaterThanOrEqual(10000);

    // p50 should be around 5000us
    const p50 = h1.p50();
    expect(Math.abs(p50 - 5000) / 5000).toBeLessThan(0.05);
  });

  it('calculates online mean and variance using Welford algorithm', () => {
    const w = new WelfordStats();
    const data = [10, 20, 30, 40, 50];
    for (const d of data) w.update(d);

    expect(w.count).toBe(5);
    expect(w.mean).toBe(30);
    expect(w.variance).toBe(250);
  });

  it('computes prediction interval with explicit predictionInterval key (Pass 3)', () => {
    const samples = [100, 102, 98, 105, 95, 101, 99, 103, 97, 100];
    const result = computePredictionInterval(samples, 0.9);

    expect(result).toHaveProperty('predictionInterval');
    expect(result).not.toHaveProperty('confidenceInterval');
    expect(result.predictionInterval[0]).toBeLessThan(result.mean);
    expect(result.predictionInterval[1]).toBeGreaterThan(result.mean);
  });

  it('verifies Little Law satisfaction', () => {
    const lambda = 100; // 100 RPS
    const W = 0.05; // 50ms = 0.05s
    const L_expected = 5; // 100 * 0.05 = 5 in-flight

    const passResult = verifyLittlesLaw(5.1, lambda, W);
    expect(passResult.expectedL).toBe(L_expected);
    expect(passResult.satisfies).toBe(true);

    const failResult = verifyLittlesLaw(15.0, lambda, W);
    expect(failResult.satisfies).toBe(false);
  });
});
