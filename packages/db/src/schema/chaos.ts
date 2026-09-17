import {
  mysqlTable,
  varchar,
  datetime,
  int,
  bigint,
  double,
  boolean,
  json,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';
import { projects } from './topology.js';

export const chaosExperiments = mysqlTable(
  'chaos_experiments',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    faultType: varchar('fault_type', { length: 64 }).notNull(),
    targetNodeId: varchar('target_node_id', { length: 64 }).notNull(),
    targetEdgeId: varchar('target_edge_id', { length: 64 }),
    parameters: json('parameters').notNull(),
    durationSec: int('duration_sec').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantProject: index('idx_chaos_tenant_proj').on(table.tenantId, table.projectId),
  }),
);

export const chaosExperimentRuns = mysqlTable(
  'chaos_experiment_runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    experimentId: varchar('experiment_id', { length: 64 })
      .notNull()
      .references(() => chaosExperiments.id, { onDelete: 'cascade' }),
    resilienceScore: double('resilience_score').notNull(),
    blastRadius: int('blast_radius').notNull(),
    mttrMs: double('mttr_ms').notNull(),
    cascadeDetected: boolean('cascade_detected').notNull().default(false),
    totalRequests: bigint('total_requests', { mode: 'number' }).notNull(),
    failedRequests: bigint('failed_requests', { mode: 'number' }).notNull(),
    degradedRequests: bigint('degraded_requests', { mode: 'number' }).notNull(),
    startedAt: datetime('started_at', { mode: 'date', fsp: 6 }).notNull(),
    completedAt: datetime('completed_at', { mode: 'date', fsp: 6 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxExp: index('idx_chaos_run_exp').on(table.experimentId),
  }),
);
