-- =============================================================================
-- Migration 007_load_generators.sql: Distributed Load Generators & Worker Pools (M7)
-- Worker registry, orchestrator runs, and distributed metrics
-- =============================================================================

CREATE TABLE IF NOT EXISTS load_generator_workers (
  id             VARCHAR(64) PRIMARY KEY,
  worker_id      VARCHAR(64) NOT NULL UNIQUE,
  hostname       VARCHAR(128) NOT NULL,
  status         VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  heartbeat_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  registered_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  metadata       JSON NULL,
  INDEX idx_load_worker_status (status, heartbeat_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS load_orchestrator_runs (
  id                   VARCHAR(64) PRIMARY KEY,
  tenant_id            VARCHAR(64) NOT NULL,
  run_id               VARCHAR(64) NOT NULL UNIQUE,
  status               VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  target_url           VARCHAR(512) NOT NULL,
  pattern              VARCHAR(32) NOT NULL,
  duration_sec         INT NOT NULL,
  target_rps           INT NOT NULL,
  allocated_workers    INT NOT NULL DEFAULT 1,
  total_requests       BIGINT NOT NULL DEFAULT 0,
  successful_requests  BIGINT NOT NULL DEFAULT 0,
  failed_requests      BIGINT NOT NULL DEFAULT 0,
  p50_us               DOUBLE NULL,
  p90_us               DOUBLE NULL,
  p95_us               DOUBLE NULL,
  p99_us               DOUBLE NULL,
  mean_us              DOUBLE NULL,
  actual_rps           DOUBLE NULL,
  error_rate           DOUBLE NOT NULL DEFAULT 0,
  started_at           DATETIME(6) NULL,
  completed_at         DATETIME(6) NULL,
  created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_load_run_tenant (tenant_id, status),
  CONSTRAINT fk_load_run_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS load_worker_metrics (
  id           VARCHAR(64) PRIMARY KEY,
  run_id       VARCHAR(64) NOT NULL,
  worker_id    VARCHAR(64) NOT NULL,
  recorded_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  current_rps  DOUBLE NOT NULL,
  requests     INT NOT NULL,
  errors       INT NOT NULL,
  p50_us       DOUBLE NULL,
  p99_us       DOUBLE NULL,
  INDEX idx_load_metrics_run_worker (run_id, worker_id, recorded_at),
  CONSTRAINT fk_load_metrics_run FOREIGN KEY (run_id) REFERENCES load_orchestrator_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
