import { CostPolicy, PolicyContext } from '../cost/CostPolicy';
import { Cascade } from './Cascade';
import { DifficultyEstimator } from './DifficultyEstimator';
import {
  DifficultySignals,
  Estimate,
  Role,
  RoutedCandidate,
  RouterModel,
  Tier,
  TIER_INDEX,
} from './types';

// Ties the estimator + cascade + cost policy together over a candidate POOL and
// returns an ordered, cost-aware shortlist for a (role, goal). The first
// candidate is the pick; escalate() climbs the cascade after a verifier failure.
//
// Cost lever, not a quality lever (build-plan §5): the cascade starts at the
// cheapest tier the role/difficulty allow and only climbs on a concrete failure,
// which is where the 45-85% saving vs always-top comes from.

const SMALL_MODEL = /(\b8b\b|1b|3b|mini|lite|instant|small|haiku|nano|tiny|flash-lite)/i;

/** Classify a model into a cascade tier from its kind, price and id heuristics. */
export function classifyTier(m: RouterModel): Tier {
  const small = SMALL_MODEL.test(m.modelId);
  const reasoning = m.capabilities.includes('reasoning');
  if (m.kind === 'paid') {
    // Cheap paid (mini/haiku) is a mid rung; everything else is the frontier.
    return small ? 'L2' : 'L3';
  }
  // Free tiers: a reasoning-capable free model is the strongest free rung; small
  // instant models are the cheap rung; the rest (70b-class) sit in the middle.
  if (reasoning) return 'L2';
  if (small) return 'L0';
  return 'L1';
}

export interface RouterDeps {
  /** Snapshot of keyed, available models the router may pick from. */
  pool: () => RouterModel[];
  /** Comparable scalar for a model (pricedCost.total in the host). Lower is preferred. */
  priceOf: (m: RouterModel) => number;
  policy: CostPolicy;
  policyCtx: () => PolicyContext;
  estimator: DifficultyEstimator;
  cascade?: Cascade;
  logger?: { info: (e: string, d?: Record<string, unknown>) => void };
}

export interface RouteResult {
  role: Role;
  estimate: Estimate;
  /** Tier the cascade entered at (or the escalation floor). */
  startTier: Tier;
  /** Ordered shortlist: preferred first. Empty when nothing is eligible. */
  candidates: RoutedCandidate[];
  /** The pick (candidates[0]) or undefined when the pool can't serve the role. */
  chosen?: RoutedCandidate;
  /** Honest flags: e.g. forced below the desired tier (lowers confidence). */
  flags: string[];
}

export class CascadeRouter {
  private readonly cascade: Cascade;

  constructor(private readonly deps: RouterDeps) {
    this.cascade = deps.cascade ?? new Cascade();
  }

  /** Select a model for a stage. Pass `floorTier` to enter above the natural start. */
  route(
    role: Role,
    goal: string,
    signals: DifficultySignals = {},
    floorTier?: Tier,
  ): RouteResult {
    const estimate = this.deps.estimator.estimate(goal, signals);
    const startTier = floorTier ?? this.cascade.startTier(role, estimate);
    const flags: string[] = [];

    const ctx = this.deps.policyCtx();
    const required = this.cascade.requiredCapability(role);
    const preferred = this.cascade.preferredCapability(role);

    const eligible = this.deps
      .pool()
      .filter((m) => this.deps.policy.allows({ kind: m.kind }, ctx))
      .filter((m) => (required ? m.capabilities.includes(required) : true));

    const routed: RoutedCandidate[] = eligible.map((m) => ({
      model: m,
      tier: classifyTier(m),
      role,
      cost: this.deps.priceOf(m),
    }));

    const startIdx = TIER_INDEX[startTier];
    const fit = (c: RoutedCandidate) => (c.model.capabilities.includes(preferred) ? 0 : 1);

    // At/above the floor: cheapest tier first, then best role fit, then cost.
    const atOrAbove = routed
      .filter((c) => TIER_INDEX[c.tier] >= startIdx)
      .sort((a, b) => TIER_INDEX[a.tier] - TIER_INDEX[b.tier] || fit(a) - fit(b) || a.cost - b.cost);

    // Below the floor (fallback only): strongest tier first — the best we can do
    // when the pool can't reach the desired rung (e.g. free-only, no paid coder).
    const below = routed
      .filter((c) => TIER_INDEX[c.tier] < startIdx)
      .sort((a, b) => TIER_INDEX[b.tier] - TIER_INDEX[a.tier] || fit(a) - fit(b) || a.cost - b.cost);

    const candidates = [...atOrAbove, ...below];
    const chosen = candidates[0];

    if (!chosen) {
      flags.push(`no eligible model for role ${role} under the current cost mode`);
    } else if (TIER_INDEX[chosen.tier] < startIdx) {
      flags.push(`best available tier ${chosen.tier} is below desired ${startTier} — confidence lowered`);
    }

    this.deps.logger?.info('route', {
      role,
      goal: goal.slice(0, 80),
      d: estimate.d,
      startTier,
      chosen: chosen ? `${chosen.model.providerId}/${chosen.model.modelId}@${chosen.tier}` : 'none',
      flags,
    });

    return { role, estimate, startTier, candidates, chosen, flags };
  }

  /**
   * Verifier-triggered escalation: re-route the same goal entering one tier above
   * the previous pick. Returns the prior result unchanged once already at L3
   * (nowhere left to climb), flagged so the caller can hand off instead of spin.
   */
  escalate(prev: RouteResult, goal: string, signals: DifficultySignals = {}): RouteResult {
    const from = prev.chosen?.tier ?? prev.startTier;
    if (this.cascade.isTop(from)) {
      return { ...prev, flags: [...prev.flags, 'already at the top tier (L3) — cannot escalate'] };
    }
    return this.route(prev.role, goal, signals, this.cascade.next(from));
  }
}
