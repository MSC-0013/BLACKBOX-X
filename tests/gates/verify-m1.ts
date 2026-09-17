import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations } from '@blackbox-x/db';
import {
  TopologyGraph,
  validateTopology,
  topologicalSort,
} from '@blackbox-x/domain';
import { buildServer } from '../../apps/blackbox-api/src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function verifyNoMockInGates(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      verifyNoMockInGates(fullPath);
    } else if (
      entry.name.includes('mock') ||
      entry.name.endsWith('.mock.ts') ||
      entry.name.endsWith('.mock.js')
    ) {
      throw new Error(`Violation: Mock file found in gates test directory: ${fullPath}`);
    }
  }
}

async function runM1Gate() {
  console.log('===============================================================');
  console.log('       BLACKBOX-X M1 GATE: Domain & Typed Topology             ');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are up to date
  console.log('Ensuring all migrations up through 002_topology are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  const app = buildServer();
  await app.ready();

  const tenantId = `tnt_m1_${Date.now()}`;
  const headers = { 'x-tenant-id': tenantId };

  // Ensure tenant exists in database (validates foreign key constraint fk_projects_tenant)
  await pool.query('INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)', [
    tenantId,
    `slug-${tenantId}`,
    'M1 Verification Tenant',
  ]);

  // ---------------------------------------------------------------------------
  // 1. Create project -> environment -> Order/Payment SERVICE nodes + Kafka MESSAGE_BROKER
  // ---------------------------------------------------------------------------
  console.log('[1/7] Creating Project, Environment, Typed Nodes, and Edges via API...');
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers,
    payload: { name: 'E-Commerce Core', slug: `ecommerce-${Date.now()}` },
  });
  assert.strictEqual(projRes.statusCode, 201);
  const project = JSON.parse(projRes.payload);

  const envRes = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project.id}/environments`,
    headers,
    payload: { name: 'Production Sim', slug: 'prod-sim' },
  });
  assert.strictEqual(envRes.statusCode, 201);
  const environment = JSON.parse(envRes.payload);

  // Nodes
  const orderRes = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/nodes`,
    headers,
    payload: { name: 'Order Service', slug: 'order-service', kind: 'SERVICE' },
  });
  assert.strictEqual(orderRes.statusCode, 201);
  const orderNode = JSON.parse(orderRes.payload);

  const paymentRes = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/nodes`,
    headers,
    payload: { name: 'Payment Service', slug: 'payment-service', kind: 'SERVICE' },
  });
  assert.strictEqual(paymentRes.statusCode, 201);
  const paymentNode = JSON.parse(paymentRes.payload);

  const kafkaRes = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/nodes`,
    headers,
    payload: { name: 'Kafka Main', slug: 'kafka-main', kind: 'MESSAGE_BROKER' },
  });
  assert.strictEqual(kafkaRes.statusCode, 201);
  const kafkaNode = JSON.parse(kafkaRes.payload);

  const notifyRes = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/nodes`,
    headers,
    payload: { name: 'Notification Service', slug: 'notification-service', kind: 'SERVICE' },
  });
  assert.strictEqual(notifyRes.statusCode, 201);
  const notifyNode = JSON.parse(notifyRes.payload);

  // Edges: Order --SYNC_HTTP--> Payment
  const edge1Res = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/edges`,
    headers,
    payload: {
      sourceNodeId: orderNode.id,
      targetNodeId: paymentNode.id,
      kind: 'SYNC_HTTP',
      p99LatencyMs: 120,
      timeoutMs: 2000,
    },
  });
  assert.strictEqual(edge1Res.statusCode, 201);
  const edgePayment = JSON.parse(edge1Res.payload);

  // Edges: Order --KAFKA_PUBLISH--> Kafka
  const edge2Res = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/edges`,
    headers,
    payload: {
      sourceNodeId: orderNode.id,
      targetNodeId: kafkaNode.id,
      kind: 'KAFKA_PUBLISH',
    },
  });
  assert.strictEqual(edge2Res.statusCode, 201);
  const edgeKafkaPub = JSON.parse(edge2Res.payload);

  // Edges: Kafka --KAFKA_CONSUME--> Notification
  const edge3Res = await app.inject({
    method: 'POST',
    url: `/api/v1/environments/${environment.id}/edges`,
    headers,
    payload: {
      sourceNodeId: kafkaNode.id,
      targetNodeId: notifyNode.id,
      kind: 'KAFKA_CONSUME',
    },
  });
  assert.strictEqual(edge3Res.statusCode, 201);
  console.log('✓ Created project, environment, 4 typed nodes (including MESSAGE_BROKER), and 3 edges\n');

  // ---------------------------------------------------------------------------
  // 2. Topological sort across mixed node kinds
  // ---------------------------------------------------------------------------
  console.log('[2/7] Testing topological sort across mixed node kinds...');
  const testGraph = new TopologyGraph();
  testGraph.addNode({ id: 'gateway', name: 'API Gateway', kind: 'SERVICE' });
  testGraph.addNode({ id: 'order', name: 'Order Service', kind: 'SERVICE' });
  testGraph.addNode({ id: 'kafka', name: 'Kafka Broker', kind: 'MESSAGE_BROKER' });
  testGraph.addNode({ id: 'notify', name: 'Notification Service', kind: 'SERVICE' });
  testGraph.addNode({ id: 'db', name: 'MySQL DB', kind: 'DATABASE' });

  testGraph.addEdge({ id: 'e1', sourceId: 'gateway', targetId: 'order', kind: 'SYNC_HTTP' });
  testGraph.addEdge({ id: 'e2', sourceId: 'order', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
  testGraph.addEdge({ id: 'e3', sourceId: 'kafka', targetId: 'notify', kind: 'KAFKA_CONSUME' });
  testGraph.addEdge({ id: 'e4', sourceId: 'notify', targetId: 'db', kind: 'DB_QUERY' });

  const sortedOrder = topologicalSort(testGraph);
  assert.deepStrictEqual(sortedOrder, ['gateway', 'order', 'kafka', 'notify', 'db']);
  console.log('✓ Topological sort correctly ordered mixed node kinds: [GATEWAY -> SERVICE -> MESSAGE_BROKER -> SERVICE -> DATABASE]\n');

  // ---------------------------------------------------------------------------
  // 3. All-synchronous cycle is REJECTED
  // ---------------------------------------------------------------------------
  console.log('[3/7] Asserting all-synchronous cycle is rejected...');
  const syncCycleGraph = new TopologyGraph();
  syncCycleGraph.addNode({ id: 'srvA', name: 'Service A', kind: 'SERVICE' });
  syncCycleGraph.addNode({ id: 'srvB', name: 'Service B', kind: 'SERVICE' });
  syncCycleGraph.addNode({ id: 'srvC', name: 'Service C', kind: 'SERVICE' });

  syncCycleGraph.addEdge({ id: 'e1', sourceId: 'srvA', targetId: 'srvB', kind: 'SYNC_HTTP' });
  syncCycleGraph.addEdge({ id: 'e2', sourceId: 'srvB', targetId: 'srvC', kind: 'SYNC_HTTP' });
  syncCycleGraph.addEdge({ id: 'e3', sourceId: 'srvC', targetId: 'srvA', kind: 'SYNC_HTTP' });

  const syncValidation = validateTopology(syncCycleGraph);
  assert.strictEqual(syncValidation.valid, false, 'Synchronous cycle must invalidate topology');
  assert.strictEqual(syncValidation.cycles[0]?.classification, 'ALL_SYNCHRONOUS');
  assert.strictEqual(syncValidation.cycles[0]?.permitted, false);
  console.log('✓ All-synchronous cycle strictly rejected with ALL_SYNCHRONOUS classification\n');

  // ---------------------------------------------------------------------------
  // 4. Kafka-mediated loop is ACCEPTED
  // ---------------------------------------------------------------------------
  console.log('[4/7] Asserting Kafka-mediated asynchronous feedback loop is accepted...');
  const kafkaLoopGraph = new TopologyGraph();
  kafkaLoopGraph.addNode({ id: 'srvA', name: 'Order Service', kind: 'SERVICE' });
  kafkaLoopGraph.addNode({ id: 'kafka', name: 'Kafka Cluster', kind: 'MESSAGE_BROKER' });
  kafkaLoopGraph.addNode({ id: 'srvB', name: 'Notification Service', kind: 'SERVICE' });

  kafkaLoopGraph.addEdge({ id: 'e1', sourceId: 'srvA', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
  kafkaLoopGraph.addEdge({ id: 'e2', sourceId: 'kafka', targetId: 'srvB', kind: 'KAFKA_CONSUME' });
  kafkaLoopGraph.addEdge({ id: 'e3', sourceId: 'srvB', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
  kafkaLoopGraph.addEdge({ id: 'e4', sourceId: 'kafka', targetId: 'srvA', kind: 'KAFKA_CONSUME' });

  const kafkaValidation = validateTopology(kafkaLoopGraph);
  assert.strictEqual(kafkaValidation.valid, true, 'Kafka-mediated loop must be permitted');
  assert.strictEqual(kafkaValidation.cycles[0]?.classification, 'ASYNC_EVENT_DRIVEN');
  assert.strictEqual(kafkaValidation.cycles[0]?.permitted, true);
  console.log('✓ Kafka-mediated cycle accepted with ASYNC_EVENT_DRIVEN classification\n');

  // ---------------------------------------------------------------------------
  // 5. Mixed cycle: rejected without guard, accepted with declared runaway guard
  // ---------------------------------------------------------------------------
  console.log('[5/7] Asserting mixed cycle requires explicit runaway guard...');
  const mixedGraph = new TopologyGraph();
  mixedGraph.addNode({ id: 'srvA', name: 'Order Service', kind: 'SERVICE' });
  mixedGraph.addNode({ id: 'srvB', name: 'Payment Service', kind: 'SERVICE' });
  mixedGraph.addNode({ id: 'kafka', name: 'Kafka Broker', kind: 'MESSAGE_BROKER' });

  mixedGraph.addEdge({ id: 'e1', sourceId: 'srvA', targetId: 'srvB', kind: 'SYNC_HTTP' });
  mixedGraph.addEdge({ id: 'e2', sourceId: 'srvB', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
  mixedGraph.addEdge({ id: 'e3', sourceId: 'kafka', targetId: 'srvA', kind: 'KAFKA_CONSUME' });

  const unguardedValidation = validateTopology(mixedGraph);
  assert.strictEqual(unguardedValidation.valid, false, 'Mixed cycle without runaway guard must be rejected');
  assert.strictEqual(unguardedValidation.cycles[0]?.classification, 'MIXED');
  assert.strictEqual(unguardedValidation.cycles[0]?.permitted, false);

  const guardedValidation = validateTopology(mixedGraph, { maxHops: 32 });
  assert.strictEqual(guardedValidation.valid, true, 'Mixed cycle with maxHops guard must be permitted');
  assert.strictEqual(guardedValidation.cycles[0]?.classification, 'MIXED');
  assert.strictEqual(guardedValidation.cycles[0]?.permitted, true);
  console.log('✓ Mixed cycle rejected without guard, accepted with maxHops: 32 runaway guard\n');

  // ---------------------------------------------------------------------------
  // 6. GET /projects/:id/topology matches created data & MySQL row counts
  // ---------------------------------------------------------------------------
  console.log('[6/7] Validating GET /projects/:id/topology and database persistence...');
  const topoRes = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project.id}/topology`,
    headers,
  });
  assert.strictEqual(topoRes.statusCode, 200);
  const topoData = JSON.parse(topoRes.payload);

  assert.strictEqual(topoData.nodes.length, 4);
  assert.strictEqual(topoData.edges.length, 3);

  // Directly check MySQL row counts
  const [nodeRows] = await pool.query<Array<{ count: number } & import('mysql2').RowDataPacket>>(
    'SELECT COUNT(*) AS count FROM topology_nodes WHERE environment_id = ?',
    [environment.id],
  );
  const [edgeRows] = await pool.query<Array<{ count: number } & import('mysql2').RowDataPacket>>(
    'SELECT COUNT(*) AS count FROM topology_edges WHERE environment_id = ?',
    [environment.id],
  );

  assert.strictEqual(nodeRows[0]?.count, 4, 'MySQL node count must match API creates');
  assert.strictEqual(edgeRows[0]?.count, 3, 'MySQL edge count must match API creates');
  console.log('✓ GET /projects/:id/topology data matches created entities and MySQL row counts (4 nodes, 3 edges)\n');

  // ---------------------------------------------------------------------------
  // 7. Operations with dependency call list & execution mode
  // ---------------------------------------------------------------------------
  console.log('[7/7] Creating and verifying operations with execution modes (Part 9.1)...');
  const opRes = await app.inject({
    method: 'POST',
    url: `/api/v1/nodes/${orderNode.id}/operations`,
    headers,
    payload: {
      name: 'POST /orders',
      method: 'POST',
      path: '/orders',
      timeoutMs: 2000,
      concurrencyLimit: 500,
      serviceTimeDistribution: 'lognormal',
      serviceTimeParams: { p50: 30, p95: 90, p99: 180 },
      dependencyCalls: [
        {
          edgeId: edgePayment.id,
          targetOperationName: 'chargePayment',
          callOrder: 1,
          executionMode: 'SEQUENTIAL',
          required: true,
        },
        {
          edgeId: edgeKafkaPub.id,
          targetOperationName: 'orderCreatedEvent',
          callOrder: 2,
          executionMode: 'ASYNC',
          required: false,
        },
      ],
    },
  });
  assert.strictEqual(opRes.statusCode, 201);
  const createdOp = JSON.parse(opRes.payload);
  assert.strictEqual(createdOp.dependencyCalls.length, 2);

  const getOpsRes = await app.inject({
    method: 'GET',
    url: `/api/v1/nodes/${orderNode.id}/operations`,
    headers,
  });
  assert.strictEqual(getOpsRes.statusCode, 200);
  const opsList = JSON.parse(getOpsRes.payload);

  assert.strictEqual(opsList.length, 1);
  assert.strictEqual(opsList[0].name, 'POST /orders');
  assert.strictEqual(opsList[0].dependencyCalls.length, 2);
  assert.strictEqual(opsList[0].dependencyCalls[0].executionMode, 'SEQUENTIAL');
  assert.strictEqual(opsList[0].dependencyCalls[1].executionMode, 'ASYNC');
  console.log('✓ Operation created with SEQUENTIAL & ASYNC dependency calls and retrieved accurately\n');

  // Cleanup
  await app.close();
  await pool.end();

  console.log('===============================================================');
  console.log('   BLACKBOX-X M1 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
  console.log('===============================================================');
}

runM1Gate().catch((err) => {
  console.error('\n✗ M1 Gate failed with error:\n', err);
  process.exit(1);
});
