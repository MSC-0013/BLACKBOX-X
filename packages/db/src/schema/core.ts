import {
  mysqlTable,
  varchar,
  datetime,
  int,
  bigint,
  text,
  json,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';

export const tenants = mysqlTable('tenants', {
  id: varchar('id', { length: 64 }).primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const users = mysqlTable('users', {
  id: varchar('id', { length: 64 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const memberships = mysqlTable(
  'memberships',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull().default('VIEWER'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uqMembership: uniqueIndex('uq_membership').on(table.tenantId, table.userId),
    idxUser: index('idx_memberships_user').on(table.userId),
  }),
);

export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    prefix: varchar('prefix', { length: 32 }).notNull(),
    hash: varchar('hash', { length: 64 }).notNull(),
    scopes: json('scopes').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }),
    lastUsedAt: datetime('last_used_at', { mode: 'date', fsp: 6 }),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 6 }),
  },
  (table) => ({
    idxTenant: index('idx_apikeys_tenant').on(table.tenantId),
    idxHash: index('idx_apikeys_hash').on(table.hash),
  }),
);

export const outboxEvents = mysqlTable(
  'outbox_events',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 64 }).notNull(),
    aggregateVersion: int('aggregate_version').notNull().default(1),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: datetime('published_at', { mode: 'date', fsp: 6 }),
    attemptCount: int('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    claimOwner: varchar('claim_owner', { length: 128 }),
    claimExpiresAt: datetime('claim_expires_at', { mode: 'date', fsp: 6 }),
    nextAttemptAt: datetime('next_attempt_at', { mode: 'date', fsp: 6 }),
  },
  (table) => ({
    idxPublish: index('idx_outbox_publish').on(table.publishedAt, table.nextAttemptAt),
  }),
);

export const inboxEvents = mysqlTable(
  'inbox_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    consumerName: varchar('consumer_name', { length: 64 }).notNull(),
    eventId: varchar('event_id', { length: 64 }).notNull(),
    processedAt: datetime('processed_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uqInbox: uniqueIndex('uq_inbox').on(table.consumerName, table.eventId),
  }),
);

export const auditEvents = mysqlTable(
  'audit_events',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    actorId: varchar('actor_id', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 64 }).notNull(),
    payload: json('payload'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantTime: index('idx_audit_tenant_time').on(table.tenantId, table.createdAt),
  }),
);

export const idempotencyRecords = mysqlTable(
  'idempotency_records',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseStatus: int('response_status').notNull(),
    responseBody: json('response_body'),
    resourceType: varchar('resource_type', { length: 64 }),
    resourceId: varchar('resource_id', { length: 64 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
  },
  (table) => ({
    uqIdempotency: uniqueIndex('uq_idempotency').on(table.tenantId, table.idempotencyKey),
    idxExpires: index('idx_idempotency_expires').on(table.expiresAt),
  }),
);
