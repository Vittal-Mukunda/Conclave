// Per-account circuit breaker. K consecutive failures -> open for cooldownMs ->
// half-open (one probe allowed) -> closed on success, re-open on probe failure.
// Time comes from the injected clock via the `now` passed to each method.

export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  get currentState(): BreakerState {
    return this.state;
  }

  /** Effective state, accounting for elapsed cooldown (does not mutate). */
  private effectiveState(now: number): BreakerState {
    if (this.state === 'open' && now - this.openedAt >= this.cooldownMs) {
      return 'half-open';
    }
    return this.state;
  }

  /** Would a dispatch be allowed now? Non-mutating. */
  peekAvailable(now: number): boolean {
    const s = this.effectiveState(now);
    if (s === 'closed') return true;
    if (s === 'open') return false;
    return !this.probing; // half-open: only if no probe is in flight
  }

  /** Commit to a dispatch (call only after peekAvailable returned true). */
  confirmDispatch(now: number): void {
    const s = this.effectiveState(now);
    this.state = s;
    if (s === 'half-open') {
      this.probing = true;
    }
  }

  onSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.probing = false;
  }

  onFailure(now: number): void {
    if (this.state === 'half-open') {
      this.open(now);
      return;
    }
    this.failures++;
    if (this.failures >= this.threshold) {
      this.open(now);
    }
  }

  timeUntilHalfOpen(now: number): number {
    if (this.state !== 'open') {
      return 0;
    }
    return Math.max(0, this.cooldownMs - (now - this.openedAt));
  }

  private open(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.probing = false;
  }
}
