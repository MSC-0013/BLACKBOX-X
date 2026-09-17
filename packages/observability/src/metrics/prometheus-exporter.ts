/**
 * Prometheus metrics collector and exporter adhering to standard Prometheus exposition format.
 * Enforces strict low-cardinality label policies per Part 8 and Milestone 11:
 * Allowed labels are exclusively: `service`, `environment`, `operation`, `status`, `worker_type`, `le`.
 * High-cardinality labels (such as `run_id`, `request_id`, `tenant_id`, `user_id`) are strictly prohibited.
 */

export const ALLOWED_LABEL_KEYS = new Set([
  'service',
  'environment',
  'operation',
  'status',
  'worker_type',
  'le',
]);

export const FORBIDDEN_LABEL_KEYS = new Set([
  'run_id',
  'runId',
  'request_id',
  'requestId',
  'tenant_id',
  'tenantId',
  'user_id',
  'userId',
  'session_id',
  'sessionId',
]);

export type MetricLabels = Record<string, string>;

export interface CounterMetric {
  name: string;
  help: string;
  type: 'counter';
  values: Map<string, { labels: MetricLabels; value: number }>;
}

export interface GaugeMetric {
  name: string;
  help: string;
  type: 'gauge';
  values: Map<string, { labels: MetricLabels; value: number }>;
}

export interface HistogramMetric {
  name: string;
  help: string;
  type: 'histogram';
  buckets: number[];
  records: Map<
    string,
    {
      labels: MetricLabels;
      bucketCounts: number[];
      sum: number;
      count: number;
    }
  >;
}

export class PrometheusRegistry {
  private counters = new Map<string, CounterMetric>();
  private gauges = new Map<string, GaugeMetric>();
  private histograms = new Map<string, HistogramMetric>();

  constructor() {
    this.registerStandardMetrics();
  }

  private registerStandardMetrics(): void {
    this.registerCounter(
      'blackbox_simulation_runs_total',
      'Total number of simulation runs executed by status and environment',
    );
    this.registerGauge(
      'blackbox_calibration_loss_mape',
      'Latest calibrated model mean absolute percentage error (loss)',
    );
    this.registerGauge(
      'blackbox_worker_pool_active',
      'Number of active workers in the distributed worker pool',
    );
    this.registerHistogram(
      'blackbox_request_duration_seconds',
      'Request duration distribution in seconds across API and simulation operations',
      [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    );
  }

  private validateLabels(labels: MetricLabels): void {
    for (const key of Object.keys(labels)) {
      if (FORBIDDEN_LABEL_KEYS.has(key)) {
        throw new Error(
          `High-cardinality label violation: '${key}' is strictly prohibited in Prometheus metrics. ` +
          `Only low-cardinality labels (${Array.from(ALLOWED_LABEL_KEYS).join(', ')}) are allowed.`,
        );
      }
      if (!ALLOWED_LABEL_KEYS.has(key)) {
        throw new Error(
          `Unauthorized label key: '${key}'. Low-cardinality policy permits only: ` +
          `${Array.from(ALLOWED_LABEL_KEYS).join(', ')}`,
        );
      }
    }
  }

  private serializeLabelKey(labels: MetricLabels): string {
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([k, v]) => `${k}="${v}"`).join(',');
  }

  registerCounter(name: string, help: string): void {
    if (this.counters.has(name)) return;
    this.counters.set(name, {
      name,
      help,
      type: 'counter',
      values: new Map(),
    });
  }

  registerGauge(name: string, help: string): void {
    if (this.gauges.has(name)) return;
    this.gauges.set(name, {
      name,
      help,
      type: 'gauge',
      values: new Map(),
    });
  }

  registerHistogram(name: string, help: string, buckets: number[]): void {
    if (this.histograms.has(name)) return;
    this.histograms.set(name, {
      name,
      help,
      type: 'histogram',
      buckets: [...buckets].sort((a, b) => a - b),
      records: new Map(),
    });
  }

  incrementCounter(name: string, labels: MetricLabels = {}, delta: number = 1): void {
    this.validateLabels(labels);
    const counter = this.counters.get(name);
    if (!counter) {
      throw new Error(`Counter ${name} not registered`);
    }
    const key = this.serializeLabelKey(labels);
    const curr = counter.values.get(key) ?? { labels, value: 0 };
    curr.value += delta;
    counter.values.set(key, curr);
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.validateLabels(labels);
    const gauge = this.gauges.get(name);
    if (!gauge) {
      throw new Error(`Gauge ${name} not registered`);
    }
    const key = this.serializeLabelKey(labels);
    gauge.values.set(key, { labels, value });
  }

  observeHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    this.validateLabels(labels);
    const histogram = this.histograms.get(name);
    if (!histogram) {
      throw new Error(`Histogram ${name} not registered`);
    }
    const key = this.serializeLabelKey(labels);
    let record = histogram.records.get(key);
    if (!record) {
      record = {
        labels,
        bucketCounts: new Array(histogram.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      histogram.records.set(key, record);
    }

    record.sum += value;
    record.count += 1;

    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]!) {
        record.bucketCounts[i] += 1;
      }
    }
  }

  getMetricsText(): string {
    const lines: string[] = [];

    // 1. Counters
    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} ${counter.type}`);
      if (counter.values.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [, item] of counter.values) {
          const lbls = this.serializeLabelKey(item.labels);
          const labelStr = lbls ? `{${lbls}}` : '';
          lines.push(`${name}${labelStr} ${item.value}`);
        }
      }
    }

    // 2. Gauges
    for (const [name, gauge] of this.gauges) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} ${gauge.type}`);
      if (gauge.values.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [, item] of gauge.values) {
          const lbls = this.serializeLabelKey(item.labels);
          const labelStr = lbls ? `{${lbls}}` : '';
          lines.push(`${name}${labelStr} ${item.value}`);
        }
      }
    }

    // 3. Histograms
    for (const [name, histogram] of this.histograms) {
      lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} ${histogram.type}`);
      if (histogram.records.size === 0) {
        for (const b of histogram.buckets) {
          lines.push(`${name}_bucket{le="${b}"} 0`);
        }
        lines.push(`${name}_bucket{le="+Inf"} 0`);
        lines.push(`${name}_sum 0`);
        lines.push(`${name}_count 0`);
      } else {
        for (const [, record] of histogram.records) {
          const baseLbls = Object.entries(record.labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`);

          let cumulative = 0;
          for (let i = 0; i < histogram.buckets.length; i++) {
            cumulative += record.bucketCounts[i]!;
            const bucketLbls = [...baseLbls, `le="${histogram.buckets[i]}"`].join(',');
            lines.push(`${name}_bucket{${bucketLbls}} ${cumulative}`);
          }
          const infLbls = [...baseLbls, 'le="+Inf"'].join(',');
          lines.push(`${name}_bucket{${infLbls}} ${record.count}`);

          const statLbls = baseLbls.length > 0 ? `{${baseLbls.join(',')}}` : '';
          lines.push(`${name}_sum${statLbls} ${record.sum.toFixed(6)}`);
          lines.push(`${name}_count${statLbls} ${record.count}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    for (const counter of this.counters.values()) {
      counter.values.clear();
    }
    for (const gauge of this.gauges.values()) {
      gauge.values.clear();
    }
    for (const hist of this.histograms.values()) {
      hist.records.clear();
    }
  }
}

export const defaultMetricsRegistry = new PrometheusRegistry();
