import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repository-root .env file into process.env if present.
 * Walks upward from the current module's file path.
 */
function loadRepoEnvFile(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadRepoEnvFile();

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .default('mysql://blackbox:blackbox@localhost:3308/blackbox'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  MINIO_ENDPOINT: z.string().default('http://localhost:9000'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default('dev_blackbox_x_session_secret_32_chars_long_minimum'),
  JWT_SECRET: z
    .string()
    .min(32)
    .default('dev_blackbox_x_jwt_secret_must_be_at_least_32_characters_long'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
});

export type ServerConfig = z.infer<typeof serverEnvSchema>;

export function loadServerConfig(
  rawEnv: Record<string, string | undefined> = process.env,
): ServerConfig {
  const result = serverEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Server configuration validation error: ${JSON.stringify(formatted, null, 2)}`);
  }
  return Object.freeze(result.data);
}

export const serverConfig: ServerConfig = loadServerConfig();
