-- =============================================================================
-- Migration 010_storage.sql: Storage Tier Resilience & Artifacts (M10)
-- Object storage artifact tracking, SHA-256 integrity, and retention metadata
-- =============================================================================

CREATE TABLE IF NOT EXISTS stored_artifacts (
  id               VARCHAR(64) PRIMARY KEY,
  tenant_id        VARCHAR(64) NOT NULL,
  bucket_name      VARCHAR(64) NOT NULL,
  object_key       VARCHAR(255) NOT NULL UNIQUE,
  content_type     VARCHAR(64) NOT NULL,
  size_bytes       BIGINT NOT NULL,
  sha256_checksum  VARCHAR(64) NOT NULL,
  metadata         JSON NULL,
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_artifact_tenant (tenant_id, created_at),
  CONSTRAINT fk_artifact_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
