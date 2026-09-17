-- =============================================================================
-- Migration 002_topology.sql: Topology & Operations Schema (M1)
-- Projects, Environments, Nodes, Edges, Operations, and Dependencies
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(64) PRIMARY KEY,
  tenant_id   VARCHAR(64) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(64) NOT NULL,
  description TEXT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_project_tenant_slug (tenant_id, slug),
  INDEX idx_projects_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_projects_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS environments (
  id          VARCHAR(64) PRIMARY KEY,
  project_id  VARCHAR(64) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(64) NOT NULL,
  description TEXT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_env_project_slug (project_id, slug),
  INDEX idx_environments_project (project_id),
  CONSTRAINT fk_environments_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS topology_nodes (
  id              VARCHAR(64) PRIMARY KEY,
  environment_id  VARCHAR(64) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(64) NOT NULL,
  kind            VARCHAR(32) NOT NULL,
  metadata        JSON NOT NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_node_env_slug (environment_id, slug),
  INDEX idx_nodes_env_kind (environment_id, kind),
  CONSTRAINT fk_nodes_env FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS topology_edges (
  id              VARCHAR(64) PRIMARY KEY,
  environment_id  VARCHAR(64) NOT NULL,
  source_node_id  VARCHAR(64) NOT NULL,
  target_node_id  VARCHAR(64) NOT NULL,
  kind            VARCHAR(32) NOT NULL,
  metadata        JSON NOT NULL,
  p99_latency_ms  DOUBLE NULL,
  timeout_ms      DOUBLE NULL,
  retry_count     INT NOT NULL DEFAULT 0,
  traffic_share   DOUBLE NOT NULL DEFAULT 1.0,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_edges_env_source (environment_id, source_node_id),
  INDEX idx_edges_target (target_node_id),
  CONSTRAINT fk_edges_env FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
  CONSTRAINT fk_edges_source FOREIGN KEY (source_node_id) REFERENCES topology_nodes(id) ON DELETE CASCADE,
  CONSTRAINT fk_edges_target FOREIGN KEY (target_node_id) REFERENCES topology_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operations (
  id                          VARCHAR(64) PRIMARY KEY,
  node_id                     VARCHAR(64) NOT NULL,
  name                        VARCHAR(255) NOT NULL,
  method                      VARCHAR(16) NOT NULL DEFAULT 'GET',
  path                        VARCHAR(255) NOT NULL DEFAULT '/',
  timeout_ms                  DOUBLE NOT NULL DEFAULT 2000,
  concurrency_limit           INT NOT NULL DEFAULT 100,
  service_time_distribution   VARCHAR(32) NOT NULL DEFAULT 'lognormal',
  service_time_params         JSON NOT NULL,
  created_at                  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_operation_node_name (node_id, name),
  INDEX idx_operations_node_method (node_id, method, path),
  CONSTRAINT fk_operations_node FOREIGN KEY (node_id) REFERENCES topology_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operation_dependencies (
  id                      VARCHAR(64) PRIMARY KEY,
  operation_id            VARCHAR(64) NOT NULL,
  edge_id                 VARCHAR(64) NOT NULL,
  target_operation_name   VARCHAR(255) NULL,
  call_order              INT NOT NULL DEFAULT 0,
  execution_mode          VARCHAR(32) NOT NULL DEFAULT 'SEQUENTIAL',
  required                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_opdeps_operation (operation_id),
  INDEX idx_opdeps_edge (edge_id),
  CONSTRAINT fk_opdeps_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  CONSTRAINT fk_opdeps_edge FOREIGN KEY (edge_id) REFERENCES topology_edges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operation_policies (
  id                      VARCHAR(64) PRIMARY KEY,
  operation_id            VARCHAR(64) NOT NULL UNIQUE,
  retry_max_attempts      INT NOT NULL DEFAULT 3,
  retry_backoff_ms        DOUBLE NOT NULL DEFAULT 100,
  retry_budget_percent    DOUBLE NOT NULL DEFAULT 20,
  circuit_breaker_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timeout_ms              DOUBLE NOT NULL DEFAULT 2000,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_oppolicies_op FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operation_resource_profiles (
  id                VARCHAR(64) PRIMARY KEY,
  operation_id      VARCHAR(64) NOT NULL UNIQUE,
  cpu_weight        DOUBLE NOT NULL DEFAULT 1.0,
  memory_bytes      BIGINT NOT NULL DEFAULT 1048576,
  connection_slots  INT NOT NULL DEFAULT 1,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_opres_op FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
