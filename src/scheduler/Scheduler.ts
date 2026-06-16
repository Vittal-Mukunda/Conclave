import { ConclaveError, ErrorReport } from '../errors/ErrorReport';
import { ErrorService } from '../errors/ErrorService';
import { Logger } from '../logging/Logger';
import { Clock } from './clock';
import { BackoffPolicy, DEFAULT_BACKOFF, backoffMs } from './backoff';
import { Account, SubmitOptions } from './types';

export interface SchedulerDeps {
  clock: Clock;
  accounts: Account[];
  errors?: ErrorService;
  logger?: Logger;
  backoff?: BackoffPolicy;
  rng?: () => number;
  maxAttempts?: number;
  maxQueueMs?: number;
}

interface Job {
  id: number;
  providerIds: string[];
  estTokens: number;
  priority: number;
  attempts: number;
  enqueuedAt: number;
  run: (account: Account) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  inFlight: boolean;
  settled: boolean;
  lastError?: unknown;
}

export type ThrottleListener = (report: ErrorReport) => void;

/**
 * The single choke point through which every provider call passes. Guarantees:
 *  - a call exceeding a live RPM/TPM/RPD limit is never issued (AccountLimiter);
 *  - bursts queue and drain as capacity frees;
 *  - failover across equivalent accounts (pooling) with per-account breakers;
 *  - jittered backoff honoring Retry-After;
 *  - when everything is throttled, work is queued (not lost) and a PROV-2
 *    ErrorReport with countdowns + "Add key"/"Add paid" is surfaced.
 * Single-threaded dispatch (check+record in tryAcquire is atomic) => no race /
 * double-spend.
 */
export class Scheduler {
  private readonly clock: Clock;
  private readonly accounts: Account[];
  private readonly backoffPolicy: BackoffPolicy;
  private readonly rng: () => number;
  private readonly maxAttempts: number;
  private readonly maxQueueMs: number;

  private waiting: Job[] = [];
  private seq = 0;
  private cancelWake?: () => void;
  private throttleNotified = false;
  private readonly throttleListeners = new Set<ThrottleListener>();

  constructor(private readonly deps: SchedulerDeps) {
    this.clock = deps.clock;
    this.accounts = deps.accounts;
    this.backoffPolicy = deps.backoff ?? DEFAULT_BACKOFF;
    this.rng = deps.rng ?? Math.random;
    this.maxAttempts = deps.maxAttempts ?? 6;
    this.maxQueueMs = deps.maxQueueMs ?? 120_000;
  }

  onThrottled(listener: ThrottleListener): () => void {
    this.throttleListeners.add(listener);
    return () => this.throttleListeners.delete(listener);
  }

