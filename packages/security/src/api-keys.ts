import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedApiKey {
  rawKey: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(prefix = 'bbx_live'): GeneratedApiKey {
  const secretBytes = randomBytes(32).toString('hex');
  const rawKey = `${prefix}_${secretBytes}`;
  const hash = hashApiKey(rawKey);
  return {
    rawKey,
    prefix,
    hash,
  };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const computed = hashApiKey(rawKey);
  return computed === storedHash;
}
