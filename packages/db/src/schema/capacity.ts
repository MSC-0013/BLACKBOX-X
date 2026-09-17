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

export const capacitySearches = mysqlTable(
  'capacity_searches',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    targetP99Us: int('target_p99_us').notNull(),
    maxErrorRate: double('max_error_rate').notNull(),
    maxSustainableRps: double('max_sustainable_rps').notNull(),
    kneePointRps: double('knee_point_rps'),
    limitingComponent: varchar('limiting_component', { length: 255 }),
    limitingResource: varchar('limiting_resource', { length: 64 }),
    searchSummary: json('search_summary').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantProject: index('idx_capacity_tenant_proj').on(table.tenantId, table.projectId),
  }),
);

export const capacitySearchSteps = mysqlTable(
  'capacity_search_steps',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    capacitySearchId: varchar('capacity_search_id', { length: 64 })
      .notNull()
      .references(() => capacitySearches.id, { onDelete: 'cascade' }),
    stepIndex: int('step_index').notNull(),
    candidateRps: double('candidate_rps').notNull(),
    p99Us: int('p99_us').notNull(),
    errorRate: double('error_rate').notNull(),
    satisfiesSlo: boolean('satisfies_slo').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxSearchStep: index('idx_capacity_steps_search').on(table.capacitySearchId, table.stepIndex),
  }),
);
