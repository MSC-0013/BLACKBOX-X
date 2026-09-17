import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  pool,
  runMigrations,
  executionLeases,
  outboxEvents,
  inboxEvents,
  db,
} from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import {
  LeaseManager,
  EpochFenceGuard,
  EpochFenceError,
  OutboxRelay,
  InboxConsumer,
} from '@blackbox-x/execution-leases';

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

async function runM8Gate() {
  console.log('===============================================================');
  console.log(' BLACKBOX-X M8 GATE: Leases, Epoch Fencing & Outbox Idempotency');
  console.log('===============================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 008_leases_and_outbox
  console.log('Ensuring all migrations up through 008_leases_and_outbox are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  const redisUrl = 'redis://localhost:6380';
  const kafkaBrokers = ['localhost:9092'];

  const leaseManager = new LeaseManager({ redisUrl });
  const outboxRelay = new OutboxRelay({ kafkaBrokers, topic: 'system-events.v1' });
  const inboxConsumer = new InboxConsumer();

  try {
    // -------------------------------------------------------------------------
    // [1/7] Monotonic Distributed Lease Acquisition & Renewal
    // -------------------------------------------------------------------------
    console.log('[1/7] Testing distributed lease acquisition and renewal with Redis & MySQL...');
    const resourceId = `campaign-${Date.now()}`;
    const workerA = 'worker-node-alpha';
    const workerB = 'worker-node-beta';

    const leaseA = await leaseManager.acquire(resourceId, workerA, 3000);
    assert.strictEqual(leaseA.holderId, workerA);
    assert.ok(leaseA.epoch >= 1, 'Epoch must be at least 1');
    assert.strictEqual(leaseA.status, 'ACTIVE');

    // Worker B attempts to steal active lease -> must throw
    let conflictCaught = false;
    try {
      await leaseManager.acquire(resourceId, workerB, 3000);
    } catch (err: unknown) {
      conflictCaught = true;
      assert.ok((err as Error).message.includes('LEASE_HELD_BY_ANOTHER'));
    }
    assert.strictEqual(conflictCaught, true, 'Worker B acquisition must be rejected');

    // Worker A renews lease -> extends expiresAt without changing epoch
    const renewedA = await leaseManager.renew(resourceId, workerA, 5000);
    assert.strictEqual(renewedA.epoch, leaseA.epoch, 'Epoch must stay same on renewal');
    assert.ok(renewedA.expiresAt.getTime() >= leaseA.expiresAt.getTime());

    console.log(`      Acquired Lease for ${resourceId}: holder = ${leaseA.holderId}, epoch = ${leaseA.epoch}`);
    console.log('✓ Lease acquired, mutual exclusion enforced, and renewal verified\n');

    // -------------------------------------------------------------------------
    // [2/7] Monotonic Epoch Increment on Lease Re-acquisition
    // -------------------------------------------------------------------------
    console.log('[2/7] Testing monotonic epoch incrementation upon lease handoff...');
    await leaseManager.release(resourceId, workerA);

    const leaseB = await leaseManager.acquire(resourceId, workerB, 5000);
    assert.strictEqual(leaseB.holderId, workerB);
    assert.ok(
      leaseB.epoch > leaseA.epoch,
      `New lease epoch (${leaseB.epoch}) must be strictly greater than previous epoch (${leaseA.epoch})`,
    );

    console.log(`      Handoff Lease: oldEpoch = ${leaseA.epoch}, newEpoch = ${leaseB.epoch} (Worker B)`);
    console.log('✓ Monotonic epoch increment verified\n');

    // -------------------------------------------------------------------------
    // [3/7] Split-Brain Epoch Fencing Validation
    // -------------------------------------------------------------------------
    console.log('[3/7] Testing split-brain epoch fencing guard against stale worker writes...');
    // Worker A tries to perform mutation with stale epoch
    let fenceCaught = false;
    try {
      EpochFenceGuard.assertValidEpoch(resourceId, leaseA.epoch, leaseB.epoch);
    } catch (err) {
      fenceCaught = true;
      assert.ok(err instanceof EpochFenceError);
      console.log(`      Fencing Guard Caught Zombie Write: ${(err as Error).message}`);
    }
    assert.strictEqual(fenceCaught, true, 'Zombie worker write must be blocked by epoch fencing guard');

    // Worker B writes with valid current epoch
    assert.doesNotThrow(() => {
      EpochFenceGuard.assertValidEpoch(resourceId, leaseB.epoch, leaseB.epoch);
    });
    console.log('✓ Epoch fencing successfully prevents stale/split-brain writes\n');

    // -------------------------------------------------------------------------
    // [4/7] Transactional Outbox Event Creation
    // -------------------------------------------------------------------------
    console.log('[4/7] Testing transactional outbox event creation in MySQL 8.4...');
    const outboxEvent = await outboxRelay.queueEvent({
      aggregateType: 'CAMPAIGN_RUN',
      aggregateId: resourceId,
      eventType: 'CAMPAIGN_RUN_COMPLETED',
      payload: {
        resourceId,
        status: 'SUCCESS',
        metrics: { throughput: 450, errorRate: 0 },
      },
      epoch: leaseB.epoch,
    });

    assert.strictEqual(outboxEvent.status, 'PENDING');
    assert.strictEqual(outboxEvent.status, 'PENDING');
    assert.strictEqual(outboxEvent.epoch, leaseB.epoch);

    const [persistedEvt] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, outboxEvent.id));

    assert.ok(persistedEvt, 'Outbox event must exist in database');
    assert.strictEqual(persistedEvt.publishedAt, null, 'Pending event publishedAt must be null');
    console.log(`      Queued Outbox Event: ${persistedEvt.id} (aggregate: ${persistedEvt.aggregateType})`);
    console.log('✓ Transactional outbox event created and verified in MySQL 8.4\n');

    // -------------------------------------------------------------------------
    // [5/7] Outbox Relay Dispatch to Real Kafka Broker
    // -------------------------------------------------------------------------
    console.log('[5/7] Testing OutboxRelay publishing pending events to Kafka (system-events.v1)...');
    await outboxRelay.connect();
    const publishedCount = await outboxRelay.relayPendingEvents(10);
    assert.ok(publishedCount >= 1, 'At least 1 outbox event must be published');

    const [updatedEvt] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, outboxEvent.id));

    assert.ok(updatedEvt?.publishedAt !== null, 'publishedAt timestamp must be populated');
    console.log(`      Relayed ${publishedCount} event(s) to Kafka broker, publishedAt: ${updatedEvt?.publishedAt?.toISOString()}`);
    console.log('✓ Outbox relay successfully published events to Kafka and updated MySQL\n');

    // -------------------------------------------------------------------------
    // [6/7] Idempotent At-Least-Once Processing with Transactional Deduplication
    // -------------------------------------------------------------------------
    console.log('[6/7] Testing InboxConsumer idempotent at-least-once processing with transactional deduplication...');
    const testEventId = `evt-inbox-test-${Date.now()}`;
    const consumerGroup = 'analytics-workers';
    let executionCounter = 0;

    const handler = async () => {
      executionCounter++;
    };

    // First consumption: must process
    const res1 = await inboxConsumer.consumeWithIdempotency(testEventId, consumerGroup, handler);
    assert.strictEqual(res1.processed, true);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(executionCounter, 1);

    // Duplicate redelivery: must skip
    const res2 = await inboxConsumer.consumeWithIdempotency(testEventId, consumerGroup, handler);
    assert.strictEqual(res2.processed, false);
    assert.strictEqual(res2.duplicate, true);
    assert.strictEqual(executionCounter, 1, 'Execution counter must NOT increment on duplicate');

    console.log(`      Handler Executions: ${executionCounter} (1 expected despite 2 deliveries)`);
    console.log('✓ Idempotent at-least-once processing with transactional deduplication (effectively-once DB side-effect) verified\n');

    // -------------------------------------------------------------------------
    // [7/7] Architecture Boundary Validation via Dependency Cruiser
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying architectural purity of @blackbox-x/execution-leases...');
    try {
      execSync('npx depcruise --config .dependency-cruiser.cjs packages apps', {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
      console.log('✓ Architecture boundary rules strictly validated (0 violations)\n');
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      console.error('Dependency cruiser stdout:', e.stdout?.toString());
      console.error('Dependency cruiser stderr:', e.stderr?.toString());
      throw new Error('Architectural boundary violation detected in execution-leases');
    }

    console.log('===============================================================');
    console.log('   BLACKBOX-X M8 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!    ');
    console.log('===============================================================');
  } finally {
    await leaseManager.close();
    await outboxRelay.disconnect();
    await pool.end();
  }
}

runM8Gate().catch((err) => {
  console.error('\n❌ M8 GATE VERIFICATION FAILED:', err);
  process.exit(1);
});
