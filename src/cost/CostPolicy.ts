import { ProviderKind } from '../providers/types';

// COST MODE decides which candidates the router may even consider:
//   free-only     default; $0; paid candidates are never eligible.
//   free-first    free always eligible; paid allowed as SPILLOVER, but only while
//                 the spend cap is not yet reached (a hard cap blocks all paid).
//   best-quality  free and paid both eligible; paid still blocked once the cap is
//                 reached (the HARD STOP in COST-3 is never overridden by a mode).
export type CostMode = 'free-only' | 'free-first' | 'best-quality';

export const COST_MODES: readonly CostMode[] = ['free-only', 'free-first', 'best-quality'];

export interface PolicyContext {
  /** True once running spend has hit the cap — no paid call may issue (COST-3). */
  capReached: boolean;
}

export interface Candidate {
  kind: ProviderKind;
}

/** Gates candidate eligibility by COST MODE + the hard spend cap. Pure. */
export class CostPolicy {
  constructor(public mode: CostMode) {}

  /** May this candidate be used under the current mode + cap state? */
  allows(candidate: Candidate, ctx: PolicyContext): boolean {
    if (candidate.kind === 'free') {
      return true;
    }
    // Paid candidate:
    if (this.mode === 'free-only') {
      return false;
    }
    // free-first and best-quality both permit paid — never past the hard cap.
    return !ctx.capReached;
  }

  /** Keep only the candidates the policy permits. */
  filter<T extends Candidate>(candidates: T[], ctx: PolicyContext): T[] {
    return candidates.filter((c) => this.allows(c, ctx));
  }
}
