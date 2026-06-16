// Phase 14 — Best-of-N + strong verifier-selector (the #1 quality lever, OR
// design §7). All vscode/LLM-free so the sampling/stopping/selection math is
// deterministically unit-testable; the host wires the actual code sampler (an
// LLM author) once codegen lands. Until then the engine runs over injected
// solutions exactly as the agent/council engines do.

/** One candidate solution and the signals the selector ranks it by. */
export interface Solution {
  id: string;
  /** Test pass/fail vector, aligned to a shared ordered test list (CodeT input). */
  passed: boolean[];
  /** LSP / type-check clean signal in [0,1]. */
  typeSignal?: number;
  /** Mean vote from diverse critics in [0,1]. */
  criticVote?: number;
  /** Changed-line coverage in [0,1] (uncovered changes lower confidence). */
  coverage?: number;
  /** Passes the full verification ladder — triggers the CODING stop. */
  ladderPass?: boolean;
}

/** A Weitzman/Pandora "box": a sampling source with a reservation cap. */
export interface SampleSource {
  id: string;
  /** Reservation value (cap) — expected competence in [0,1]; opened in this order. */
  reservation: number;
  /** Draw one solution from this source (an LLM author in the host). */
  draw: () => Promise<Solution> | Solution;
}

/** Fraction of tests a solution passes — the cheap realized reward Pandora compares. */
export function passFraction(s: Solution): number {
  if (s.passed.length === 0) {
    return 0;
  }
  return s.passed.filter(Boolean).length / s.passed.length;
}
