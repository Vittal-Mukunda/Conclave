import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from '../../src/scheduler/Scheduler';
import { ManualClock } from '../../src/scheduler/clock';
import { AccountLimiter } from '../../src/scheduler/AccountLimiter';
import { CircuitBreaker } from '../../src/scheduler/CircuitBreaker';
import { Account } from '../../src/scheduler/types';
import { RateLimits } from '../../src/scheduler/rateLimits';
import { ConclaveError } from '../../src/errors/ErrorReport';
import { ErrorService } from '../../src/errors/ErrorService';
import { SecretRedactor } from '../../src/logging/redaction';

function account(providerId: string, limits: RateLimits, opts: { threshold?: number; cooldownMs?: number } = {}): Account {
  return {
    id: `${providerId}:default`,
    providerId,
    limiter: new AccountLimiter(limits),
    breaker: new CircuitBreaker(opts.threshold ?? 5, opts.cooldownMs ?? 30_000),
    weight: 1,
    available: true,
    cooldownUntil: 0,
  };
}

function makeScheduler(accounts: Account[], clock: ManualClock, extra = {}): Scheduler {
  return new Scheduler({
    clock,
    accounts,
    errors: new ErrorService({ redactor: new SecretRedactor() }),
    maxQueueMs: 3_600_000,
    backoff: { baseMs: 100, maxMs: 1000, factor: 2, jitter: 0 },
    rng: () => 0.5,
    ...extra,
  });
}

describe('Scheduler', () => {
  it('drains a burst without ever exceeding the per-window limit', async () => {
    const clock = new ManualClock();
    const acc = account('p', { rpm: 3 });
    const sched = makeScheduler([acc], clock);

    const dispatchedAt: number[] = [];
    const promises: Promise<number>[] = [];
    for (let i = 0; i < 9; i++) {
      promises.push(
        sched.submit<number>({
          providerId: 'p',
          estTokens: 1,
          run: async () => {
            dispatchedAt.push(clock.now());
            return i;
          },
        }),
      );
    }

    await clock.advance(0); // settle first window
    await clock.advance(60_001);
    await clock.advance(60_001);
    const results = await Promise.all(promises);

    expect(results).toHaveLength(9);
    expect(dispatchedAt).toHaveLength(9);
    // No 4 dispatches fall within any 60s window.
    const sorted = [...dispatchedAt].sort((a, b) => a - b);
    for (let i = 0; i + 3 < sorted.length; i++) {
      expect(sorted[i + 3] - sorted[i]).toBeGreaterThanOrEqual(60_000);
    }
  });

  it('no double-spend: concurrent submits never exceed capacity, each runs once', async () => {
    const clock = new ManualClock();
    const acc = account('p', { rpm: 5 });
    const sched = makeScheduler([acc], clock);

    const runCounts = new Map<number, number>();
    const promises: Promise<number>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        sched.submit<number>({
          providerId: 'p',
          estTokens: 1,
          run: async () => {
            runCounts.set(i, (runCounts.get(i) ?? 0) + 1);
            return i;
          },
        }),
      );
    }

    // At t=0 only 5 may dispatch (rpm=5). The limiter must never go over.
    await clock.advance(0);
    expect(acc.limiter.remainingRequests(0)).toBe(0);

    for (let w = 0; w < 4; w++) {
      await clock.advance(60_001);
    }
    const results = await Promise.all(promises);

    expect(new Set(results).size).toBe(20); // all distinct, none lost
    for (let i = 0; i < 20; i++) {
      expect(runCounts.get(i)).toBe(1); // none duplicated
    }
  });

  it('survives a 429 storm: every job completes exactly once after backoff', async () => {
    const clock = new ManualClock();
    const acc = account('p', { rpm: 1000 }); // high — isolate 429 handling
    const sched = makeScheduler([acc], clock);

    const attempts = new Map<number, number>();
    const promises: Promise<number>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        sched.submit<number>({
          providerId: 'p',
          estTokens: 1,
          run: async () => {
            const n = (attempts.get(i) ?? 0) + 1;
            attempts.set(i, n);
            if (n === 1) {
              throw new ConclaveError({ category: 'provider', code: 'PROV-1', title: '429', retryAfterMs: 500, canRetry: true });
            }
            return i;
          },
        }),
      );
    }

    await clock.advance(0);
    await clock.advance(600); // past the 500ms Retry-After cooldown
    await clock.advance(600);
    const results = await Promise.all(promises);

    expect(new Set(results).size).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(attempts.get(i)).toBe(2); // failed once, succeeded once — no loss/dup
    }
  });

  it('all-throttled: queues the job and surfaces a PROV-2 report with countdown + actions, then resumes', async () => {
    const clock = new ManualClock();
    const acc = account('p', { rpm: 1 });
    const sched = makeScheduler([acc], clock);

    const throttled = vi.fn();
    sched.onThrottled(throttled);

    const r1 = sched.submit<string>({ providerId: 'p', estTokens: 1, run: async () => 'first' });
    const r2 = sched.submit<string>({ providerId: 'p', estTokens: 1, run: async () => 'second' });

    await clock.advance(0);
    expect(await r1).toBe('first');
    expect(throttled).toHaveBeenCalled();
    const report = throttled.mock.calls[0][0];
    expect(report.code).toBe('PROV-2');
    expect(report.retryAfterMs).toBeGreaterThan(0);
    expect(report.recoveryActions.some((a: { kind: string }) => a.kind === 'add')).toBe(true);

    await clock.advance(60_001);
    expect(await r2).toBe('second');
  });

  it('fails over across pooled accounts (≈ Mx throughput)', async () => {
    const clock = new ManualClock();
    const a = account('p', { rpm: 1 });
    const b = account('p', { rpm: 1 });
    const sched = makeScheduler([a, b], clock);

    const used = new Set<number>();
    const p1 = sched.submit<number>({ providerId: 'p', estTokens: 1, run: async (acct) => {
      used.add(acct === a ? 0 : 1);
      return 1;
    } });
    const p2 = sched.submit<number>({ providerId: 'p', estTokens: 1, run: async (acct) => {
      used.add(acct === a ? 0 : 1);
      return 2;
    } });

    await clock.advance(0);
    await Promise.all([p1, p2]);
    expect(used.size).toBe(2); // both accounts carried load at the same instant
  });

  it('opens the breaker and ultimately rejects on a persistent outage', async () => {
    const clock = new ManualClock();
    const acc = account('p', { rpm: 1000 }, { threshold: 2, cooldownMs: 5000 });
    const sched = makeScheduler([acc], clock, { maxAttempts: 3 });

    const p = sched.submit<number>({
      providerId: 'p',
      estTokens: 1,
      run: async () => {
        throw new ConclaveError({ category: 'provider', code: 'PROV-3', title: 'outage', canRetry: true });
      },
    });

    const rejection = expect(p).rejects.toMatchObject({ code: 'PROV-3' });
    for (let i = 0; i < 6; i++) {
      await clock.advance(6000);
    }
    await rejection;
    expect(acc.breaker.currentState).not.toBe('closed');
  });
});
