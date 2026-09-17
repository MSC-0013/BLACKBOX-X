import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { serverConfig } from '@blackbox-x/config-server';
import * as coreSchema from './schema/core.js';
import * as topologySchema from './schema/topology.js';
import * as workloadsSchema from './schema/workloads.js';

export function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '3306', 10),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export const dbConfig = parseDatabaseUrl(serverConfig.DATABASE_URL);

export const pool = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
  timezone: 'Z',
  charset: 'utf8mb4',
});

export const db = drizzle(pool, {
  schema: { ...coreSchema, ...topologySchema, ...workloadsSchema },
  mode: 'default',
});
