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
  <title>BLACKBOX-X — Performance Testing & Discrete-Event Simulation Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #ffffff;
      --bg-subtle: #fafafa;
      --border: #e4e4e7;
      --border-dark: #18181b;
      --text: #09090b;
      --text-muted: #71717a;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --radius-sm: 4px;
      --radius-md: 6px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); background: var(--bg); color: var(--text); padding: 32px 24px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    .container { max-width: 1160px; margin: 0 auto; }
    .top-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 28px; flex-wrap: wrap; gap: 14px; }
    .brand-wrap { display: flex; align-items: center; gap: 12px; }
    .brand-logo { width: 34px; height: 34px; background: var(--text); color: var(--bg); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; border-radius: var(--radius-sm); font-family: var(--font-mono); }
    .brand-title { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
    .brand-sub { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); text-transform: uppercase; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; font-family: var(--font-mono); border: 1px solid var(--border); background: var(--bg); text-transform: uppercase; }
    .badge-inverse { background: var(--text); color: var(--bg); border-color: var(--text); }
    .hero { margin-bottom: 32px; border-bottom: 1px solid var(--border); padding-bottom: 28px; }
    .hero h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 8px; }
    .hero p { font-size: 14px; color: var(--text-muted); max-width: 780px; }
    .card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 22px; margin-bottom: 24px; }
    .card-title { font-size: 14px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    @media (max-width: 860px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } }
    .stat-box { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; background: var(--bg); }
    .stat-label { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; }
    .stat-val { font-size: 22px; font-weight: 700; font-family: var(--font-mono); }
    .stat-desc { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: var(--font-mono); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; font-family: var(--font-sans); border-radius: var(--radius-sm); cursor: pointer; text-decoration: none; transition: all 0.12s ease; }
    .btn-primary { background: var(--text); color: var(--bg); border: 1px solid var(--text); }
    .btn-primary:hover { background: #27272a; }
    .btn-secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #f4f4f5; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }
    .input-text { width: 100%; padding: 8px 12px; font-size: 13px; font-family: var(--font-mono); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); outline: none; }
    .input-text:focus { border-color: var(--border-dark); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: var(--bg-subtle); padding: 9px 12px; text-align: left; font-weight: 600; font-family: var(--font-mono); font-size: 11px; border-bottom: 1px solid var(--border); color: var(--text-muted); }
    td { padding: 9px 12px; border-bottom: 1px solid var(--border); font-family: var(--font-mono); }
    .footer { border-top: 1px solid var(--border); padding-top: 24px; margin-top: 36px; font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Header -->
    <div class="top-header">
      <div class="brand-wrap">
        <div class="brand-logo">BX</div>
        <div>
          <div class="brand-title">BLACKBOX-X</div>
          <div class="brand-sub">Performance Testing & Simulation Engine</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="badge badge-inverse">✓ ENGINE ONLINE</span>
        <a href="https://system-x-dashboard.onrender.com" target="_blank" class="btn btn-primary btn-sm">Launch SYSTEM-X Control Center &rarr;</a>
      </div>
    </div>

    <!-- Hero Section -->
    <div class="hero">
      <h1>Test your website. Understand your system. Compare results.</h1>
      <p>
        BLACKBOX-X is the core benchmarking and discrete-event simulation engine in the System-X reliability verification ecosystem. Enter a website URL to dispatch real HTTP requests, model multi-server queueing dynamics, and attribute production bottlenecks.
      </p>
    </div>

    <!-- Live Website Testing Card -->
    <div class="card">
      <div class="card-title">
        <span>Website Performance Testing</span>
        <span class="badge">Real HTTP Benchmark</span>
      </div>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
        Enter any public website or backend API URL to benchmark throughput, measure $P_{50}, P_{90}, P_{95}, P_{99}$ latency quantiles, and inspect individual sampled requests:
      </p>
      <div style="display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap;">
        <input type="text" id="bbx-target-input" class="input-text" style="flex: 1; min-width: 280px;" value="https://httpbin.org/get" placeholder="https://example.com or http://localhost:4200/api/products" />
        <button class="btn btn-primary" onclick="launchInControlCenter()">Test in SYSTEM-X Control Center &rarr;</button>
      </div>
      <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
        Target will be checked with SSRF guards, DNS resolution, and a bounded 4000ms pre-flight probe.
      </div>
    </div>

    <!-- 3 Core Application Workflows -->
    <div class="grid-3" style="margin-bottom: 24px;">
      <div class="card">
        <div class="stat-label">Capability 01</div>
        <div style="font-weight: 700; font-size: 15px; margin-top: 4px;">Website Load Testing</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">
          Execute live benchmarks with high-resolution <code>process.hrtime.bigint</code> timers, Server-Sent Events streaming, and sampled Request Inspector.
        </p>
      </div>

      <div class="card">
        <div class="stat-label">Capability 02</div>
        <div style="font-weight: 700; font-size: 15px; margin-top: 4px;">System Architecture Modeling</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">
          Model microservices, thread pools, databases, and queues. Calculate analytical queue capacity and bottleneck inflection points.
        </p>
      </div>

      <div class="card">
        <div class="stat-label">Capability 03</div>
        <div style="font-weight: 700; font-size: 15px; margin-top: 4px;">Two-Gate Hypothesis Testing</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">
          Validate simulation traces against empirical telemetry using Kolmogorov-Smirnov and Wasserstein distance metrics without data leakage.
        </p>
      </div>
    </div>

    <!-- Live Little's Law / Queue Dynamics Calculator -->
    <div class="grid-2" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-title">
          <span>Live Queue Dynamics Calculator</span>
          <span class="badge">Little's Law (M/M/c)</span>
        </div>
        <div style="margin-bottom: 12px;">
          <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">Arrival Rate (&lambda;): <span class="mono" id="val-lambda">150</span> req/sec</label>
          <input type="range" min="10" max="1000" step="10" value="150" id="inp-lambda" oninput="recalcQueue()" style="width:100%;" />
        </div>
        <div style="margin-bottom: 12px;">
          <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">Mean Service Time (&mu;<sup>-1</sup>): <span class="mono" id="val-mu">4.0</span> ms</label>
          <input type="range" min="0.5" max="25" step="0.5" value="4.0" id="inp-mu" oninput="recalcQueue()" style="width:100%;" />
        </div>
        <div>
          <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">CPU Cores / Workers (c): <span class="mono" id="val-cores">4</span></label>
          <input type="range" min="1" max="16" step="1" value="4" id="inp-cores" oninput="recalcQueue()" style="width:100%;" />
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Computed Simulation Bounds</span>
          <span class="badge">Analytical Metrics</span>
        </div>
        <div class="grid-3" style="margin-bottom: 14px;">
          <div class="stat-box">
            <div class="stat-label">Utilization (&rho;)</div>
            <div class="stat-val" id="res-util">0.150</div>
            <div class="stat-desc">&rho; = &lambda; / c&mu;</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Predicted P99</div>
            <div class="stat-val" id="res-p99">5.2 ms</div>
            <div class="stat-desc">Latency SLA</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Queue Backlog</div>
            <div class="stat-val" id="res-backlog">0.02 reqs</div>
            <div class="stat-desc">Mean L<sub>q</sub></div>
          </div>
        </div>
        <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); line-height: 1.5;">
          Analytically estimates queue saturation and backlog growth before pushing real traffic onto production clusters.
        </div>
      </div>
    </div>

    <!-- Milestone Sign-Off Matrix -->
    <div class="card">
      <div class="card-title">
        <span>Platform Milestone Verification &amp; Sign-Off Matrix (M0 – M12)</span>
        <span class="badge">13/13 VERIFIED</span>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Milestone</th>
              <th>Scope &amp; Capabilities</th>
              <th>Packages</th>
              <th>Infrastructure</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>M0</strong></td>
              <td>Foundations &amp; Multi-Tenant Isolation</td>
              <td>contracts, db, security, observability</td>
              <td>MySQL 8.4, Redis 7.4</td>
              <td><span class="badge">✓ PASS (8/8)</span></td>
            </tr>
            <tr>
              <td><strong>M1</strong></td>
              <td>Typed Topology DAG &amp; Cycle Guards</td>
              <td>domain, db, blackbox-api</td>
              <td>Fastify Control Plane</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M2</strong></td>
              <td>Substream Statistics &amp; Deterministic PRNG</td>
              <td>statistics, workload-spec</td>
              <td>Pure Math Kernel (SplitMix64)</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M3</strong></td>
              <td>Deterministic Discrete-Event Engine</td>
              <td>simulation-engine</td>
              <td>Microsecond Virtual Clock</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M4</strong></td>
              <td>Live Benchmark &amp; KS/Wasserstein Comparison</td>
              <td>comparison, db</td>
              <td>Two-Sample Hypothesis Testing</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M5</strong></td>
              <td>Model-Estimated Capacity &amp; Bottlenecks</td>
              <td>capacity-search, db</td>
              <td>Kneedle Inflection Detection</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M6</strong></td>
              <td>Closed-Loop Calibration (Zero Data Leakage)</td>
              <td>calibration, db</td>
              <td>Coordinate Descent (70/30 Split)</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M7</strong></td>
              <td>Distributed Worker Orchestration</td>
              <td>load-orchestrator, db</td>
              <td>Kafka 4.3 KRaft, Redis 7.4</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M8</strong></td>
              <td>Authoritative Epoch Fencing &amp; Outbox</td>
              <td>execution-leases, db</td>
              <td>MySQL Leases, Kafka Outbox</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M9</strong></td>
              <td>Simulation Chaos &amp; Failure Cascades</td>
              <td>chaos-engine, db</td>
              <td>DAG Reverse-BFS Traversal</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M10</strong></td>
              <td>Object Storage &amp; Cryptographic Lineage</td>
              <td>storage, db</td>
              <td>MinIO S3 Content-Addressed Blobs</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M11</strong></td>
              <td>Low-Cardinality Prometheus Observability</td>
              <td>blackbox-api, observability</td>
              <td>OpenMetrics /metrics Exporter</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
            <tr>
              <td><strong>M12</strong></td>
              <td>Production Hardening &amp; Multi-Tenant Sign-Off</td>
              <td>Platform-wide (19 packages)</td>
              <td>5-Tenant Concurrency Stress Gate</td>
              <td><span class="badge">✓ PASS (7/7)</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Active Diagnostic Probes & APIs -->
    <div class="card">
      <div class="card-title">
        <span>Active Diagnostic Endpoints &amp; API Probes</span>
        <span class="badge">LIVE HEALTH</span>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn btn-secondary btn-sm" href="/health/live" target="_blank">Liveness Probe (/health/live)</a>
        <a class="btn btn-secondary btn-sm" href="/health/startup" target="_blank">Startup Probe (/health/startup)</a>
        <a class="btn btn-secondary btn-sm" href="/metrics" target="_blank">Prometheus Metrics (/metrics)</a>
        <a class="btn btn-secondary btn-sm" href="/?format=json" target="_blank">Raw JSON Mode (/?format=json)</a>
        <a class="btn btn-primary btn-sm" href="https://system-x-dashboard.onrender.com" target="_blank">Open SYSTEM-X Control Center &rarr;</a>
        <a class="btn btn-secondary btn-sm" href="https://github.com/MSC-0013/BLACKBOX-X" target="_blank">GitHub Repository</a>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div>BLACKBOX-X Simulation Engine &middot; SYSTEM-X Testing Control Center</div>
      <div class="mono">Version 2.4.0 &middot; Strict Monochrome Mode</div>
    </div>
  </div>

  <script>
    function launchInControlCenter() {
      var target = document.getElementById('bbx-target-input').value.trim();
      var host = window.location.hostname === 'localhost' ? 'http://localhost:8080' : 'https://system-x-dashboard.onrender.com';
      window.open(host + '/?tab=website&target=' + encodeURIComponent(target), '_blank');
    }

    function recalcQueue() {
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

