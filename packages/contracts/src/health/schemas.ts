import { z } from 'zod';

export const DependencyStatusSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
});

export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const LiveHealthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type LiveHealthResponse = z.infer<typeof LiveHealthResponseSchema>;

export const StartupHealthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type StartupHealthResponse = z.infer<typeof StartupHealthResponseSchema>;

export const ReadyHealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({
    mysql: DependencyStatusSchema,
    redis: DependencyStatusSchema,
    kafka: DependencyStatusSchema,
    minio: DependencyStatusSchema,
  }),
});

export type ReadyHealthResponse = z.infer<typeof ReadyHealthResponseSchema>;

export const DetailedHealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string(),
  checks: z.record(DependencyStatusSchema),
});

export type DetailedHealthResponse = z.infer<typeof DetailedHealthResponseSchema>;
