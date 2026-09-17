import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, verifyApiKey } from '../api-keys.js';
import { AccessTokenClaimsSchema } from '../tokens.js';

describe('Security Primitives', () => {
  it('generates and verifies API keys with public prefix', () => {
    const { rawKey, prefix, hash } = generateApiKey('bbx_test');
    expect(prefix).toBe('bbx_test');
    expect(rawKey.startsWith('bbx_test_')).toBe(true);
    expect(hash).toBe(hashApiKey(rawKey));
    expect(verifyApiKey(rawKey, hash)).toBe(true);
    expect(verifyApiKey('wrong_key', hash)).toBe(false);
  });

  it('validates access token claims contract per Part 9.12', () => {
    const claims = {
      jti: 'token-123',
      iss: 'blackbox-auth',
      aud: 'blackbox-api',
      sub: 'usr_abc',
      tenantId: 'tnt_xyz',
      roles: ['ADMIN'],
      scopes: ['runs:read', 'runs:write'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    };

    const parsed = AccessTokenClaimsSchema.safeParse(claims);
    expect(parsed.success).toBe(true);
  });
});
