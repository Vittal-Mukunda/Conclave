import { SlidingWindowLimiter } from './SlidingWindowLimiter';
import { RateLimits } from './rateLimits';

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Combines the request- and token-windows for one account. A call must acquire
 * from ALL applicable windows atomically — tryAcquire is the single choke point
 * that makes an over-limit issuance physically impossible.
 */
export class AccountLimiter {
  private readonly reqLimiters: SlidingWindowLimiter[] = [];
  private readonly tokLimiters: SlidingWindowLimiter[] = [];

  constructor(limits: RateLimits) {
    if (limits.rpm) this.reqLimiters.push(new SlidingWindowLimiter(limits.rpm, MINUTE));
    if (limits.rpd) this.reqLimiters.push(new SlidingWindowLimiter(limits.rpd, DAY));
    if (limits.tpm) this.tokLimiters.push(new SlidingWindowLimiter(limits.tpm, MINUTE));
    if (limits.tpd) this.tokLimiters.push(new SlidingWindowLimiter(limits.tpd, DAY));
  }

  /** False if no window could ever fit this request (e.g. estTokens > a TPM). */
  canServe(estTokens: number): boolean {
    for (const l of this.tokLimiters) {
      if (l.limit < estTokens) return false;
    }
    for (const l of this.reqLimiters) {
      if (l.limit < 1) return false;
    }
    return true;
  }

  canAcquire(now: number, estTokens: number): boolean {
    for (const l of this.reqLimiters) {
      if (!l.canAccept(now, 1)) return false;
    }
    for (const l of this.tokLimiters) {
      if (!l.canAccept(now, estTokens)) return false;
    }
    return true;
  }

  /** Atomic check-all-then-record-all. Single-threaded JS => no race / double-spend. */
  tryAcquire(now: number, estTokens: number): boolean {
    if (!this.canAcquire(now, estTokens)) {
      return false;
    }
    for (const l of this.reqLimiters) l.record(now, 1);
    for (const l of this.tokLimiters) l.record(now, estTokens);
    return true;
  }

  timeUntilAvailable(now: number, estTokens: number): number {
    let wait = 0;
    for (const l of this.reqLimiters) wait = Math.max(wait, l.timeUntilAvailable(now, 1));
    for (const l of this.tokLimiters) wait = Math.max(wait, l.timeUntilAvailable(now, estTokens));
    return wait;
  }

  /** Reconcile reserved estimate to the actual token usage after a call. */
  reconcileTokens(estTokens: number, actualTokens: number): void {
    const delta = actualTokens - estTokens;
    for (const l of this.tokLimiters) l.adjustLast(delta);
  }

  remainingRequests(now: number): number {
    if (this.reqLimiters.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.min(...this.reqLimiters.map((l) => l.remaining(now)));
  }
}
