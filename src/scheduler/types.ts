import { AccountLimiter } from './AccountLimiter';
import { CircuitBreaker } from './CircuitBreaker';

/** A single (provider, key) endpoint with its own buckets and breaker. Phase 21
 * adds multiple accounts per provider; for now there is one default each. */
export interface Account {
  id: string; // e.g. 'groq:default'
  providerId: string;
  limiter: AccountLimiter;
  breaker: CircuitBreaker;
  weight: number;
  /** False after a permanent account error (invalid key / billing). */
  available: boolean;
  /** Clock time until which this account is cooled (429 / Retry-After). */
  cooldownUntil: number;
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
