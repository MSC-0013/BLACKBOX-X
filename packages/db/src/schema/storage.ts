import {
  mysqlTable,
  varchar,
  datetime,
  bigint,
  json,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';

export const storedArtifacts = mysqlTable(
  'stored_artifacts',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bucketName: varchar('bucket_name', { length: 64 }).notNull(),
    objectKey: varchar('object_key', { length: 255 }).notNull().unique(),
    contentType: varchar('content_type', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256Checksum: varchar('sha256_checksum', { length: 64 }).notNull(),
    metadata: json('metadata'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenant: index('idx_artifact_tenant').on(table.tenantId, table.createdAt),
  }),
);
