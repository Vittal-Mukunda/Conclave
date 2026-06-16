import { Role, RoutedCandidate } from '../router/types';

// Phase 13 — assignment solver + heterogeneous council. All vscode/LLM-free so
// the assignment math is deterministically unit-testable; the host wires the
// competence read (LinUCB LCB) and live capacity.
//
// Two stage kinds, from the build-plan hierarchy:
//   CONVERGENT (implement/mechanical) — single authorship. Exactly ONE strong
//     coder writes the code; a committee never co-authors a convergent edit.
//   DIVERGENT (plan/review) — a heterogeneous COUNCIL: >=2 base FAMILIES (distinct
//     lineages) + prompt-strategy + temperature diversity, diversity-pruned, then
//     synthesized by ONE strong model. NEVER a homogeneous consensus vote.

export type StageKind = 'convergent' | 'divergent';

export function stageKindFor(role: Role): StageKind {
  return role === 'implement' || role === 'mechanical' ? 'convergent' : 'divergent';
}

/** Prompt strategies spread across council members for genuine diversity. */
export const PROMPT_STRATEGIES = ['direct', 'chain-of-thought', 'test-first'] as const;
export type PromptStrategy = (typeof PROMPT_STRATEGIES)[number];

/** Temperature band council members are spread across. */
export const TEMP_LOW = 0.2;
export const TEMP_HIGH = 1.0;

export interface ScoredCandidate {
  candidate: RoutedCandidate;
  /** Model lineage (llama / gemini / deepseek / ...), for family diversity. */
  family: string;
  /** Conservative competence (LinUCB LCB) the solver maximises. */
  lcb: number;
}

export interface CouncilMember extends ScoredCandidate {
  promptStrategy: PromptStrategy;
  temperature: number;
}

export interface CouncilResult {
  role: Role;
  kind: 'divergent';
  members: CouncilMember[];
  /** One strong model that synthesizes the council's outputs (highest LCB). */
  synthesizer?: RoutedCandidate;
  /** True when a real >=2-family council could not be formed (single-author fallback). */
  homogeneous: boolean;
  flags: string[];
}

export interface AuthorResult {
  role: Role;
  kind: 'convergent';
  /** The single author for a convergent stage (or undefined if none eligible). */
  author?: RoutedCandidate;
  lcb?: number;
  flags: string[];
}

export type StageAssignment = CouncilResult | AuthorResult;

export interface StageRequest {
  role: Role;
  /** Desired council size for divergent stages (ignored for convergent). */
  size?: number;
}
