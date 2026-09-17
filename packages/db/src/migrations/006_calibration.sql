-- =============================================================================
-- Migration 006_calibration.sql: Calibration Engine & Closed-Loop History (M6)
-- Calibration Sessions and Optimization Iteration History
-- =============================================================================

CREATE TABLE IF NOT EXISTS calibration_sessions (
  id                VARCHAR(64) PRIMARY KEY,
  tenant_id         VARCHAR(64) NOT NULL,
  project_id        VARCHAR(64) NOT NULL,
  status            VARCHAR(32) NOT NULL,
  initial_loss      DOUBLE NOT NULL,
  final_loss        DOUBLE NOT NULL,
  parameter_deltas  JSON NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_calibration_tenant_proj (tenant_id, project_id),
  CONSTRAINT fk_calibration_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_calibration_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS calibration_iterations (
  id                      VARCHAR(64) PRIMARY KEY,
  calibration_session_id  VARCHAR(64) NOT NULL,
  iteration_num           INT NOT NULL,
  candidate_params        JSON NOT NULL,
  loss                    DOUBLE NOT NULL,
  ks_statistic            DOUBLE NULL,
  mape                    DOUBLE NOT NULL,
  verdict                 VARCHAR(32) NOT NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_calib_iter_session (calibration_session_id, iteration_num),
  CONSTRAINT fk_calib_iter_session FOREIGN KEY (calibration_session_id) REFERENCES calibration_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
