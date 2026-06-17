import { Provider } from '../providers/types';
import { AccountLimiter } from './AccountLimiter';
import { CircuitBreaker } from './CircuitBreaker';
import { defaultLimitsFor } from './rateLimits';
import { Account } from './types';

// Phase 21 — multi-account quota pooling. Builds the scheduler `Account` objects
// from the provider list + the per-provider account names. Each account gets its
// OWN limiter + breaker so their quota POOLS (the scheduler spreads load across
// them and fails over between them) without one account's 429 stalling another.
// Pure (no vscode / SQLite) so the pool construction is unit-testable.

/** The persisted facts an account carries into its scheduler representation. */
export interface AccountSeed {
  /** KeyStore account name, e.g. 'default', 'acct-2'. */
  accountName: string;
  weight?: number;
  /** Last observed latency EWMA (ms) — seeds PROV-15 deprioritisation across sessions. */
  latencyMs?: number;
  /** False if a prior session marked this account dead (invalid key / billing). */
  available?: boolean;
}

/** Build one scheduler account for a (provider, accountName) pair. */
export function buildAccount(provider: Provider, seed: AccountSeed): Account {
  return {
    id: `${provider.id}:${seed.accountName}`,
    providerId: provider.id,
    accountName: seed.accountName,
    limiter: new AccountLimiter(defaultLimitsFor(provider)),
    breaker: new CircuitBreaker(5, 30_000),
    weight: seed.weight ?? 1,
    available: seed.available ?? true,
    cooldownUntil: 0,
    latencyMs: seed.latencyMs,
  };
}

/**
 * Build the full pool. For each provider, use its registered account seeds; when
 * a provider has none, fall back to a single 'default' account so existing
 * single-key users keep working unchanged (back-compat).
 */
export function buildPool(
  providers: Provider[],
  seedsByProvider: (providerId: string) => AccountSeed[],
): Account[] {
  const pool: Account[] = [];
  for (const p of providers) {
    const seeds = seedsByProvider(p.id);
    const effective = seeds.length > 0 ? seeds : [{ accountName: 'default' }];
    for (const seed of effective) {
      pool.push(buildAccount(p, seed));
    }
  }
  return pool;
}
