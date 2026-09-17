import { describe, it, expect } from 'vitest';
import { loadServerConfig } from '../env.js';

describe('Server Config', () => {
  it('applies default configuration values cleanly', () => {
    const config = loadServerConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_URL).toContain('3308');
    expect(config.REDIS_URL).toContain('6380');
    expect(config.API_PORT).toBe(4000);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('validates custom port and overrides', () => {
    const config = loadServerConfig({
      API_PORT: '5050',
      NODE_ENV: 'test',
    });
    expect(config.API_PORT).toBe(5050);
    expect(config.NODE_ENV).toBe('test');
  });

  it('rejects invalid environment types', () => {
    expect(() =>
      loadServerConfig({
        NODE_ENV: 'invalid-env' as unknown as string,
      }),
    ).toThrow();
  });
});
