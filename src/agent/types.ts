// Phase 10 — agent loop. Pure control types. The loop is a state machine over
// injected steps (planner / actor / verifier / checkpointer / budget gate) so
// it has zero vscode/LLM dependency and every LOOP-* path is unit-testable with
// fakes. The host wires the steps to Phase 7 (localize), 8 (edit+checkpoint),
// 9 (verify) and 5 (budget).

export interface AgentTask {
  goal: string;
  /** True once the user has answered a clarifying question (LOOP-5). */
  clarified?: boolean;
}

export interface PlanStep {
  /** Stable identity used to detect oscillation (LOOP-1): same plan twice = looping. */
  signature: string;
  description: string;
}

/** What the planner decides to do this turn. */
export type PlanDecision =
  | { kind: 'plan'; step: PlanStep }
  | { kind: 'ambiguous'; question: string } // LOOP-5: ask ONE question before planning
  | { kind: 'impossible'; reason: string; scopedSuggestion?: string } // LOOP-4
  | { kind: 'handoff'; reason: string }; // give up cleanly (e.g. capability missing)

export interface ActResult {
  /** The edit was applied. False = blocked/drift (Phase 8 EditResult failure). */
  ok: boolean;
  reason?: string;
}

export interface VerifyOutcome {
  passed: boolean;
  confidence: number;
  flags: string[];
}

export interface BudgetVerdict {
  allowed: boolean;
  reason?: string;
}

// --- injected step interfaces ---

export interface Planner {
  plan(task: AgentTask, history: IterationRecord[]): Promise<PlanDecision> | PlanDecision;
}
export interface Actor {
  apply(step: PlanStep): Promise<ActResult> | ActResult;
}
export interface Verifier {
  verify(): Promise<VerifyOutcome> | VerifyOutcome;
}
export interface Checkpointer {
  /** Snapshot before an edit (EDIT-3). Undefined when no repo. */
  checkpoint(label: string): Promise<string | undefined> | (string | undefined);
  /** Restore a snapshot (EDIT-7 / LOOP-2 auto-rollback). */
  rollback(ref: string): Promise<void> | void;
}
export interface BudgetGate {
  canContinue(): BudgetVerdict;
}

export interface IterationRecord {
  n: number;
  signature: string;
  acted: boolean;
  confidence: number;
  passed: boolean;
  rolledBack: boolean;
  note?: string;
}

export type LoopStatus =
  | 'success'
  | 'needs-clarification' // LOOP-5
  | 'blocked' // LOOP-4 (impossible / out of scope)
  | 'handoff' // LOOP-1/3/7 (oscillation / stuck / budget) or capability gap
  | 'partial'; // LOOP-6 (some progress, not enough)

export interface LoopResult {
  status: LoopStatus;
  reason: string;
  question?: string; // needs-clarification
  scopedSuggestion?: string; // blocked
  bestConfidence: number;
  iterations: IterationRecord[];
}

export interface LoopConfig {
  /** Hard iteration cap (LOOP-1/3) — the loop can never run away. */
  maxIterations: number;
  /** Confidence at which a passing verdict is accepted as success. */
  acceptConfidence: number;
  /** Iterations without confidence improvement before a stuck handoff (LOOP-3). */
  noProgressLimit: number;
  /** Times the same plan signature may repeat before an oscillation handoff (LOOP-1). */
  oscillationWindow: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterations: 6,
  acceptConfidence: 0.7,
  noProgressLimit: 2,
  oscillationWindow: 1,
};