  submit<T>(opts: SubmitOptions<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        id: ++this.seq,
        providerIds: [opts.providerId, ...(opts.failoverProviderIds ?? [])],
        estTokens: opts.estTokens,
        priority: opts.priority ?? 0,
        attempts: 0,
        enqueuedAt: this.clock.now(),
        run: opts.run as (account: Account) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        inFlight: false,
        settled: false,
      };
      this.waiting.push(job);
      this.pump();
    });
  }

  // ---- dispatch loop ----

  private pump(): void {
    const now = this.clock.now();
    const ordered = [...this.waiting].sort(
      (a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt,
    );

    for (const job of ordered) {
      if (job.inFlight || job.settled || !this.waiting.includes(job)) {
        continue;
      }
      const account = this.pickAccount(job, now);
      if (account) {
        this.dispatch(job, account, now);
      }
    }

    // Handle still-waiting jobs: deadline rejects, throttle notice, next wake.
    let anyThrottled = false;
    for (const job of this.waiting) {
      if (job.inFlight || job.settled) {
        continue;
      }
      if (now - job.enqueuedAt >= this.maxQueueMs) {
        this.settle(job, 'reject', job.lastError ?? this.throttledError(now, job));
        continue;
      }
      if (this.hasRecoverableCandidate(job, now)) {
        anyThrottled = true;
      }
    }

    if (anyThrottled && !this.throttleNotified) {
      this.throttleNotified = true;
      this.emitThrottled(now);
    }

    this.scheduleWake(now);
  }

  private pickAccount(job: Job, now: number): Account | undefined {
    const eligible = this.candidates(job).filter((a) => this.isEligible(a, now, job.estTokens));
    if (eligible.length === 0) {
      return undefined;
    }
    // Weighted by remaining request capacity -> spreads load across the pool.
    return eligible.reduce((best, a) =>
      this.score(a, now) > this.score(best, now) ? a : best,
    );
  }

  private score(account: Account, now: number): number {
    const remaining = account.limiter.remainingRequests(now);
    const r = Number.isFinite(remaining) ? remaining : 1_000_000;
    return account.weight * r;
  }

  private candidates(job: Job): Account[] {
    return this.accounts.filter((a) => job.providerIds.includes(a.providerId));
  }

  private isEligible(account: Account, now: number, estTokens: number): boolean {
    return (
      account.available &&
      now >= account.cooldownUntil &&
      account.limiter.canServe(estTokens) &&
      account.breaker.peekAvailable(now) &&
      account.limiter.canAcquire(now, estTokens)
    );
  }

  private dispatch(job: Job, account: Account, now: number): void {
    account.breaker.confirmDispatch(now);
    const acquired = account.limiter.tryAcquire(now, job.estTokens);
    if (!acquired) {
      // Should not happen (we peeked), but never issue without capacity.
      return;
    }
    job.inFlight = true;
    job.attempts++;
    this.removeFromWaiting(job);
    this.throttleNotified = false;

    Promise.resolve()
      .then(() => job.run(account))
      .then(
        (result) => this.onSuccess(job, account, result),
        (err) => this.onFailure(job, account, err),
      );
  }

  private onSuccess(job: Job, account: Account, result: unknown): void {
    account.breaker.onSuccess();
    job.inFlight = false;
    this.settle(job, 'resolve', result);
    this.pump();
  }

  private onFailure(job: Job, account: Account, err: unknown): void {
    job.inFlight = false;
    job.lastError = err;
    const now = this.clock.now();
    const cls = classify(err);

    switch (cls) {
      case 'rate-limit': {
        const retryAfter = err instanceof ConclaveError ? err.retryAfterMs : undefined;
        account.cooldownUntil = now + (retryAfter ?? this.backoff(job.attempts));
        break;
      }
      case 'outage': {
        account.breaker.onFailure(now);
        account.cooldownUntil = Math.max(account.cooldownUntil, now + this.backoff(job.attempts));
        break;
      }
      case 'account-dead':
        account.available = false;
        break;
      case 'request-bad':
        // Don't penalise the account; just fail over to a different one.
        break;
    }

    const withinBudget = job.attempts < this.maxAttempts && now - job.enqueuedAt < this.maxQueueMs;
    const canFailover = this.candidates(job).some(
      (a) => a !== account && a.available && a.breaker.peekAvailable(now),
    );
    const shouldRetry = withinBudget && (cls !== 'request-bad' || canFailover);

    if (shouldRetry) {
      this.requeue(job);
    } else {
      this.settle(job, 'reject', err);
    }
    this.pump();
  }

  // ---- helpers ----

  private requeue(job: Job): void {
    if (!job.settled && !this.waiting.includes(job)) {
      this.waiting.push(job);
    }
  }

  private removeFromWaiting(job: Job): void {
    this.waiting = this.waiting.filter((j) => j !== job);
  }

  private settle(job: Job, kind: 'resolve' | 'reject', value: unknown): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    job.inFlight = false;
    this.removeFromWaiting(job);
    if (kind === 'resolve') {
      job.resolve(value);
    } else {
      job.reject(value);
    }
  }

  private hasRecoverableCandidate(job: Job, now: number): boolean {
    return this.candidates(job).some((a) => a.available && this.accountWait(a, now, job.estTokens) < Infinity);
  }

  private accountWait(account: Account, now: number, estTokens: number): number {
    if (!account.available || !account.limiter.canServe(estTokens)) {
      return Infinity;
    }
    return Math.max(
      account.cooldownUntil - now,
      account.breaker.timeUntilHalfOpen(now),
      account.limiter.timeUntilAvailable(now, estTokens),
    );
  }

  private scheduleWake(now: number): void {
    this.cancelWake?.();
    this.cancelWake = undefined;

    let minWake = Infinity;
    for (const job of this.waiting) {
      if (job.inFlight || job.settled) {
        continue;
      }
      let jobWait = Infinity;
      for (const a of this.candidates(job)) {
        if (a.available) {
          jobWait = Math.min(jobWait, this.accountWait(a, now, job.estTokens));
        }
      }
      const deadlineWait = Math.max(0, job.enqueuedAt + this.maxQueueMs - now);
      jobWait = Math.min(jobWait, deadlineWait);
      minWake = Math.min(minWake, jobWait);
    }

    // Only schedule a time-based wake for a real future wait. A 0 wait means the
    // job is blocked on an in-flight completion (e.g. a half-open probe), which
    // re-pumps itself on resolve — a timer would just busy-loop.
    if (Number.isFinite(minWake) && minWake > 0) {
      this.cancelWake = this.clock.setTimeout(() => {
        this.cancelWake = undefined;
        this.pump();
      }, minWake + 1);
    }
  }

  private backoff(attempt: number): number {
    return backoffMs(attempt, this.backoffPolicy, this.rng);
  }

  private emitThrottled(now: number): void {
    const error = this.throttledError(now);
    const report = this.deps.errors
      ? this.deps.errors.report(error)
      : fallbackReport(error);
    this.deps.logger?.warn('all_providers_throttled', { retryAfterMs: report.retryAfterMs });
    for (const l of this.throttleListeners) {
      try {
        l(report);
      } catch {
        /* a listener must not break the scheduler */
      }
    }
  }

  private throttledError(now: number, job?: Job): ConclaveError {
    const estTokens = job?.estTokens ?? 0;
    const waits = this.accounts
      .map((a) => this.accountWait(a, now, estTokens))
      .filter((w) => Number.isFinite(w)) as number[];
    const minWaitMs = waits.length ? Math.min(...waits) : undefined;
    const countdown = minWaitMs !== undefined ? ` Capacity frees in about ${Math.ceil(minWaitMs / 1000)}s.` : '';
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-2',
      title: 'All providers are busy right now',
      detail: `Your request is queued and will resume automatically.${countdown}`,
      recoveryActions: [
        { label: 'Add key', kind: 'add', command: 'conclave.manageKeys' },
        { label: 'Add paid provider', kind: 'add', command: 'conclave.manageKeys' },
      ],
      canRetry: true,
      retryAfterMs: minWaitMs,
    });
  }
}

type FailureClass = 'rate-limit' | 'outage' | 'account-dead' | 'request-bad';

function classify(err: unknown): FailureClass {
  if (err instanceof ConclaveError) {
    switch (err.code) {
      case 'PROV-1':
        return 'rate-limit';
      case 'SETUP-1':
      case 'SETUP-2':
      case 'PROV-13':
        return 'account-dead';
      case 'PROV-8':
      case 'PROV-9':
      case 'PROV-10':
        return 'request-bad';
      default:
        return 'outage'; // PROV-3/4/5/6/12, SETUP-8, ...
    }
  }
  return 'outage';
}

function fallbackReport(error: ConclaveError): ErrorReport {
  return {
    id: `sched-${Date.now()}`,
    timestamp: Date.now(),
    severity: 'warning',
    category: error.category,
    code: error.code,
    title: error.title,
    detail: error.detail,
    recoveryActions: error.recoveryActions,
    canRetry: error.canRetry,
    retryAfterMs: error.retryAfterMs,
  };
}
