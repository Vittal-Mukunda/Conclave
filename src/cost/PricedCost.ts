import { CostCalculator } from './CostCalculator';
import { ShadowPriceEngine } from './ShadowPriceEngine';

// The single scalar the router minimises. It fuses the REAL dollar cost of a
// candidate (non-zero only for paid models) with the shadow-priced cost of every
// scarce resource the call would consume. This is what makes "free but
// rate-limited" comparable to "paid but unlimited": a free model's $ term is 0
// but its quota resources carry shadow prices that climb as they get scarce.

export interface ResourceUse {
  /** Resource id, matching what ShadowPriceEngine prices (e.g. "groq:default:rpm"). */
  id: string;
  /** Amount of that resource this call consumes (requests, tokens, ms, ...). */
  amount: number;
}

export interface PricedCostInput {
  providerId: string;
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  /** Scarce resources this call draws on, beyond raw dollars. */
  resources?: ResourceUse[];
}

export interface PricedCostBreakdown {
  /** Real USD (paid only). */
  dollarCost: number;
  /** Sum of lambda_j * consumption_j over the supplied resources. */
  shadowCost: number;
  /** dollarCost + shadowCost — the comparable scalar. */
  total: number;
}

/** pricedCost(provider, model, stage): real $ for paid + shadow-priced scarcity. */
export class PricedCost {
  constructor(
    private readonly cost: CostCalculator,
    private readonly shadow: ShadowPriceEngine,
  ) {}

  price(input: PricedCostInput): PricedCostBreakdown {
    const dollarCost = this.cost.price(input.providerId, input.modelId, input.tokensIn, input.tokensOut)
      .spendUsd;
    let shadowCost = 0;
    for (const r of input.resources ?? []) {
      shadowCost += this.shadow.priceOf(r.id) * r.amount;
    }
    return { dollarCost, shadowCost, total: dollarCost + shadowCost };
  }
}
