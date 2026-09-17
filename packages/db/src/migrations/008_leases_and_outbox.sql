-- =============================================================================
-- Migration 008_leases_and_outbox.sql: Execution Leases & Epoch Fencing (M8)
-- Distributed leases with strictly monotonic epoch fencing tokens
-- =============================================================================

CREATE TABLE IF NOT EXISTS execution_leases (
  id             VARCHAR(64) PRIMARY KEY,
  resource_id    VARCHAR(128) NOT NULL UNIQUE,
  holder_id      VARCHAR(64) NOT NULL,
  epoch          BIGINT NOT NULL DEFAULT 1,
  status         VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  expires_at     DATETIME(6) NOT NULL,
  acquired_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  renewed_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_lease_resource_epoch (resource_id, epoch),
  INDEX idx_lease_expiry (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
