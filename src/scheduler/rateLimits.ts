import { Provider } from '../providers/types';

// Per-(provider,account) rate limits. Any subset may be set; an unset limit is
// not enforced. Phase 4's capability registry refines these from live probing;
// these are conservative starting defaults.
export interface RateLimits {
  /** Requests per minute. */
  rpm?: number;
  /** Tokens per minute. */
  tpm?: number;
  /** Requests per day. */
  rpd?: number;
  /** Tokens per day. */
  tpd?: number;
}

export function defaultLimitsFor(provider: Provider): RateLimits {
  if (provider.kind === 'paid') {
    return { rpm: 500, tpm: 200_000 };
  }
  // Conservative free-tier defaults (vary by provider; refined later).
  return { rpm: 30, tpm: 60_000, rpd: 14_400 };
}
