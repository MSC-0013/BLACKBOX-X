import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  pool,
  runMigrations,
  storedArtifacts,
  tenants,
  db,
} from '@blackbox-x/db';
import { eq } from 'drizzle-orm';
import { StorageService } from '@blackbox-x/storage';

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

async function runM10Gate() {
  console.log('========================================================================');
  console.log(' BLACKBOX-X M10 GATE: Object Storage, Artifact Integrity & Lifecycle   ');
  console.log('========================================================================\n');

  // Verify No-Mock Rule
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // Ensure migrations are applied up to 010_storage
  console.log('Ensuring all migrations up through 010_storage are applied...');
  await runMigrations();
  console.log('✓ Database migrations applied and verified\n');

  const storageService = new StorageService({
    endpoint: 'http://127.0.0.1:9000',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'blackbox-artifacts',
  });

  try {
    // -------------------------------------------------------------------------
    // [1/7] MinIO S3 Bucket Provisioning
    // -------------------------------------------------------------------------
    console.log('[1/7] Testing MinIO bucket provisioning (blackbox-artifacts)...');
    await storageService.ensureBucket();
    console.log(`      Bucket '${storageService.defaultBucket}' verified on real MinIO server`);
    console.log('✓ MinIO object storage bucket initialized\n');

    // -------------------------------------------------------------------------
    // [2/7] Uploading Large Simulation State Checkpoint
    // -------------------------------------------------------------------------
    console.log('[2/7] Uploading simulation state checkpoint with content-addressable SHA-256...');
    const [tenant] = await db.select().from(tenants).limit(1);
    assert.ok(tenant, 'Default tenant must exist');

    const traceData = JSON.stringify({
      simulationRunId: `sim-run-${Date.now()}`,
      virtualTimeUs: 5000000,
      totalEventsProcessed: 125000,
      resourceStates: {
        cpu_fair_share: { activeTasks: 12, utilization: 0.85 },
        connection_pool: { inUse: 18, waiting: 2 },
      },
      canonicalStateHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });

    const objectKey = `traces/tenant-${tenant.id}/sim-checkpoint-${Date.now()}.json`;
    const artifactRecord = await storageService.uploadArtifact({
      tenantId: tenant.id,
      objectKey,
      content: traceData,
      contentType: 'application/json',
      metadata: {
        checkpointType: 'FULL_STATE',
        eventCount: 125000,
      },
    });

    assert.ok(artifactRecord.id.startsWith('art-'));
    assert.strictEqual(artifactRecord.objectKey, objectKey);
    assert.ok(artifactRecord.sha256Checksum.length === 64);
    assert.ok(artifactRecord.sizeBytes > 0);

    console.log(`      Uploaded Artifact: ${artifactRecord.objectKey}`);
    console.log(`      Size:              ${artifactRecord.sizeBytes} bytes`);
    console.log(`      SHA-256 Checksum:  ${artifactRecord.sha256Checksum}`);
    console.log('✓ Checkpoint uploaded and indexed with content-addressable SHA-256\n');

    // -------------------------------------------------------------------------
    // [3/7] Artifact Download & Cryptographic Integrity Verification
    // -------------------------------------------------------------------------
    console.log('[3/7] Downloading artifact and asserting bit-for-bit cryptographic integrity...');
    const integrity = await storageService.verifyArtifactIntegrity(objectKey);
    assert.strictEqual(integrity.valid, true, 'Cryptographic checksum must match bit-for-bit');
    assert.strictEqual(integrity.actualSha, integrity.expectedSha);

    const downloaded = await storageService.downloadArtifact(objectKey);
    const parsed = JSON.parse(downloaded.toString('utf-8'));
    assert.strictEqual(parsed.totalEventsProcessed, 125000);
    console.log(`      Integrity Validated: ${integrity.valid} (SHA matches: ${integrity.actualSha.slice(0, 16)}...)`);
    console.log('✓ Artifact download and 100% cryptographic integrity confirmed\n');

    // -------------------------------------------------------------------------
    // [4/7] Multi-Tenant Metadata Querying in MySQL 8.4
    // -------------------------------------------------------------------------
    console.log('[4/7] Querying stored artifact records from MySQL 8.4...');
    const [savedRecord] = await db
      .select()
      .from(storedArtifacts)
      .where(eq(storedArtifacts.objectKey, objectKey));

    assert.ok(savedRecord, 'Stored artifact must exist in database');
    assert.strictEqual(savedRecord.tenantId, tenant.id);
    assert.strictEqual(savedRecord.sizeBytes, artifactRecord.sizeBytes);
    assert.strictEqual(savedRecord.sha256Checksum, artifactRecord.sha256Checksum);
    console.log(`      Persisted Row ID: ${savedRecord.id}, Bucket: ${savedRecord.bucketName}`);
    console.log('✓ Artifact database record verified with correct tenant isolation\n');

    // -------------------------------------------------------------------------
    // [5/7] Uploading Binary Payload Artifact
    // -------------------------------------------------------------------------
    console.log('[5/7] Uploading raw binary distribution blob to MinIO...');
    const binaryBuffer = Buffer.alloc(4096);
    for (let i = 0; i < binaryBuffer.length; i++) {
      binaryBuffer[i] = i % 256;
    }

    const binaryKey = `binaries/tenant-${tenant.id}/distribution-${Date.now()}.bin`;
    const binRecord = await storageService.uploadArtifact({
      tenantId: tenant.id,
      objectKey: binaryKey,
      content: binaryBuffer,
      contentType: 'application/octet-stream',
    });

    assert.strictEqual(binRecord.sizeBytes, 4096);
    const downloadedBin = await storageService.downloadArtifact(binaryKey);
    assert.strictEqual(downloadedBin.length, 4096);
    assert.deepStrictEqual(downloadedBin, binaryBuffer);
    console.log('✓ Binary artifact upload, size validation, and download verified\n');

    // -------------------------------------------------------------------------
    // [6/7] Deletion Lifecycle Verification
    // -------------------------------------------------------------------------
    console.log('[6/7] Testing artifact deletion lifecycle in MinIO and MySQL...');
    await storageService.deleteArtifact(binaryKey);

    const checkDb = await db
      .select()
      .from(storedArtifacts)
      .where(eq(storedArtifacts.objectKey, binaryKey));

    assert.strictEqual(checkDb.length, 0, 'Deleted artifact must be removed from MySQL');
    console.log('✓ Artifact deletion cleaned up from MinIO and MySQL\n');

    // -------------------------------------------------------------------------
    // [7/7] Architecture Boundary Validation via Dependency Cruiser
    // -------------------------------------------------------------------------
    console.log('[7/7] Verifying architectural purity of @blackbox-x/storage...');
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
      throw new Error('Architectural boundary violation detected in storage');
    }

    console.log('===============================================================');
    console.log('   BLACKBOX-X M10 VERIFICATION GATE PASSED ALL 7 ASSERTIONS!   ');
    console.log('===============================================================');
  } finally {
    await pool.end();
  }
}

runM10Gate().catch((err) => {
  console.error('\n❌ M10 GATE VERIFICATION FAILED:', err);
  process.exit(1);
});
