import {
  mysqlTable,
  varchar,
  datetime,
  bigint,
  index,
} from 'drizzle-orm/mysql-core';

export const executionLeases = mysqlTable(
  'execution_leases',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    resourceId: varchar('resource_id', { length: 128 }).notNull().unique(),
    holderId: varchar('holder_id', { length: 64 }).notNull(),
    epoch: bigint('epoch', { mode: 'number' }).notNull().default(1),
    status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 6 }).notNull(),
    acquiredAt: datetime('acquired_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    renewedAt: datetime('renewed_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxResourceEpoch: index('idx_lease_resource_epoch').on(table.resourceId, table.epoch),
    idxExpiry: index('idx_lease_expiry').on(table.status, table.expiresAt),
  }),
);
