-- =============================================================================
-- Migration 009_chaos.sql: Chaos Injection & Failure Propagation Engine (M9)
-- Chaos experiment specifications, execution runs, and resilience metrics
-- =============================================================================

CREATE TABLE IF NOT EXISTS chaos_experiments (
  id              VARCHAR(64) PRIMARY KEY,
  tenant_id       VARCHAR(64) NOT NULL,
  project_id      VARCHAR(64) NOT NULL,
  name            VARCHAR(128) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  fault_type      VARCHAR(64) NOT NULL,
  target_node_id  VARCHAR(64) NOT NULL,
  target_edge_id  VARCHAR(64) NULL,
  parameters      JSON NOT NULL,
  duration_sec    INT NOT NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_chaos_tenant_proj (tenant_id, project_id),
  CONSTRAINT fk_chaos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_chaos_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chaos_experiment_runs (
  id                 VARCHAR(64) PRIMARY KEY,
  experiment_id      VARCHAR(64) NOT NULL,
  resilience_score   DOUBLE NOT NULL,
  blast_radius       INT NOT NULL,
  mttr_ms            DOUBLE NOT NULL,
  cascade_detected   BOOLEAN NOT NULL DEFAULT FALSE,
  total_requests     BIGINT NOT NULL,
  failed_requests    BIGINT NOT NULL,
  degraded_requests  BIGINT NOT NULL,
  started_at         DATETIME(6) NOT NULL,
  completed_at       DATETIME(6) NOT NULL,
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_chaos_run_exp (experiment_id),
  CONSTRAINT fk_chaos_run_exp FOREIGN KEY (experiment_id) REFERENCES chaos_experiments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
