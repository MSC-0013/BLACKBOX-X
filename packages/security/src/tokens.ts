import { z } from 'zod';
import { RoleSchema } from '@blackbox-x/contracts';

export const AccessTokenClaimsSchema = z.object({
  jti: z.string(),
  iss: z.string(),
  aud: z.string(),
  sub: z.string(),
  tenantId: z.string(),
  roles: z.array(RoleSchema),
  scopes: z.array(z.string()).default([]),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

export const RefreshTokenClaimsSchema = z.object({
  jti: z.string(),
  sub: z.string(),
  tenantId: z.string(),
  familyId: z.string(),
  version: z.number().int().default(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type RefreshTokenClaims = z.infer<typeof RefreshTokenClaimsSchema>;
