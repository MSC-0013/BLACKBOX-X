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
import { analyticsRoutes } from './routes/analytics.js';
import { defaultMetricsRegistry } from '@blackbox-x/observability';

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
  app.register(analyticsRoutes);

  // 5. Prometheus Metrics (standard exposition format with low-cardinality labels)
  app.get('/metrics', async (_req, reply) => {
    const text = defaultMetricsRegistry.getMetricsText();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .status(200)
      .send(text);
  });

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

  // Root Service Overview & Visual Web Dashboard
  app.get('/', async (req, reply) => {
    const accept = req.headers.accept || '';
    const query = req.query as Record<string, string> | undefined;
    const wantsJson = (accept.includes('application/json') && !accept.includes('text/html')) || query?.format === 'json';

    if (wantsJson) {
      return reply.status(200).send({
        service: 'BLACKBOX-X Discrete-Event Simulation Engine',
        status: 'ONLINE',
        version: '0.1.0',
        description: 'Deterministic virtual time queueing simulation platform for production distributed systems',
        endpoints: {
          live: '/health/live',
          startup: '/health/startup',
          metrics: '/metrics',
          dependencies: '/health/dependencies'
        }
      });
    }
    return reply.type('text/html; charset=utf-8').status(200).send(renderBlackboxDashboard());
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

if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))) {
  startServer().catch((err) => {
    console.error('Startup error:', err);
    process.exit(1);
  });
}

function renderBlackboxDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BLACKBOX-X — Discrete-Event Virtual Time Simulation Engine</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --primary: #3b82f6;
      --success: #10b981;
      --accent: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 18px; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 24px; font-weight: 800; }
    .subtitle { color: var(--muted); font-size: 13px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
    .card h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
    .stat-val { font-size: 26px; font-weight: 800; color: #fff; }
    .stat-desc { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .control-row { margin-bottom: 16px; }
    .control-row label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .control-row input[type="range"] { width: 100%; }
    .links-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .link-btn { display: inline-flex; align-items: center; gap: 6px; background: #1f2937; border: 1px solid #374151; color: #60a5fa; padding: 8px 14px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; }
    .link-btn:hover { background: #374151; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>BLACKBOX-X Simulation Engine</h1>
        <div class="subtitle">Deterministic Discrete-Event Virtual Time Queueing & Capacity Platform</div>
      </div>
      <div class="badge"><span class="badge-dot"></span> SIMULATION ENGINE ONLINE</div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Simulation Model</h3>
        <div class="stat-val" style="color: #60a5fa;">Discrete-Event</div>
        <div class="stat-desc">Virtual time scheduler with sub-microsecond precision</div>
      </div>
      <div class="card">
        <h3>Queue Dynamics</h3>
        <div class="stat-val" style="color: #34d399;">M/M/c Multi-Server</div>
        <div class="stat-desc">Analytical Little's Law throughput & latency modeling</div>
      </div>
      <div class="card">
        <h3>Statistical Fidelity</h3>
        <div class="stat-val" style="color: #fbbf24;">KS & Wasserstein</div>
        <div class="stat-desc">Two-Gate hypothesis testing vs empirical clusters</div>
      </div>
      <div class="card">
        <h3>Parameter Calibration</h3>
        <div class="stat-val" style="color: #a78bfa;">Zero-Leakage</div>
        <div class="stat-desc">Coordinate descent with 70% train / 30% held-out test</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 16px;">Live Queue Dynamics Calculator (Little's Law)</h2>
        <div class="control-row">
          <label>Arrival Rate (&lambda;): <span id="val-lambda">150</span> ops/sec</label>
          <input type="range" min="10" max="1000" step="10" value="150" id="inp-lambda" oninput="recalc()" />
        </div>
        <div class="control-row">
          <label>Mean Service Time (&mu;<sup>-1</sup>): <span id="val-mu">4.0</span> ms</label>
          <input type="range" min="0.5" max="25" step="0.5" value="4.0" id="inp-mu" oninput="recalc()" />
        </div>
        <div class="control-row">
          <label>CPU Cores (c): <span id="val-cores">4</span></label>
          <input type="range" min="1" max="16" step="1" value="4" id="inp-cores" oninput="recalc()" />
        </div>
      </div>

      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 16px;">Computed Simulation Metrics</h2>
        <div style="margin-bottom: 14px;">
          <div class="stat-val" id="res-util" style="color: #60a5fa;">0.150</div>
          <div class="stat-desc">System Utilization (&rho; = &lambda; / c&mu;)</div>
        </div>
        <div style="margin-bottom: 14px;">
          <div class="stat-val" id="res-p99" style="color: #34d399;">5.2 ms</div>
          <div class="stat-desc">Predicted P99 Latency under M/M/c queueing</div>
        </div>
        <div>
          <div class="stat-val" id="res-backlog" style="color: #fbbf24;">0.02 reqs</div>
          <div class="stat-desc">Mean Queue Backlog (L<sub>q</sub>)</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; margin-bottom: 8px;">Active Service Endpoints & Diagnostic APIs</h2>
      <p style="color: var(--muted); font-size: 13px;">This standalone simulation service exposes live health probes, telemetry, and metrics:</p>
      <div class="links-grid">
        <a class="link-btn" href="/health/live" target="_blank">&#9989; Liveness Probe (/health/live)</a>
        <a class="link-btn" href="/health/startup" target="_blank">&#128640; Startup Probe (/health/startup)</a>
        <a class="link-btn" href="/metrics" target="_blank">&#128202; Prometheus Metrics (/metrics)</a>
        <a class="link-btn" href="https://system-x-dashboard.onrender.com" target="_blank" style="color: #34d399; border-color: rgba(16,185,129,0.4);">&#128279; Open System-X Unified Portal</a>
        <a class="link-btn" href="https://github.com/MSC-0013/BLACKBOX-X" target="_blank">&#128187; GitHub Repository</a>
      </div>
    </div>
  </div>

  <script>
    function recalc() {
      var lambda = parseFloat(document.getElementById('inp-lambda').value);
      var muMs = parseFloat(document.getElementById('inp-mu').value);
      var cores = parseFloat(document.getElementById('inp-cores').value);

      document.getElementById('val-lambda').textContent = lambda;
      document.getElementById('val-mu').textContent = muMs.toFixed(1);
      document.getElementById('val-cores').textContent = cores;

      var muPerSec = 1000 / muMs;
      var rho = lambda / (cores * muPerSec);
      document.getElementById('res-util').textContent = rho.toFixed(3);

      var qlen = (rho * rho) / Math.max(0.01, 1 - Math.min(0.98, rho));
      document.getElementById('res-backlog').textContent = qlen.toFixed(2) + ' reqs';

      var wMs = muMs / (1 - Math.min(0.95, rho));
      var p99 = wMs * 2.3;
      document.getElementById('res-p99').textContent = p99.toFixed(1) + ' ms';
    }
  </script>
</body>
</html>`;
}
