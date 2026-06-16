import { describe, it, expect } from 'vitest';
import { backoffMs, parseRetryAfterMs, DEFAULT_BACKOFF } from '../../src/scheduler/backoff';

describe('backoff (bounded + jittered)', () => {
  it('is always within [0, maxMs] even for large attempts', () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      for (let i = 0; i < 50; i++) {
        const ms = backoffMs(attempt);
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
      }
    }
  });

  it('grows with attempt (using a fixed rng)', () => {
    const rng = () => 0.5; // no jitter offset
    expect(backoffMs(0, DEFAULT_BACKOFF, rng)).toBeLessThan(backoffMs(3, DEFAULT_BACKOFF, rng));
  });

  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  it('parses Retry-After HTTP-date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const later = new Date(now + 5000).toUTCString();
    expect(parseRetryAfterMs(later, now)).toBe(5000);
  });
});
