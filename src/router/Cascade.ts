import { Estimate, Role, Tier, TIERS, TIER_INDEX } from './types';

// The per-role cascade (build-plan §4 "Difficulty estimator + cascade").
// startTier(role, difficulty) picks where to ENTER the ladder; next() climbs it.
// The two non-negotiable role rules:
//   IMPLEMENT  — convergent single authorship: never below L2 (a strong coder),
//                L3 once difficulty is high. Mundane difficulty does NOT drop the
//                author to a cheap model; only mechanical edits do that.
//   MECHANICAL — rename/reformat: always the cheapest tier (L0).
// PLAN / REVIEW are divergent stages: they enter at the difficulty bucket and a
// heterogeneous council (Phase 13) will later widen them.

/** Difficulty at/above which a high-d task starts one tier higher. */
export const HIGH_DIFFICULTY = 0.75;

export class Cascade {
  /** Tier to enter the ladder at for this role + difficulty. */
  startTier(role: Role, est: Estimate): Tier {
    switch (role) {
      case 'mechanical':
        return 'L0';
      case 'implement':
        // Strong coder floor; climb to frontier only when the task is genuinely hard.
        return est.d >= HIGH_DIFFICULTY ? 'L3' : 'L2';
      case 'plan':
      case 'review':
        return est.level;
      default:
        return est.level;
    }
  }

  /** Climb one tier (verifier-triggered escalation). Caps at L3. */
  next(tier: Tier): Tier {
    const i = Math.min(TIERS.length - 1, TIER_INDEX[tier] + 1);
    return TIERS[i];
  }

  /** Whether a tier is already the strongest rung. */
  isTop(tier: Tier): boolean {
    return tier === 'L3';
  }

  /** Capability a role hard-requires of any candidate. */
  requiredCapability(role: Role): 'code' | undefined {
    return role === 'implement' || role === 'mechanical' ? 'code' : undefined;
  }

  /** Capability a role merely PREFERS (used to order, not to filter). */
  preferredCapability(role: Role): 'reasoning' | 'code' {
    return role === 'plan' || role === 'review' ? 'reasoning' : 'code';
  }
}

/** Signals that justify climbing the cascade after an attempt (build-plan §4). */
export interface EscalationInput {
  /** The verification ladder failed a rung. */
  ladderFailed?: boolean;
  /** Verifier confidence (compared against tau). */
  confidence?: number;
  /** Accept threshold tau — confidence below it escalates. */
  tau: number;
  /** A regression test regressed. */
  regressionFailed?: boolean;
  /** Difficulty of the task. */
  difficulty: number;
  /** Treat difficulty >= this as an escalation trigger on its own. Off by default
   *  (the start tier already consumes difficulty); set it for aggressive climbs. */
  highDifficultyTrigger?: number;
}

/**
 * Escalate ONLY on a concrete failure signal — never speculatively. This is the
 * verifier-triggered climb: a misjudged-easy task fails its cheap attempt and
 * auto-climbs, instead of always paying for the top tier.
 */
export function shouldEscalate(i: EscalationInput): boolean {
  if (i.ladderFailed || i.regressionFailed) {
    return true;
  }
  if (i.confidence !== undefined && i.confidence < i.tau) {
    return true;
  }
  if (i.highDifficultyTrigger !== undefined && i.difficulty >= i.highDifficultyTrigger) {
    return true;
  }
  return false;
}
