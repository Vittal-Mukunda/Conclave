import { AccountLimiter } from './AccountLimiter';
import { CircuitBreaker } from './CircuitBreaker';

/** A single (provider, key) endpoint with its own buckets and breaker. Phase 21
 * pools multiple accounts per provider; each carries its own KeyStore account
 * name and an observed-latency EWMA used to deprioritise a slow account
 * (PROV-15). */
export interface Account {
  id: string; // e.g. 'groq:default'
  providerId: string;
  /** KeyStore account name (the per-account key slot), e.g. 'default', 'acct-2'. */
  accountName?: string;
  limiter: AccountLimiter;
  breaker: CircuitBreaker;
  weight: number;
  /** False after a permanent account error (invalid key / billing). */
  available: boolean;
  /** Clock time until which this account is cooled (429 / Retry-After). */
  cooldownUntil: number;
  /** EWMA of observed call latency (ms). 0/undefined = unknown (no penalty). PROV-15. */
  latencyMs?: number;
}

export interface SubmitOptions<T> {
  providerId: string;
  /** Conservative token reservation (input estimate + max output). */
  estTokens: number;
  priority?: number;
  /** Performs the real call once capacity is acquired for `account`. */
  run: (account: Account) => Promise<T>;
  /** Equivalent providers to fail over to (pooling / cross-provider). */
  failoverProviderIds?: string[];
}
