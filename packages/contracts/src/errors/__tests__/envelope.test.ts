import { describe, it, expect } from 'vitest';
import { createErrorEnvelope, ErrorEnvelopeSchema } from '../envelope.js';
import { ErrorCodes } from '../codes.js';

describe('Error Envelope', () => {
  it('creates an envelope conforming to Part 8.11 schema', () => {
    const envelope = createErrorEnvelope(
      ErrorCodes.AUTH_UNAUTHENTICATED,
      'Authentication is required',
      'req-12345',
      { attemptedPath: '/protected' },
    );

    expect(envelope).toEqual({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication is required',
        requestId: 'req-12345',
        details: { attemptedPath: '/protected' },
      },
    });

    const parsed = ErrorEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });

  it('handles envelopes without optional details', () => {
    const envelope = createErrorEnvelope(
      ErrorCodes.RUN_NOT_FOUND,
      'Run run_99 does not exist',
      'req-54321',
    );

    expect(envelope.error.details).toBeUndefined();
    const parsed = ErrorEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });
});
