// Shadow prices (Lagrange multipliers) per scarce resource. The OR brain treats
// each constrained resource — a provider/account/window quota, global latency,
// the global $ budget — as having a *price* lambda that the router adds into the
// cost of using it. Free tiers cost $0 but their scarce rate-limit quota gets a
// shadow price, so paid and free candidates become comparable on one scale.
//
// Update is projected subgradient ascent on the dual:
//   lambda_j <- max(0, lambda_j + eta * (consumption_j - budget_j))
// Over budget => price rises (discourage); under budget => price decays toward 0
// (a slack constraint is free). Projection onto >= 0 keeps prices economically
// meaningful (a non-binding constraint never carries a negative price).

export interface ShadowPriceConfig {
  /** Step size for the subgradient update. */
  eta?: number;
}

export class ShadowPriceEngine {
  private readonly lambda = new Map<string, number>();
  private readonly eta: number;

  constructor(config: ShadowPriceConfig = {}) {
    this.eta = config.eta ?? 0.1;
  }

  /** Current price of a resource (0 if never constrained). */
  priceOf(resource: string): number {
    return this.lambda.get(resource) ?? 0;
  }

  /**
   * Fold one observation into the price: raise if consumption exceeded its
   * budget, decay toward 0 otherwise. Returns the new price.
   */
  update(resource: string, consumption: number, budget: number): number {
    const next = Math.max(0, this.priceOf(resource) + this.eta * (consumption - budget));
    this.lambda.set(resource, next);
    return next;
  }

  /** Force a price (e.g. restored from persistence or a manual pin). */
  set(resource: string, value: number): void {
    this.lambda.set(resource, Math.max(0, value));
  }

  /** All non-zero prices, for telemetry / UI. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.lambda);
  }

  reset(): void {
    this.lambda.clear();
  }
}
