import { Role, RoutedCandidate } from '../router/types';
import { CouncilBuilder } from './CouncilBuilder';
import { familyOf } from './family';
import { ScoredCandidate, StageAssignment, StageRequest, stageKindFor } from './types';

// Greedy near-optimal stage assignment (OR design §6). Maximises conservative
// (LCB) competence subject to: per-model CAPACITY (live rate-limit/quota slots),
// a quality FLOOR, and SINGLE-AUTHOR for convergent stages. Stages are filled in
// the order given (callers put the scarce convergent author first); capacity is
// decremented as seats are taken so two stages can't double-book one model.
//
// Greedy is near-optimal for this matroid-ish structure; an exact ILP is the
// "optional small solver to compare" from the design and is not required to ship.

export interface AssignmentDeps {
  /** Conservative competence (LinUCB LCB) for a candidate in a role's context. */
  score: (role: Role, candidate: RoutedCandidate) => number;
  /** Remaining concurrent slots for a candidate (default unlimited). */
  capacityOf?: (candidate: RoutedCandidate) => number;
  builder?: CouncilBuilder;
}

export interface AssignOptions {
  /** Minimum LCB to be assignable. */
  floor?: number;
}

function keyOf(c: RoutedCandidate): string {
  return `${c.model.providerId}/${c.model.modelId}`;
}

export class AssignmentSolver {
  private readonly builder: CouncilBuilder;

  constructor(private readonly deps: AssignmentDeps) {
    this.builder = deps.builder ?? new CouncilBuilder();
  }

  assign(stages: StageRequest[], candidates: RoutedCandidate[], opts: AssignOptions = {}): StageAssignment[] {
    const floor = opts.floor ?? -Infinity;
    const remaining = new Map<string, number>();
    const capacityOf = this.deps.capacityOf ?? (() => Number.POSITIVE_INFINITY);
    for (const c of candidates) {
      const k = keyOf(c);
      if (!remaining.has(k)) {
        remaining.set(k, capacityOf(c));
      }
    }

    const out: StageAssignment[] = [];
    for (const stage of stages) {
      const scored: ScoredCandidate[] = candidates
        .filter((c) => (remaining.get(keyOf(c)) ?? 0) > 0)
        .map((c) => ({ candidate: c, family: familyOf(c.model), lcb: this.deps.score(stage.role, c) }))
        .filter((s) => s.lcb >= floor);

      if (stageKindFor(stage.role) === 'convergent') {
        out.push(this.assignAuthor(stage.role, scored, remaining));
      } else {
        out.push(this.assignCouncil(stage, scored, remaining));
      }
    }
    return out;
  }

  private assignAuthor(role: Role, scored: ScoredCandidate[], remaining: Map<string, number>): StageAssignment {
    if (scored.length === 0) {
      return { role, kind: 'convergent', author: undefined, flags: ['no eligible author under capacity/floor'] };
    }
    const best = scored.reduce((a, b) => (b.lcb > a.lcb ? b : a));
    this.consume(best.candidate, remaining);
    return { role, kind: 'convergent', author: best.candidate, lcb: best.lcb, flags: [] };
  }

  private assignCouncil(stage: StageRequest, scored: ScoredCandidate[], remaining: Map<string, number>): StageAssignment {
    const result = this.builder.build(stage.role, scored, { size: stage.size });
    for (const m of result.members) {
      this.consume(m.candidate, remaining);
    }
    return result;
  }

  private consume(c: RoutedCandidate, remaining: Map<string, number>): void {
    const k = keyOf(c);
    remaining.set(k, (remaining.get(k) ?? 1) - 1);
  }
}
