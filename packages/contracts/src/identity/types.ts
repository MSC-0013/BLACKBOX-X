import { z } from 'zod';

export const RoleSchema = z.enum(['OWNER', 'ADMIN', 'ENGINEER', 'ANALYST', 'VIEWER']);
export type Role = z.infer<typeof RoleSchema>;

export const TenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  status: z.enum(['active', 'suspended', 'pending']),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type User = z.infer<typeof UserSchema>;

export const MembershipSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  role: RoleSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const ApiKeySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.date(),
  expiresAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;
