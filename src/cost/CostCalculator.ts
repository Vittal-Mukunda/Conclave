import { ProviderRegistry } from '../providers/registry';

// Reference frontier price used to value "money saved" by running free models
// (what the same tokens would have cost on a capable paid model). An estimate —
// surfaced as such (COST-5).
export interface ReferencePrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const REFERENCE_PRICE: ReferencePrice = { inputPerMTok: 3, outputPerMTok: 15 };

export interface CostBreakdown {
  /** Real USD spent (paid models only). */
  spendUsd: number;
  /** Estimated USD avoided by using a free model. */
  savedUsd: number;
  paid: boolean;
}

/** Pure pricing from provider/model metadata. No IO. */
export class CostCalculator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly reference: ReferencePrice = REFERENCE_PRICE,
  ) {}

  price(providerId: string, modelId: string, tokensIn: number, tokensOut: number): CostBreakdown {
    const provider = this.registry.get(providerId);
    const model = provider?.defaultModels.find((m) => m.id === modelId);
    const inP = model?.inputPricePerMTok ?? 0;
    const outP = model?.outputPricePerMTok ?? 0;
    const paid = provider?.kind === 'paid' && (inP > 0 || outP > 0);

    if (paid) {
      const spendUsd = (tokensIn / 1_000_000) * inP + (tokensOut / 1_000_000) * outP;
      return { spendUsd, savedUsd: 0, paid: true };
    }
    const savedUsd =
      (tokensIn / 1_000_000) * this.reference.inputPerMTok +
      (tokensOut / 1_000_000) * this.reference.outputPerMTok;
    return { spendUsd: 0, savedUsd, paid: false };
  }
}
