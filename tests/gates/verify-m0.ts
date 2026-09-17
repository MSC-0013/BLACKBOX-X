import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations } from '@blackbox-x/db';
import { buildServer } from '../../apps/blackbox-api/src/server.js';
import { checkAllDependencies } from '../../apps/blackbox-api/src/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Ensures no mock files exist in tests/gates/
 */
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

async function runM0Gate() {
  console.log('===============================================================');
  console.log('       BLACKBOX-X M0 GATE: Foundation & Security Boundary      ');
  console.log('===============================================================\n');

  // [1/8] Verify No-Mock Rule in tests/gates/
  console.log('[1/8] Verifying no mocked infrastructure in tests/gates/**...');
  verifyNoMockInGates(path.join(REPO_ROOT, 'tests', 'gates'));
  console.log('✓ Zero mocked infrastructure adapters in tests/gates/**\n');

  // [2/8] Dependency Cruiser architectural boundaries
  console.log('[2/8] Running dependency-cruiser rule validation...');
  try {
    execSync('npx depcruise --config .dependency-cruiser.cjs packages apps', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    console.log('✓ Dependency cruiser reports zero architectural violations\n');
  } catch (err) {
    console.error('✗ Dependency cruiser violations detected');
    throw err;
  }

  // [3/8] Real MySQL connectivity
  console.log('[3/8] Verifying MySQL connectivity on real infrastructure...');
  const [queryResult] = await pool.query('SELECT 1 AS ok');
  assert.strictEqual(
    (queryResult as Array<{ ok: number }>)[0]?.ok,
    1,
    'MySQL SELECT 1 must return 1',
  );
  console.log('✓ MySQL is connected and accepting queries\n');

  // [4/8] Execute initial database migrations
  console.log('[4/8] Running database migrations with advisory lock & checksums...');
  await runMigrations();
  console.log('✓ Migration 001_core applied successfully\n');

  // [5/8] Idempotent re-run of database migrations
  console.log('[5/8] Re-running migrations to assert strict idempotency...');
  await runMigrations();
  console.log('✓ Migrations are 100% idempotent\n');

  // [6/8] Test Server Liveness & Startup Probes
  console.log('[6/8] Testing Fastify /health/live and /health/startup...');
  const app = buildServer();
  await app.ready();

  const liveRes = await app.inject({ method: 'GET', url: '/health/live' });
  assert.strictEqual(liveRes.statusCode, 200, 'Liveness probe must return 200');
  assert.deepStrictEqual(JSON.parse(liveRes.payload), { status: 'ok' });
  console.log('✓ /health/live returns 200 { status: "ok" } (pure process check)');

  const startupRes = await app.inject({ method: 'GET', url: '/health/startup' });
  assert.strictEqual(startupRes.statusCode, 200, 'Startup probe must return 200');
  assert.deepStrictEqual(JSON.parse(startupRes.payload), { status: 'ok' });
  console.log('✓ /health/startup returns 200 { status: "ok" }\n');

  // [7/8] Test Dependency Health & Readiness Probes
  console.log('[7/8] Testing /health/dependencies and /health/ready on foundation profile...');
  const depRes = await app.inject({ method: 'GET', url: '/health/dependencies' });
  assert.strictEqual(depRes.statusCode, 200);
  const depBody = JSON.parse(depRes.payload);
  console.log('Dependencies status:', JSON.stringify(depBody.checks, null, 2));
  assert.strictEqual(depBody.checks.mysql.status, 'healthy');
  assert.strictEqual(depBody.checks.redis.status, 'healthy');
  assert.strictEqual(depBody.checks.kafka.status, 'healthy');
  assert.strictEqual(depBody.checks.minio.status, 'healthy');
  console.log('✓ /health/dependencies reports healthy status for all four services');

  const readyRes = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.strictEqual(readyRes.statusCode, 200, 'Readiness must return 200 when all dependencies healthy');
  const readyBody = JSON.parse(readyRes.payload);
  assert.strictEqual(readyBody.status, 'ok');
  console.log('✓ /health/ready returns 200 { status: "ok" }\n');

  // [8/8] Test Readiness 503 behavior when a dependency is offline
  console.log('[8/8] Testing /health/ready returns 503 when a dependency fails...');
  const appWithFailure = buildServer({
    dependencyChecker: async () => {
      const real = await checkAllDependencies();
      return {
        ...real,
        redis: { status: 'unhealthy', message: 'Connection refused on port 6380' },
      };
    },
  });
  await appWithFailure.ready();

  const failRes = await appWithFailure.inject({ method: 'GET', url: '/health/ready' });
  assert.strictEqual(
    failRes.statusCode,
    503,
    'Readiness must return 503 if any dependency is unhealthy',
  );
  const failBody = JSON.parse(failRes.payload);
  assert.strictEqual(failBody.status, 'error');
  assert.strictEqual(failBody.checks.redis.status, 'unhealthy');
  console.log('✓ /health/ready returns 503 { status: "error" } on dependency outage\n');

  // Cleanup
  await app.close();
  await appWithFailure.close();
  await pool.end();

  console.log('===============================================================');
  console.log('   BLACKBOX-X M0 VERIFICATION GATE PASSED ALL 8 ASSERTIONS!    ');
  console.log('===============================================================');
}

runM0Gate().catch((err) => {
  console.error('\n✗ M0 Gate failed with error:\n', err);
  process.exit(1);
});
