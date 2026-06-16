// Phase 11 — difficulty estimator + cascade router. All vscode/LLM-free so the
// OR routing logic is deterministically unit-testable; the host wires the pool
// (keyed provider models), pricedCost scalar and cost policy in RouterService.
//
// Two independent axes (build-plan "The hierarchy"):
//   DIFFICULTY — cheap/fast do mundane work; strong models do hard work; the
//                cascade climbs only when needed.
//   ROLE       — best tier per stage. IMPLEMENT is convergent authorship -> a
//                strong CODING model regardless of difficulty; only MECHANICAL
//                edits (rename/reformat) drop to the cheap tier.

import { ProviderKind } from '../providers/types';

/** Pipeline stage the router is selecting a model for. */
export type Role = 'plan' | 'implement' | 'review' | 'mechanical';

/** Cascade tiers, weakest -> strongest. Used both as a difficulty bucket and as
 *  a model class, so a level can be compared against a model's tier. */
export type Tier = 'L0' | 'L1' | 'L2' | 'L3';
export const TIERS: readonly Tier[] = ['L0', 'L1', 'L2', 'L3'];
export const TIER_INDEX: Record<Tier, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

export type TaskType = 'mechanical' | 'bugfix' | 'feature' | 'refactor' | 'design';

/** Optional external signals that sharpen the heuristic estimate. */
export interface DifficultySignals {
  /** Distinct files the change is expected to touch (breadth raises difficulty). */
  scopeFiles?: number;
  /** Localization confidence 0..1 — low means we can't place the edit, so harder. */
  localizeConfidence?: number;
}

export interface Estimate {
  /** Continuous difficulty in [0,1]. */
  d: number;
  /** Bucketed level used to pick the cascade start tier. */
  level: Tier;
  taskType: TaskType;
  /** Signals that drove the score (telemetry + drift explanation). */
  reasons: string[];
}

/** A keyed, available model the router may choose, flattened from the registry. */
export interface RouterModel {
  providerId: string;
  modelId: string;
  kind: ProviderKind;
  capabilities: string[];
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}

export interface RoutedCandidate {
  model: RouterModel;
  tier: Tier;
  role: Role;
  /** Comparable scalar (pricedCost: real $ + shadow-priced scarcity). Lower wins. */
  cost: number;
}

/** Difficulty level from a continuous score. Buckets are even quarters. */
export function levelFromD(d: number): Tier {
  if (d < 0.25) return 'L0';
  if (d < 0.5) return 'L1';
  if (d < 0.75) return 'L2';
  return 'L3';
}
