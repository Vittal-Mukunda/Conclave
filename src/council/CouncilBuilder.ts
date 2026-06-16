import { Role } from '../router/types';
import {
  CouncilMember,
  CouncilResult,
  PROMPT_STRATEGIES,
  ScoredCandidate,
  TEMP_HIGH,
  TEMP_LOW,
} from './types';

// Forms a heterogeneous council from scored candidates (OR design §6). Picks the
// strongest model in each distinct FAMILY first (so the seats are diverse by
// construction), then fills remaining seats by competence, then DIVERSITY-PRUNES
// any redundant same-family member that isn't competitive. Prompt strategy and
// temperature are spread across seats. If <2 families are available it refuses to
// form an echo-chamber council and falls back to the single best author.

const DEFAULT_SIZE = 3;
/** A 2nd-of-family member is pruned if its LCB trails the top by more than this. */
const PRUNE_DELTA = 0.15;

export interface CouncilOptions {
  size?: number;
  /** Minimum LCB to be seatable. */
  floor?: number;
}

export class CouncilBuilder {
  build(role: Role, scored: ScoredCandidate[], opts: CouncilOptions = {}): CouncilResult {
    const size = Math.max(2, opts.size ?? DEFAULT_SIZE);
    const floor = opts.floor ?? -Infinity;
    const flags: string[] = [];

    const eligible = scored
      .filter((s) => s.lcb >= floor)
      .sort((a, b) => b.lcb - a.lcb);

    if (eligible.length === 0) {
      return { role, kind: 'divergent', members: [], synthesizer: undefined, homogeneous: true, flags: ['no eligible model for the council'] };
    }

    const synthesizer = eligible[0].candidate; // strongest model synthesizes
    const families = new Set(eligible.map((s) => s.family));

    // A council needs genuine lineage diversity; otherwise it's a vote among
    // siblings (echo chamber). Refuse and hand the stage to a single author.
    if (families.size < 2) {
      return {
        role,
        kind: 'divergent',
        members: [decorate(eligible[0], 0, 1)],
        synthesizer,
        homogeneous: true,
        flags: [`council needs >=2 model families; only "${eligible[0].family}" available — single-author fallback`],
      };
    }

    // 1) best per distinct family.
    const picked: ScoredCandidate[] = [];
    const usedFamily = new Set<string>();
    for (const s of eligible) {
      if (picked.length >= size) break;
      if (!usedFamily.has(s.family)) {
        picked.push(s);
        usedFamily.add(s.family);
      }
    }
    // 2) fill remaining seats by competence (allows a 2nd of a strong family).
    for (const s of eligible) {
      if (picked.length >= size) break;
      if (!picked.includes(s)) {
        picked.push(s);
      }
    }

    // 3) diversity-prune: drop a redundant same-family member that isn't close
    //    to the top (it won't raise oracle Pass@K). Always keep >=2 members and
    //    at least the first of every family.
    const topLcb = picked[0].lcb;
    const familySeen = new Set<string>();
    const kept: ScoredCandidate[] = [];
    for (const s of picked) {
      const firstOfFamily = !familySeen.has(s.family);
      familySeen.add(s.family);
      if (firstOfFamily || s.lcb >= topLcb - PRUNE_DELTA) {
        kept.push(s);
      } else {
        flags.push(`pruned redundant ${s.family} member (LCB ${s.lcb.toFixed(2)} << top ${topLcb.toFixed(2)})`);
      }
    }

    const members = kept.map((s, i) => decorate(s, i, kept.length));
    return { role, kind: 'divergent', members, synthesizer, homogeneous: false, flags };
  }
}

/** Assign a prompt strategy + a spread temperature to a seat. */
function decorate(s: ScoredCandidate, index: number, total: number): CouncilMember {
  const promptStrategy = PROMPT_STRATEGIES[index % PROMPT_STRATEGIES.length];
  const temperature =
    total <= 1 ? TEMP_LOW : Number((TEMP_LOW + (TEMP_HIGH - TEMP_LOW) * (index / (total - 1))).toFixed(2));
  return { ...s, promptStrategy, temperature };
}
