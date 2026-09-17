import { z } from 'zod';

// Node Kinds per Part 2 (M1)
export const NodeKindSchema = z.enum([
  'SERVICE',
  'DATABASE',
  'CACHE',
  'OBJECT_STORE',
  'SEARCH',
  'MESSAGE_BROKER',
  'EXTERNAL_API',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

// Edge Kinds per Part 2 (M1)
export const EdgeKindSchema = z.enum([
  'SYNC_HTTP',
  'SYNC_GRPC',
  'DB_QUERY',
  'CACHE_READ',
  'CACHE_WRITE',
  'OBJECT_READ',
  'OBJECT_WRITE',
  'KAFKA_PUBLISH',
  'KAFKA_CONSUME',
  'EXTERNAL_HTTP',
]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const SynchronousEdgeKinds = new Set<EdgeKind>([
  'SYNC_HTTP',
  'SYNC_GRPC',
  'DB_QUERY',
  'CACHE_READ',
  'CACHE_WRITE',
  'OBJECT_READ',
  'OBJECT_WRITE',
  'EXTERNAL_HTTP',
]);

export const AsynchronousEdgeKinds = new Set<EdgeKind>([
  'KAFKA_PUBLISH',
  'KAFKA_CONSUME',
]);

// Dependency Modes per Part 9.1
export const DependencyModeSchema = z.enum([
  'SEQUENTIAL',
  'PARALLEL',
  'OPTIONAL',
  'RACE',
  'FALLBACK',
  'ASYNC',
]);
export type DependencyMode = z.infer<typeof DependencyModeSchema>;

// Runaway Guard for mixed cycles
export const RunawayGuardSchema = z.object({
  maxHops: z.number().int().positive().optional(),
  ttlSeconds: z.number().positive().optional(),
  eventBudget: z.number().int().positive().optional(),
});
export type RunawayGuard = z.infer<typeof RunawayGuardSchema>;

// Cycle Classification
export const CycleClassificationSchema = z.enum([
  'ALL_SYNCHRONOUS',
  'ASYNC_EVENT_DRIVEN',
  'MIXED',
]);
export type CycleClassification = z.infer<typeof CycleClassificationSchema>;

// Project Schema
export const ProjectSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// Environment Schema
export const EnvironmentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

// Topology Node Schema
export const TopologyNodeSchema = z.object({
  id: z.string(),
  environmentId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  kind: NodeKindSchema,
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;

// Topology Edge Schema
export const TopologyEdgeSchema = z.object({
  id: z.string(),
  environmentId: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  kind: EdgeKindSchema,
  metadata: z.record(z.unknown()).default({}),
  p99LatencyMs: z.number().nonnegative().optional(),
  timeoutMs: z.number().positive().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  trafficShare: z.number().min(0).max(1).default(1.0),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>;

// Operation Schema
export const OperationSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string().min(1),
  method: z.string().default('GET'),
  path: z.string().default('/'),
  timeoutMs: z.number().positive().default(2000),
  concurrencyLimit: z.number().int().positive().default(100),
  serviceTimeDistribution: z.enum(['constant', 'normal', 'lognormal', 'exponential']).default('lognormal'),
  serviceTimeParams: z.record(z.unknown()).default({ p50: 30, p99: 150 }),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});
export type Operation = z.infer<typeof OperationSchema>;

// Operation Dependency Schema
export const OperationDependencySchema = z.object({
  id: z.string(),
  operationId: z.string(),
  edgeId: z.string(),
  targetOperationName: z.string().optional(),
  callOrder: z.number().int().nonnegative().default(0),
  executionMode: DependencyModeSchema.default('SEQUENTIAL'),
  required: z.boolean().default(true),
  createdAt: z.date().optional(),
});
export type OperationDependency = z.infer<typeof OperationDependencySchema>;

// Topology Validation Report
export const TopologyValidationReportSchema = z.object({
  valid: z.boolean(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  cyclesDetected: z.array(
    z.object({
      path: z.array(z.string()),
      classification: CycleClassificationSchema,
      permitted: z.boolean(),
      reason: z.string(),
    }),
  ),
  errors: z.array(z.string()),
});
export type TopologyValidationReport = z.infer<typeof TopologyValidationReportSchema>;
