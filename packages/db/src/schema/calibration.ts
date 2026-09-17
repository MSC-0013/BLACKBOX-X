import {
  mysqlTable,
  varchar,
  datetime,
  int,
  double,
  json,
  index,
} from 'drizzle-orm/mysql-core';
import { tenants } from './core.js';
import { projects } from './topology.js';

export const calibrationSessions = mysqlTable(
  'calibration_sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 64 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 32 }).notNull(),
    initialLoss: double('initial_loss').notNull(),
    finalLoss: double('final_loss').notNull(),
    parameterDeltas: json('parameter_deltas').notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxTenantProject: index('idx_calibration_tenant_proj').on(table.tenantId, table.projectId),
  }),
);

export const calibrationIterations = mysqlTable(
  'calibration_iterations',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    calibrationSessionId: varchar('calibration_session_id', { length: 64 })
      .notNull()
      .references(() => calibrationSessions.id, { onDelete: 'cascade' }),
    iterationNum: int('iteration_num').notNull(),
    candidateParams: json('candidate_params').notNull(),
    loss: double('loss').notNull(),
    ksStatistic: double('ks_statistic'),
    mape: double('mape').notNull(),
    verdict: varchar('verdict', { length: 32 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 6 })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    idxCalibIter: index('idx_calib_iter_session').on(table.calibrationSessionId, table.iterationNum),
  }),
);
