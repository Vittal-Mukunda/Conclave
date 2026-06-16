import { ProviderKind } from '../providers/types';

// Phase 15 — data-privacy classification + Sensitive-repo mode (SEC-2). Many
// FREE tiers reserve the right to train on submitted data; that's fine for an
// open-source repo but unacceptable for a sensitive one. We classify each
// provider's data posture and, in Sensitive mode, gate out any provider that may
// train on the code — informing the user rather than silently leaking.

export type DataPosture = 'no-train' | 'trains' | 'unknown';

// Known overrides. Absent an override, paid API terms are treated as no-train and
// free tiers as training (the conservative default the design mandates).
const OVERRIDES: Record<string, DataPosture> = {
  // Paid frontier APIs with no-training-by-default terms.
  openai: 'no-train',
  anthropic: 'no-train',
  'google-paid': 'no-train',
};

/** Data posture for a provider. */
export function dataPosture(providerId: string, kind: ProviderKind): DataPosture {
  return OVERRIDES[providerId] ?? (kind === 'paid' ? 'no-train' : 'trains');
}

/**
 * May this provider be used given the Sensitive-repo setting? In Sensitive mode
 * any provider that may train on data is blocked; otherwise all are allowed.
 */
export function allowsProvider(providerId: string, kind: ProviderKind, sensitive: boolean): boolean {
  if (!sensitive) {
    return true;
  }
  return dataPosture(providerId, kind) === 'no-train';
}
