import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { serverConfig } from '@blackbox-x/config-server';
import { createLogger } from '@blackbox-x/logging';
import { parseDatabaseUrl } from './client.js';

const log = createLogger('db-migrate');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_LOCK_NAME = 'bbx_migrations_lock';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 10;

/**
 * Applies numbered SQL migrations in ascending order.
 * Follows Part 8.33:
 * - Advisory lock (GET_LOCK) prevents concurrent pod execution race conditions.
 * - Records migration_id, checksum (SHA-256), applied_at, execution_time_ms.
 * - Detects retroactive history changes by verifying checksums of applied migrations.
 * - Forward-only policy; non-transactional DDL failures require clean reset.
 */
export async function runMigrations(connectionString = serverConfig.DATABASE_URL): Promise<void> {
  const parts = parseDatabaseUrl(connectionString);

  // 1. Bootstrap: create database if it doesn't already exist
  const bootstrap = await mysql.createConnection({
    host: parts.host,
    port: parts.port,
    user: parts.user,
    password: parts.password,
    multipleStatements: true,
  });

  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${parts.database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await bootstrap.end();
  }

  // 2. Dedicated connection for running migrations
  const connection = await mysql.createConnection({
    ...parts,
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });

  let lockAcquired = false;

  try {
    // 3. Acquire MySQL Advisory Lock (Part 8.33)
    const [lockRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS lock_acquired',
      [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS],
    );

    if (!lockRows[0] || lockRows[0].lock_acquired !== 1) {
      throw new Error(
        `Failed to acquire migration lock '${MIGRATION_LOCK_NAME}' within ${MIGRATION_LOCK_TIMEOUT_SECONDS}s`,
      );
    }
    lockAcquired = true;
    log.info({ lock: MIGRATION_LOCK_NAME }, 'Acquired migration advisory lock');

    // 4. Ensure tracking ledger exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
        name               VARCHAR(255) NOT NULL UNIQUE,
        checksum           VARCHAR(64) NOT NULL,
        execution_time_ms  INT NOT NULL,
        applied_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    // 5. Discover migration files
    let migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      migrationsDir = path.join(__dirname, '..', 'src', 'migrations');
    }
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at ${migrationsDir}`);
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const rawContent = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
      const checksum = createHash('sha256').update(rawContent).digest('hex');

      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT checksum FROM _migrations WHERE name = ?',
        [file],
      );

      if (rows.length > 0) {
        const storedChecksum = rows[0].checksum;
        if (storedChecksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${file}! Stored: ${storedChecksum}, Current: ${checksum}. ` +
              'Migration history cannot be modified after application.',
          );
        }
        log.info({ file }, 'Migration already applied (checksum verified)');
        continue;
      }

      log.info({ file }, 'Applying migration...');
      const startMs = Date.now();

      try {
        await connection.query(rawContent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Migration ${file} failed: ${msg}\n` +
            'MySQL DDL statements commit implicitly. The database may be partially migrated. ' +
            'Review schema and repair before retrying.',
        );
      }

      const executionTimeMs = Date.now() - startMs;

      await connection.query(
        'INSERT INTO _migrations (name, checksum, execution_time_ms) VALUES (?, ?, ?)',
        [file, checksum, executionTimeMs],
      );

      log.info({ file, executionTimeMs }, 'Migration applied successfully');
    }

    log.info('All database migrations applied successfully');
  } finally {
    if (lockAcquired) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
        log.info({ lock: MIGRATION_LOCK_NAME }, 'Released migration advisory lock');
      } catch (err) {
        log.warn({ err }, 'Failed to release migration advisory lock');
      }
    }
    await connection.end();
  }
}

// CLI execution
if (process.argv[1] === __filename) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
