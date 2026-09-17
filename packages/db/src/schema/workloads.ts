import {
  mysqlTable,
  varchar,
  datetime,
  int,
  text,
  json,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';
import { projects } from './topology.js';

export const workloads = mysqlTable(
  'workloads',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    description: text('description'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uqTenantSlug: uniqueIndex('uq_workload_tenant_slug').on(table.tenantId, table.slug),
    idxTenantCreated: index('idx_workloads_tenant_created').on(table.tenantId, table.createdAt),
  }),
);

export const workloadVersions = mysqlTable(
  'workload_versions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    workloadId: varchar('workload_id', { length: 64 })
      .notNull()
      .references(() => workloads.id, { onDelete: 'cascade' }),
    versionNumber: int('version_number').notNull(),
    arrivalPattern: varchar('arrival_pattern', { length: 32 }).notNull(),
    arrivalParams: json('arrival_params').notNull(),
    requestMix: json('request_mix').notNull(),
    phaseSchedule: json('phase_schedule').notNull(),
    retryPolicy: json('retry_policy'),
    circuitBreakerPolicy: json('circuit_breaker_policy'),
    seedPolicy: json('seed_policy'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uqWorkloadVersion: uniqueIndex('uq_workload_version').on(table.workloadId, table.versionNumber),
    idxWorkload: index('idx_workload_versions_workload').on(table.workloadId),
  }),
);

export const experimentCampaigns = mysqlTable(
  'experiment_campaigns',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    campaignType: varchar('campaign_type', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    config: json('config').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantProject: index('idx_campaigns_tenant_proj').on(table.tenantId, table.projectId),
  }),
);

export const campaignRuns = mysqlTable(
  'campaign_runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    campaignId: varchar('campaign_id', { length: 64 })
      .notNull()
      .references(() => experimentCampaigns.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 64 }).notNull(),
    runIndex: int('run_index').notNull(),
    parameters: json('parameters').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxCampaignRun: index('idx_campaign_runs_campaign').on(table.campaignId, table.runIndex),
  }),
);
