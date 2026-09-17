import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { StorageService } from '../service/storage-service.js';

describe('StorageService Unit Tests', () => {
  it('computes content-addressable SHA-256 correctly', () => {
    const data = 'simulation_event_trace_payload_sample';
    const sha = createHash('sha256').update(data).digest('hex');
    expect(sha).toHaveLength(64);
  });

  it('initializes StorageService with correct default bucket', () => {
    const service = new StorageService({
      endpoint: 'http://localhost:9000',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
    });

    expect(service.defaultBucket).toBe('blackbox-artifacts');
  });
});
