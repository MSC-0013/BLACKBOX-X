-- =============================================================================
-- Migration 001_core.sql: Foundational Schema (M0)
-- Tenancy, Identity, Outbox, Inbox, Audit, and Idempotency
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id          VARCHAR(64) PRIMARY KEY,
  slug        VARCHAR(64) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64) PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status        VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS memberships (
  id          VARCHAR(64) PRIMARY KEY,
  tenant_id   VARCHAR(64) NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  role        VARCHAR(32) NOT NULL DEFAULT 'VIEWER',
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_membership (tenant_id, user_id),
  INDEX idx_memberships_user (user_id),
  CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_keys (
  id            VARCHAR(64) PRIMARY KEY,
  tenant_id     VARCHAR(64) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  prefix        VARCHAR(32) NOT NULL,
  hash          VARCHAR(64) NOT NULL,
  scopes        JSON NOT NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at    DATETIME(6) NULL,
  last_used_at  DATETIME(6) NULL,
  revoked_at    DATETIME(6) NULL,
  INDEX idx_apikeys_tenant (tenant_id),
  INDEX idx_apikeys_hash (hash),
  CONSTRAINT fk_apikeys_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS outbox_events (
  id                VARCHAR(64) PRIMARY KEY,
  aggregate_type    VARCHAR(64) NOT NULL,
  aggregate_id      VARCHAR(64) NOT NULL,
  aggregate_version INT NOT NULL DEFAULT 1,
  event_type        VARCHAR(64) NOT NULL,
  payload           JSON NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  published_at      DATETIME(6) NULL,
  attempt_count     INT NOT NULL DEFAULT 0,
  last_error        TEXT NULL,
  claim_owner       VARCHAR(128) NULL,
  claim_expires_at  DATETIME(6) NULL,
  next_attempt_at   DATETIME(6) NULL,
  INDEX idx_outbox_publish (published_at, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inbox_events (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  consumer_name VARCHAR(64) NOT NULL,
  event_id      VARCHAR(64) NOT NULL,
  processed_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_inbox (consumer_name, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id          VARCHAR(64) PRIMARY KEY,
  tenant_id   VARCHAR(64) NOT NULL,
  actor_id    VARCHAR(64) NOT NULL,
  event_type  VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id   VARCHAR(64) NOT NULL,
  payload     JSON NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_audit_tenant_time (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash    VARCHAR(64) NOT NULL,
  response_status INT NOT NULL,
  response_body   JSON NULL,
  resource_type   VARCHAR(64) NULL,
  resource_id     VARCHAR(64) NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at      DATETIME(6) NOT NULL,
  UNIQUE KEY uq_idempotency (tenant_id, idempotency_key),
  INDEX idx_idempotency_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
