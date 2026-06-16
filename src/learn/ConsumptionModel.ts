// The consumption (rho) regressor (OR design §5): a per-arm EWMA of observed
// token usage that feeds pricedCost so a model that habitually emits more tokens
// is penalised proportionally. A lightweight stand-in for a learned regressor
// (pure-TS deviation, like the embeddings); the interface is the stable seam.

const ALPHA = 0.3; // EWMA smoothing for consumption.

export class ConsumptionModel {
  private readonly rho = new Map<string, number>();

  constructor(private readonly alpha = ALPHA) {}

  /** Expected tokens for an arm, or `fallback` if never observed. */
  expected(arm: string, fallback: number): number {
    return this.rho.get(arm) ?? fallback;
  }

  /** Fold an observed token count into the arm's EWMA. */
  observe(arm: string, tokens: number): number {
    const prev = this.rho.get(arm);
    const next = prev === undefined ? tokens : prev * (1 - this.alpha) + tokens * this.alpha;
    this.rho.set(arm, next);
    return next;
  }

  get(arm: string): number | undefined {
    return this.rho.get(arm);
  }

  set(arm: string, value: number): void {
    this.rho.set(arm, value);
  }
}
