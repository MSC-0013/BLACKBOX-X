-- =============================================================================
-- Migration 004_benchmarks.sql: Benchmarks & Comparison Engine (M4)
-- Real Benchmarks and Statistical Comparison Reports
-- =============================================================================

CREATE TABLE IF NOT EXISTS benchmarks (
  id              VARCHAR(64) PRIMARY KEY,
  tenant_id       VARCHAR(64) NOT NULL,
  project_id      VARCHAR(64) NOT NULL,
  driver          VARCHAR(32) NOT NULL,
  target_url      VARCHAR(1024) NOT NULL,
  status          VARCHAR(32) NOT NULL,
  throughput_rps  DOUBLE NOT NULL,
  p50_us          INT NOT NULL,
  p90_us          INT NOT NULL,
  p95_us          INT NOT NULL,
  p99_us          INT NOT NULL,
  metrics_summary JSON NOT NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_benchmarks_tenant_proj (tenant_id, project_id),
  CONSTRAINT fk_benchmarks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_benchmarks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS benchmark_comparisons (
  id                          VARCHAR(64) PRIMARY KEY,
  benchmark_id                VARCHAR(64) NOT NULL,
  simulation_run_id           VARCHAR(64) NOT NULL,
  verdict                     VARCHAR(32) NOT NULL,
  ks_statistic                DOUBLE NULL,
  mape                        DOUBLE NOT NULL,
  p50_error                   DOUBLE NOT NULL,
  p99_error                   DOUBLE NOT NULL,
  prediction_interval_enclosed BOOLEAN NOT NULL,
  report_data                 JSON NOT NULL,
  created_at                  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_comparisons_benchmark (benchmark_id),
  CONSTRAINT fk_comparisons_benchmark FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
