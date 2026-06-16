import { describe, it, expect } from 'vitest';
import { AccountLimiter } from '../../src/scheduler/AccountLimiter';

describe('AccountLimiter (atomic acquire across all windows)', () => {
  it('blocks when the request window is full, frees when it slides', () => {
    const l = new AccountLimiter({ rpm: 2, tpm: 1000 });
    expect(l.tryAcquire(0, 10)).toBe(true);
    expect(l.tryAcquire(0, 10)).toBe(true);
    expect(l.canAcquire(0, 10)).toBe(false); // rpm 2/2
    expect(l.canAcquire(60_001, 10)).toBe(true); // window slid past
  });

  it('blocks when the token window is full', () => {
    const l = new AccountLimiter({ rpm: 100, tpm: 100 });
    expect(l.tryAcquire(0, 80)).toBe(true);
    expect(l.canAcquire(0, 30)).toBe(false); // 80 + 30 > 100
    expect(l.canAcquire(0, 20)).toBe(true); // 80 + 20 == 100
  });

  it('does not record anything when acquire fails (no partial spend)', () => {
    const l = new AccountLimiter({ rpm: 1, tpm: 100 });
    l.tryAcquire(0, 10); // uses the only request slot
    const before = l.remainingRequests(0);
    expect(l.tryAcquire(0, 10)).toBe(false);
    expect(l.remainingRequests(0)).toBe(before); // unchanged
  });

  it('canServe is false when a single request exceeds a token window', () => {
    const l = new AccountLimiter({ tpm: 100 });
    expect(l.canServe(101)).toBe(false);
    expect(l.canServe(100)).toBe(true);
  });

  it('reports the max wait across windows', () => {
    const l = new AccountLimiter({ rpm: 1, tpm: 1000 });
    l.tryAcquire(0, 10);
    expect(l.timeUntilAvailable(0, 10)).toBe(60_000); // blocked by rpm window
  });
});
