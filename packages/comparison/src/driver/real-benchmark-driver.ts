import { Histogram, WelfordAccumulator } from '@blackbox-x/statistics';

export interface BenchmarkOptions {
  targetUrl: string;
  totalRequests: number;
  concurrency: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export interface BenchmarkResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  durationMs: number;
  throughputRps: number;
  samplesUs: number[];
  p50Us: number;
  p90Us: number;
  p95Us: number;
  p99Us: number;
  meanLatencyUs: number;
}

export async function executeBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const {
    targetUrl,
    totalRequests,
    concurrency,
    headers = {},
    method = 'GET',
    body,
  } = options;

  const histogram = new Histogram();
  const welford = new WelfordAccumulator();
  const samplesUs: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;
  let remaining = totalRequests;

  const startHr = process.hrtime.bigint();

  const worker = async () => {
    while (remaining > 0) {
      remaining--;
      const reqStart = process.hrtime.bigint();
      try {
        const res = await fetch(targetUrl, {
          method,
          headers,
          body,
        });

        const reqEnd = process.hrtime.bigint();
        const latencyUs = Number((reqEnd - reqStart) / 1000n);

        if (res.ok) {
          successfulRequests++;
          histogram.record(latencyUs);
          welford.update(latencyUs);
          samplesUs.push(latencyUs);
        } else {
          failedRequests++;
        }
      } catch (_err) {
        failedRequests++;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker());
  await Promise.all(workers);

  const endHr = process.hrtime.bigint();
  const durationMs = Number((endHr - startHr) / 1_000_000n);
  const durationSec = Math.max(0.001, durationMs / 1000);
  const throughputRps = successfulRequests / durationSec;

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    durationMs,
    throughputRps,
    samplesUs,
    p50Us: histogram.quantile(0.5),
    p90Us: histogram.quantile(0.9),
    p95Us: histogram.quantile(0.95),
    p99Us: histogram.quantile(0.99),
    meanLatencyUs: Math.round(welford.mean || 0),
  };
}
