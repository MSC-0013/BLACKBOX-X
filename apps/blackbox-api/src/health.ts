import { Redis } from 'ioredis';
import { Kafka } from 'kafkajs';
import { pool } from '@blackbox-x/db';
import { serverConfig } from '@blackbox-x/config-server';
import { createLogger } from '@blackbox-x/logging';
import type { DependencyStatus } from '@blackbox-x/contracts';

const log = createLogger('health-check');

export interface CheckOptions {
  timeoutMs?: number;
}

export async function checkMysql(options: CheckOptions = {}): Promise<DependencyStatus> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const start = Date.now();
  try {
    const promise = pool.query('SELECT 1');
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`MySQL check timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    await Promise.race([promise, timeout]);
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'MySQL health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message,
    };
  }
}

export async function checkRedis(options: CheckOptions = {}): Promise<DependencyStatus> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const start = Date.now();
  let redisClient: Redis | null = null;
  try {
    redisClient = new Redis(serverConfig.REDIS_URL, {
      connectTimeout: timeoutMs,
      commandTimeout: timeoutMs,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    await redisClient.connect();
    const pong = await redisClient.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis ping response: ${pong}`);
    }
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'Redis health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message,
    };
  } finally {
    if (redisClient) {
      try {
        redisClient.disconnect();
      } catch {}
    }
  }
}

export async function checkKafka(options: CheckOptions = {}): Promise<DependencyStatus> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const start = Date.now();
  const brokers = serverConfig.KAFKA_BROKERS.split(',').map((b) => b.trim());
  const kafka = new Kafka({
    clientId: 'blackbox-health-checker',
    brokers,
    connectionTimeout: timeoutMs,
    requestTimeout: timeoutMs,
    retry: { retries: 0 },
  });
  const admin = kafka.admin();

  try {
    await admin.connect();
    await admin.listTopics();
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'Kafka health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message,
    };
  } finally {
    try {
      await admin.disconnect();
    } catch {}
  }
}

export async function checkMinio(options: CheckOptions = {}): Promise<DependencyStatus> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const start = Date.now();
  try {
    const healthUrl = `${serverConfig.MINIO_ENDPOINT.replace(/\/$/, '')}/minio/health/live`;
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`MinIO health endpoint returned status ${response.status}`);
    }

    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'MinIO health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      message,
    };
  }
}

export interface SystemDependenciesStatus {
  mysql: DependencyStatus;
  redis: DependencyStatus;
  kafka: DependencyStatus;
  minio: DependencyStatus;
}

export async function checkAllDependencies(
  options: CheckOptions = {},
): Promise<SystemDependenciesStatus> {
  const [mysqlStatus, redisStatus, kafkaStatus, minioStatus] = await Promise.all([
    checkMysql(options),
    checkRedis(options),
    checkKafka(options),
    checkMinio(options),
  ]);

  return {
    mysql: mysqlStatus,
    redis: redisStatus,
    kafka: kafkaStatus,
    minio: minioStatus,
  };
}
