import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { serverConfig } from '@blackbox-x/config-server';
import { createLogger } from '@blackbox-x/logging';
import { pool } from '@blackbox-x/db';
import { shutdownTelemetry } from '@blackbox-x/observability';
import { createErrorEnvelope, ErrorCodes } from '@blackbox-x/contracts';
import {
  checkAllDependencies,
  type SystemDependenciesStatus,
} from './health.js';
import { topologyRoutes } from './routes/topology.js';

const log = createLogger('blackbox-api');

export interface ServerOptions {
  logger?: boolean;
  dependencyChecker?: () => Promise<SystemDependenciesStatus>;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string') return header;
      return randomUUID();
    },
  });

  app.register(cors, {
    origin: true,
  });

  app.register(topologyRoutes);

  // Global error handler adhering to Part 8.11 standard error envelope
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id || 'unknown';
    const statusCode = error.statusCode || 500;
    const code = error.code || (statusCode >= 500 ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.VALIDATION_ERROR);

    log.error({ err: error, requestId }, 'Request error');

    reply.status(statusCode).send(
      createErrorEnvelope(
        code,
        error.message || 'An unexpected error occurred',
        requestId,
      ),
    );
  });

  // 1. Liveness Probe (pure process check, zero external calls)
  app.get('/health/live', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  // 2. Startup Probe
  app.get('/health/startup', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  // 3. Readiness Probe (requires all 4 dependencies: MySQL, Redis, Kafka, MinIO)
  app.get('/health/ready', async (_req, reply) => {
    const checker = options.dependencyChecker ?? checkAllDependencies;
    const checks = await checker();

    const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');
    const status = allHealthy ? 'ok' : 'error';
    const statusCode = allHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status,
      checks,
    });
  });

  // 4. Dependencies Diagnostics
  app.get('/health/dependencies', async (_req, reply) => {
    const checker = options.dependencyChecker ?? checkAllDependencies;
    const checks = await checker();

    const anyUnhealthy = Object.values(checks).some((c) => c.status === 'unhealthy');
    const allUnhealthy = Object.values(checks).every((c) => c.status === 'unhealthy');
    const status = allUnhealthy ? 'error' : anyUnhealthy ? 'degraded' : 'ok';

    return reply.status(200).send({
      status,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const server = buildServer();

  try {
    await server.listen({
      port: serverConfig.API_PORT,
      host: '0.0.0.0',
    });
    log.info({ port: serverConfig.API_PORT }, 'BLACKBOX-X Control API started');
  } catch (err) {
    log.fatal({ err }, 'Failed to start BLACKBOX-X Control API');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down server gracefully...');
    try {
      await server.close();
      await pool.end();
      await shutdownTelemetry();
      log.info('Graceful shutdown completed');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  startServer().catch((err) => {
    console.error('Startup error:', err);
    process.exit(1);
  });
}
