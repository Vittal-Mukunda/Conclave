// Bounded, jittered exponential backoff + Retry-After parsing.

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
  factor: number;
  /** Fractional jitter, 0..1. 0.5 => +/-50% of the computed delay. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
};

/** Delay for a given attempt (0-based). Never exceeds maxMs, never negative. */
export function backoffMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  rng: () => number = Math.random,
): number {
  const raw = Math.min(policy.maxMs, policy.baseMs * Math.pow(policy.factor, Math.max(0, attempt)));
  const spread = raw * policy.jitter;
  const jittered = raw - spread + rng() * 2 * spread;
  return Math.max(0, Math.min(policy.maxMs, Math.round(jittered)));
}

/**
 * Parse an HTTP Retry-After header (seconds or HTTP-date) to milliseconds from
 * `now`. Returns undefined when absent or unparseable.
 */
export function parseRetryAfterMs(value: string | undefined, now: number = Date.now()): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now);
  }
  return undefined;
}
