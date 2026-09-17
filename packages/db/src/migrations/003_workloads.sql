-- =============================================================================
-- Migration 003_workloads.sql: Workload Specifications & Experiment Campaigns (M2)
-- Workloads, Versions, Experiment Campaigns, and Campaign Runs
-- =============================================================================

CREATE TABLE IF NOT EXISTS workloads (
  id          VARCHAR(64) PRIMARY KEY,
  tenant_id   VARCHAR(64) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(64) NOT NULL,
  description TEXT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_workload_tenant_slug (tenant_id, slug),
  INDEX idx_workloads_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_workloads_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workload_versions (
  id                      VARCHAR(64) PRIMARY KEY,
  workload_id             VARCHAR(64) NOT NULL,
  version_number          INT NOT NULL,
  arrival_pattern         VARCHAR(32) NOT NULL,
  arrival_params          JSON NOT NULL,
  request_mix             JSON NOT NULL,
  phase_schedule          JSON NOT NULL,
  retry_policy            JSON NULL,
  circuit_breaker_policy  JSON NULL,
  seed_policy             JSON NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_workload_version (workload_id, version_number),
  INDEX idx_workload_versions_workload (workload_id),
  CONSTRAINT fk_workload_versions_workload FOREIGN KEY (workload_id) REFERENCES workloads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS experiment_campaigns (
  id            VARCHAR(64) PRIMARY KEY,
  tenant_id     VARCHAR(64) NOT NULL,
  project_id    VARCHAR(64) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(32) NOT NULL,
  status        VARCHAR(32) NOT NULL,
  config        JSON NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_campaigns_tenant_proj (tenant_id, project_id),
  CONSTRAINT fk_campaigns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_campaigns_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS campaign_runs (
  id          VARCHAR(64) PRIMARY KEY,
  campaign_id VARCHAR(64) NOT NULL,
  run_id      VARCHAR(64) NOT NULL,
  run_index   INT NOT NULL,
  parameters  JSON NOT NULL,
  status      VARCHAR(32) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_campaign_runs_campaign (campaign_id, run_index),
  CONSTRAINT fk_campaign_runs_campaign FOREIGN KEY (campaign_id) REFERENCES experiment_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
