import {
  mysqlTable,
  varchar,
  datetime,
  int,
  bigint,
  double,
  json,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';

export const loadGeneratorWorkers = mysqlTable(
  'load_generator_workers',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    workerId: varchar('worker_id', { length: 64 }).notNull().unique(),
    hostname: varchar('hostname', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('IDLE'),
    heartbeatAt: datetime('heartbeat_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    registeredAt: datetime('registered_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    metadata: json('metadata'),
  },
  (table) => ({
    idxStatus: index('idx_load_worker_status').on(table.status, table.heartbeatAt),
  }),
);

export const loadOrchestratorRuns = mysqlTable(
  'load_orchestrator_runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 64 }).notNull().unique(),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    targetUrl: varchar('target_url', { length: 512 }).notNull(),
    pattern: varchar('pattern', { length: 32 }).notNull(),
    durationSec: int('duration_sec').notNull(),
    targetRps: int('target_rps').notNull(),
    allocatedWorkers: int('allocated_workers').notNull().default(1),
    totalRequests: bigint('total_requests', { mode: 'number' }).notNull().default(0),
    successfulRequests: bigint('successful_requests', { mode: 'number' }).notNull().default(0),
    failedRequests: bigint('failed_requests', { mode: 'number' }).notNull().default(0),
    p50Us: double('p50_us'),
    p90Us: double('p90_us'),
    p95Us: double('p95_us'),
    p99Us: double('p99_us'),
    meanUs: double('mean_us'),
    actualRps: double('actual_rps'),
    errorRate: double('error_rate').notNull().default(0),
    startedAt: datetime('started_at', { mode: 'date', fsp: 6 }),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 6 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantStatus: index('idx_load_run_tenant').on(table.tenantId, table.status),
  }),
);

export const loadWorkerMetrics = mysqlTable(
  'load_worker_metrics',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    runId: varchar('run_id', { length: 64 })
      .notNull()
      .references(() => loadOrchestratorRuns.runId, { onDelete: 'cascade' }),
    workerId: varchar('worker_id', { length: 64 }).notNull(),
    recordedAt: datetime('recorded_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    currentRps: double('current_rps').notNull(),
    requests: int('requests').notNull(),
    errors: int('errors').notNull(),
    p50Us: double('p50_us'),
    p99Us: double('p99_us'),
  },
  (table) => ({
    idxRunWorker: index('idx_load_metrics_run_worker').on(table.runId, table.workerId, table.recordedAt),
  }),
);
