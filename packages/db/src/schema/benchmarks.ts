import {
  mysqlTable,
  varchar,
  datetime,
  int,
  double,
  boolean,
  json,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';
import { projects } from './topology.js';

export const benchmarks = mysqlTable(
  'benchmarks',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    driver: varchar('driver', { length: 32 }).notNull(),
    targetUrl: varchar('target_url', { length: 1024 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    throughputRps: double('throughput_rps').notNull(),
    p50Us: int('p50_us').notNull(),
    p90Us: int('p90_us').notNull(),
    p95Us: int('p95_us').notNull(),
    p99Us: int('p99_us').notNull(),
    metricsSummary: json('metrics_summary').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantProject: index('idx_benchmarks_tenant_proj').on(table.tenantId, table.projectId),
  }),
);

export const benchmarkComparisons = mysqlTable(
  'benchmark_comparisons',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    benchmarkId: varchar('benchmark_id', { length: 64 })
      .notNull()
      .references(() => benchmarks.id, { onDelete: 'cascade' }),
    simulationRunId: varchar('simulation_run_id', { length: 64 }).notNull(),
    verdict: varchar('verdict', { length: 32 }).notNull(),
    ksStatistic: double('ks_statistic'),
    mape: double('mape').notNull(),
    p50Error: double('p50_error').notNull(),
    p99Error: double('p99_error').notNull(),
    predictionIntervalEnclosed: boolean('prediction_interval_enclosed').notNull(),
    reportData: json('report_data').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxBenchmark: index('idx_comparisons_benchmark').on(table.benchmarkId),
  }),
);
