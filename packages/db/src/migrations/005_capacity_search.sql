-- =============================================================================
-- Migration 005_capacity_search.sql: Capacity Search & Bottleneck Identification (M5)
-- Capacity Searches and Search Steps
-- =============================================================================

CREATE TABLE IF NOT EXISTS capacity_searches (
  id                  VARCHAR(64) PRIMARY KEY,
  tenant_id           VARCHAR(64) NOT NULL,
  project_id          VARCHAR(64) NOT NULL,
  target_p99_us       INT NOT NULL,
  max_error_rate      DOUBLE NOT NULL,
  max_sustainable_rps  DOUBLE NOT NULL,
  knee_point_rps      DOUBLE NULL,
  limiting_component  VARCHAR(255) NULL,
  limiting_resource   VARCHAR(64) NULL,
  search_summary      JSON NOT NULL,
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_capacity_tenant_proj (tenant_id, project_id),
  CONSTRAINT fk_capacity_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_capacity_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS capacity_search_steps (
  id                  VARCHAR(64) PRIMARY KEY,
  capacity_search_id  VARCHAR(64) NOT NULL,
  step_index          INT NOT NULL,
  candidate_rps       DOUBLE NOT NULL,
  p99_us              INT NOT NULL,
  error_rate          DOUBLE NOT NULL,
  satisfies_slo       BOOLEAN NOT NULL,
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_capacity_steps_search (capacity_search_id, step_index),
  CONSTRAINT fk_capacity_steps_search FOREIGN KEY (capacity_search_id) REFERENCES capacity_searches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
