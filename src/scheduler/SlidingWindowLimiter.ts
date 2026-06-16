// Strict sliding-window limiter. Guarantees the sum of recorded amounts within
// ANY window of length windowMs never exceeds `limit`. Used for RPM/TPM/RPD/TPD.
// (A sliding window is stricter than a refilling token bucket, which can admit
// up to 2x the limit across a window boundary — we need the hard guarantee.)

interface Entry {
  t: number;
  amount: number;
}

export class SlidingWindowLimiter {
  private entries: Entry[] = [];
  private sum = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  private prune(now: number): void {
    while (this.entries.length && this.entries[0].t <= now - this.windowMs) {
      this.sum -= this.entries[0].amount;
      this.entries.shift();
    }
  }

  /** Could `amount` be admitted right now without breaching the limit? */
  canAccept(now: number, amount: number): boolean {
    this.prune(now);
    return this.sum + amount <= this.limit;
  }

  record(now: number, amount: number): void {
    this.entries.push({ t: now, amount });
    this.sum += amount;
  }

  used(now: number): number {
    this.prune(now);
    return this.sum;
  }

  remaining(now: number): number {
    return Math.max(0, this.limit - this.used(now));
  }

  /** ms until `amount` fits. 0 if it fits now; windowMs if amount alone > limit. */
  timeUntilAvailable(now: number, amount: number): number {
    this.prune(now);
    if (this.sum + amount <= this.limit) {
      return 0;
    }
    let need = this.sum + amount - this.limit;
    for (const e of this.entries) {
      need -= e.amount;
      if (need <= 0) {
        return Math.max(0, e.t + this.windowMs - now);
      }
    }
    // amount alone exceeds the whole limit — it can never fit.
    return this.windowMs;
  }

  /** Adjust the most recent record (reconcile an estimate to the actual usage). */
  adjustLast(delta: number): void {
    if (delta === 0 || this.entries.length === 0) {
      return;
    }
    this.entries[this.entries.length - 1].amount += delta;
    this.sum += delta;
  }
}
