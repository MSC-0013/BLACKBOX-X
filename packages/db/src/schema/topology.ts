import {
  mysqlTable,
  varchar,
  datetime,
  int,
  bigint,
  double,
  boolean,
  text,
  json,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';

export const projects = mysqlTable(
  'projects',
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
    uqTenantSlug: uniqueIndex('uq_project_tenant_slug').on(table.tenantId, table.slug),
    idxTenantCreated: index('idx_projects_tenant_created').on(table.tenantId, table.createdAt),
  }),
);

export const environments = mysqlTable(
  'environments',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
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
    uqProjectSlug: uniqueIndex('uq_env_project_slug').on(table.projectId, table.slug),
    idxProject: index('idx_environments_project').on(table.projectId),
  }),
);

export const topologyNodes = mysqlTable(
  'topology_nodes',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    environmentId: varchar('environment_id', { length: 64 })
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    metadata: json('metadata').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uqEnvSlug: uniqueIndex('uq_node_env_slug').on(table.environmentId, table.slug),
    idxEnvKind: index('idx_nodes_env_kind').on(table.environmentId, table.kind),
  }),
);

export const topologyEdges = mysqlTable(
  'topology_edges',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    environmentId: varchar('environment_id', { length: 64 })
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    sourceNodeId: varchar('source_node_id', { length: 64 })
      .notNull()
      .references(() => topologyNodes.id, { onDelete: 'cascade' }),
    targetNodeId: varchar('target_node_id', { length: 64 })
      .notNull()
      .references(() => topologyNodes.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    metadata: json('metadata').notNull(),
    p99LatencyMs: double('p99_latency_ms'),
    timeoutMs: double('timeout_ms'),
    retryCount: int('retry_count').notNull().default(0),
    trafficShare: double('traffic_share').notNull().default(1.0),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxEnvSource: index('idx_edges_env_source').on(table.environmentId, table.sourceNodeId),
    idxTarget: index('idx_edges_target').on(table.targetNodeId),
  }),
);

export const operations = mysqlTable(
  'operations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    nodeId: varchar('node_id', { length: 64 })
      .notNull()
      .references(() => topologyNodes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    method: varchar('method', { length: 16 }).notNull().default('GET'),
    path: varchar('path', { length: 255 }).notNull().default('/'),
    timeoutMs: double('timeout_ms').notNull().default(2000),
    concurrencyLimit: int('concurrency_limit').notNull().default(100),
    serviceTimeDistribution: varchar('service_time_distribution', { length: 32 })
      .notNull()
      .default('lognormal'),
    serviceTimeParams: json('service_time_params').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uqNodeName: uniqueIndex('uq_operation_node_name').on(table.nodeId, table.name),
    idxNodeMethod: index('idx_operations_node_method').on(table.nodeId, table.method, table.path),
  }),
);

export const operationDependencies = mysqlTable(
  'operation_dependencies',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    operationId: varchar('operation_id', { length: 64 })
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    edgeId: varchar('edge_id', { length: 64 })
      .notNull()
      .references(() => topologyEdges.id, { onDelete: 'cascade' }),
    targetOperationName: varchar('target_operation_name', { length: 255 }),
    callOrder: int('call_order').notNull().default(0),
    executionMode: varchar('execution_mode', { length: 32 })
      .notNull()
      .default('SEQUENTIAL'),
    required: boolean('required').notNull().default(true),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxOp: index('idx_opdeps_operation').on(table.operationId),
    idxEdge: index('idx_opdeps_edge').on(table.edgeId),
  }),
);

export const operationPolicies = mysqlTable('operation_policies', {
  id: varchar('id', { length: 64 }).primaryKey(),
  operationId: varchar('operation_id', { length: 64 })
    .notNull()
    .unique()
    .references(() => operations.id, { onDelete: 'cascade' }),
  retryMaxAttempts: int('retry_max_attempts').notNull().default(3),
  retryBackoffMs: double('retry_backoff_ms').notNull().default(100),
  retryBudgetPercent: double('retry_budget_percent').notNull().default(20),
  circuitBreakerEnabled: boolean('circuit_breaker_enabled').notNull().default(true),
  timeoutMs: double('timeout_ms').notNull().default(2000),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const operationResourceProfiles = mysqlTable('operation_resource_profiles', {
  id: varchar('id', { length: 64 }).primaryKey(),
  operationId: varchar('operation_id', { length: 64 })
    .notNull()
    .unique()
    .references(() => operations.id, { onDelete: 'cascade' }),
  cpuWeight: double('cpu_weight').notNull().default(1.0),
  memoryBytes: bigint('memory_bytes', { mode: 'number' }).notNull().default(1048576),
  connectionSlots: int('connection_slots').notNull().default(1),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
    .notNull()
    .$defaultFn(() => new Date()),
});
