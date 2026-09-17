import { z } from 'zod';

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_API_URL: z.string().default('http://localhost:4000'),
});

export type ClientConfig = z.infer<typeof clientEnvSchema>;

function getRawEnv(): Record<string, string | undefined> {
  const globalObj = globalThis as unknown as {
    window?: { __ENV?: Record<string, string | undefined> };
  };
  if (globalObj.window?.__ENV) {
    return globalObj.window.__ENV;
  }
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

export function loadClientConfig(
  rawEnv: Record<string, string | undefined> = getRawEnv(),
): ClientConfig {
  const filtered: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (key.startsWith('NEXT_PUBLIC_')) {
      filtered[key] = value;
    }
  }

  const result = clientEnvSchema.safeParse(filtered);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Client configuration validation error: ${JSON.stringify(formatted, null, 2)}`);
  }
  return Object.freeze(result.data);
}

export const clientConfig: ClientConfig = loadClientConfig();
