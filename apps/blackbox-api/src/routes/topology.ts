import type { FastifyPluginAsync } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  db,
  projects,
  environments,
  topologyNodes,
  topologyEdges,
  operations,
  operationDependencies,
} from '@blackbox-x/db';
import {
  NodeKindSchema,
  EdgeKindSchema,
  DependencyModeSchema,
  ErrorCodes,
  createErrorEnvelope,
  type TopologyValidationReport,
} from '@blackbox-x/contracts';
import {
  TopologyGraph,
  validateTopology,
} from '@blackbox-x/domain';

export const topologyRoutes: FastifyPluginAsync = async (app) => {
  // Helper to extract tenant ID (enforces Part 8.10 tenant isolation)
  const getTenantId = (req: { headers: Record<string, unknown> }): string => {
    const tenantHeader = req.headers['x-tenant-id'];
    if (typeof tenantHeader === 'string' && tenantHeader.trim()) {
      return tenantHeader.trim();
    }
    return 'tnt_default';
  };

  // 1. Projects
  app.post('/api/v1/projects', async (req, reply) => {
    const tenantId = getTenantId(req);
    const body = req.body as { name: string; slug: string; description?: string };

    if (!body.name || !body.slug) {
      return reply
        .status(400)
        .send(createErrorEnvelope(ErrorCodes.VALIDATION_ERROR, 'Name and slug are required', req.id));
    }

    const id = `prj_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.insert(projects).values({
      id,
      tenantId,
      name: body.name,
      slug: body.slug,
      description: body.description ?? null,
    });

    const [created] = await db.select().from(projects).where(eq(projects.id, id));
    return reply.status(201).send(created);
  });

  app.get('/api/v1/projects', async (req, reply) => {
    const tenantId = getTenantId(req);
    const list = await db.select().from(projects).where(eq(projects.tenantId, tenantId));
    return reply.status(200).send(list);
  });

  // 2. Environments
  app.post('/api/v1/projects/:projectId/environments', async (req, reply) => {
    const tenantId = getTenantId(req);
    const { projectId } = req.params as { projectId: string };
    const body = req.body as { name: string; slug: string; description?: string };

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));

    if (!project) {
      return reply
        .status(404)
        .send(createErrorEnvelope(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found', req.id));
    }

    const id = `env_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.insert(environments).values({
      id,
      projectId,
      name: body.name,
      slug: body.slug,
      description: body.description ?? null,
    });

    const [created] = await db.select().from(environments).where(eq(environments.id, id));
    return reply.status(201).send(created);
  });

  // 3. Topology Nodes
  app.post('/api/v1/environments/:envId/nodes', async (req, reply) => {
    const { envId } = req.params as { envId: string };
    const body = req.body as {
      name: string;
      slug: string;
      kind: string;
      metadata?: Record<string, unknown>;
    };

    const kindParsed = NodeKindSchema.safeParse(body.kind);
    if (!kindParsed.success) {
      return reply
        .status(400)
        .send(
          createErrorEnvelope(
            ErrorCodes.VALIDATION_ERROR,
            `Invalid node kind: ${body.kind}`,
            req.id,
          ),
        );
    }

    const id = `node_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.insert(topologyNodes).values({
      id,
      environmentId: envId,
      name: body.name,
      slug: body.slug,
      kind: kindParsed.data,
      metadata: body.metadata ?? {},
    });

    const [created] = await db.select().from(topologyNodes).where(eq(topologyNodes.id, id));
    return reply.status(201).send(created);
  });

  app.get('/api/v1/environments/:envId/nodes', async (req, reply) => {
    const { envId } = req.params as { envId: string };
    const nodes = await db
      .select()
      .from(topologyNodes)
      .where(eq(topologyNodes.environmentId, envId));
    return reply.status(200).send(nodes);
  });

  // 4. Topology Edges
  app.post('/api/v1/environments/:envId/edges', async (req, reply) => {
    const { envId } = req.params as { envId: string };
    const body = req.body as {
      sourceNodeId: string;
      targetNodeId: string;
      kind: string;
      metadata?: Record<string, unknown>;
      p99LatencyMs?: number;
      timeoutMs?: number;
      retryCount?: number;
      trafficShare?: number;
    };

    const kindParsed = EdgeKindSchema.safeParse(body.kind);
    if (!kindParsed.success) {
      return reply
        .status(400)
        .send(
          createErrorEnvelope(
            ErrorCodes.VALIDATION_ERROR,
            `Invalid edge kind: ${body.kind}`,
            req.id,
          ),
        );
    }

    const id = `edge_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.insert(topologyEdges).values({
      id,
      environmentId: envId,
      sourceNodeId: body.sourceNodeId,
      targetNodeId: body.targetNodeId,
      kind: kindParsed.data,
      metadata: body.metadata ?? {},
      p99LatencyMs: body.p99LatencyMs ?? null,
      timeoutMs: body.timeoutMs ?? null,
      retryCount: body.retryCount ?? 0,
      trafficShare: body.trafficShare ?? 1.0,
    });

    const [created] = await db.select().from(topologyEdges).where(eq(topologyEdges.id, id));
    return reply.status(201).send(created);
  });

  app.get('/api/v1/environments/:envId/edges', async (req, reply) => {
    const { envId } = req.params as { envId: string };
    const edges = await db
      .select()
      .from(topologyEdges)
      .where(eq(topologyEdges.environmentId, envId));
    return reply.status(200).send(edges);
  });

  // 5. Topology Validation Endpoint
  app.post('/api/v1/environments/:envId/topology/validate', async (req, reply) => {
    const { envId } = req.params as { envId: string };
    const body = (req.body || {}) as { guard?: { maxHops?: number; ttlSeconds?: number; eventBudget?: number } };

    const nodes = await db
      .select()
      .from(topologyNodes)
      .where(eq(topologyNodes.environmentId, envId));
    const edges = await db
      .select()
      .from(topologyEdges)
      .where(eq(topologyEdges.environmentId, envId));

    const graph = new TopologyGraph();
    for (const node of nodes) {
      graph.addNode({
        id: node.id,
        name: node.name,
        kind: node.kind as import('@blackbox-x/contracts').NodeKind,
        metadata: (node.metadata as Record<string, unknown>) ?? {},
      });
    }

    for (const edge of edges) {
      graph.addEdge({
        id: edge.id,
        sourceId: edge.sourceNodeId,
        targetId: edge.targetNodeId,
        kind: edge.kind as import('@blackbox-x/contracts').EdgeKind,
        metadata: (edge.metadata as Record<string, unknown>) ?? {},
      });
    }

    const report = validateTopology(graph, body.guard);
    const response: TopologyValidationReport = {
      valid: report.valid,
      nodeCount: report.nodeCount,
      edgeCount: report.edgeCount,
      cyclesDetected: report.cycles.map((c) => ({
        path: c.path,
        classification: c.classification,
        permitted: c.permitted,
        reason: c.reason,
      })),
      errors: report.errors,
    };

    return reply.status(report.valid ? 200 : 422).send(response);
  });

  // 6. Project Aggregated Topology
  app.get('/api/v1/projects/:id/topology', async (req, reply) => {
    const tenantId = getTenantId(req);
    const { id: projectId } = req.params as { id: string };

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));

    if (!project) {
      return reply
        .status(404)
        .send(createErrorEnvelope(ErrorCodes.PROJECT_NOT_FOUND, 'Project not found', req.id));
    }

    const envList = await db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId));

    const envIds = envList.map((e) => e.id);
    const allNodes: unknown[] = [];
    const allEdges: unknown[] = [];

    for (const envId of envIds) {
      const n = await db
        .select()
        .from(topologyNodes)
        .where(eq(topologyNodes.environmentId, envId));
      const e = await db
        .select()
        .from(topologyEdges)
        .where(eq(topologyEdges.environmentId, envId));
      allNodes.push(...n);
      allEdges.push(...e);
    }

    return reply.status(200).send({
      project,
      environments: envList,
      nodes: allNodes,
      edges: allEdges,
    });
  });

  // 7. Operations & Operation Dependencies per Part 9.1
  app.post('/api/v1/nodes/:nodeId/operations', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const body = req.body as {
      name: string;
      method?: string;
      path?: string;
      timeoutMs?: number;
      concurrencyLimit?: number;
      serviceTimeDistribution?: string;
      serviceTimeParams?: Record<string, unknown>;
      dependencyCalls?: Array<{
        edgeId: string;
        targetOperationName?: string;
        callOrder?: number;
        executionMode?: string;
        required?: boolean;
      }>;
    };

    const [node] = await db.select().from(topologyNodes).where(eq(topologyNodes.id, nodeId));
    if (!node) {
      return reply
        .status(404)
        .send(createErrorEnvelope(ErrorCodes.VALIDATION_ERROR, 'Node not found', req.id));
    }

    const operationId = `op_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.insert(operations).values({
      id: operationId,
      nodeId,
      name: body.name,
      method: body.method ?? 'GET',
      path: body.path ?? '/',
      timeoutMs: body.timeoutMs ?? 2000,
      concurrencyLimit: body.concurrencyLimit ?? 100,
      serviceTimeDistribution: body.serviceTimeDistribution ?? 'lognormal',
      serviceTimeParams: body.serviceTimeParams ?? { p50: 30, p99: 150 },
    });

    if (body.dependencyCalls && Array.isArray(body.dependencyCalls)) {
      for (const call of body.dependencyCalls) {
        const modeParsed = DependencyModeSchema.safeParse(call.executionMode || 'SEQUENTIAL');
        const depId = `opdep_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

        await db.insert(operationDependencies).values({
          id: depId,
          operationId,
          edgeId: call.edgeId,
          targetOperationName: call.targetOperationName ?? null,
          callOrder: call.callOrder ?? 0,
          executionMode: modeParsed.success ? modeParsed.data : 'SEQUENTIAL',
          required: call.required ?? true,
        });
      }
    }

    const [createdOp] = await db.select().from(operations).where(eq(operations.id, operationId));
    const deps = await db
      .select()
      .from(operationDependencies)
      .where(eq(operationDependencies.operationId, operationId))
      .orderBy(asc(operationDependencies.callOrder));

    return reply.status(201).send({
      ...createdOp,
      dependencyCalls: deps,
    });
  });

  app.get('/api/v1/nodes/:nodeId/operations', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const ops = await db.select().from(operations).where(eq(operations.nodeId, nodeId));

    const results = [];
    for (const op of ops) {
      const deps = await db
        .select()
        .from(operationDependencies)
        .where(eq(operationDependencies.operationId, op.id))
        .orderBy(asc(operationDependencies.callOrder));
      results.push({
        ...op,
        dependencyCalls: deps,
      });
    }

    return reply.status(200).send(results);
  });
};
