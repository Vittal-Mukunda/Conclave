import {
  Actor,
  AgentTask,
  BudgetGate,
  Checkpointer,
  DEFAULT_LOOP_CONFIG,
  IterationRecord,
  LoopConfig,
  LoopResult,
  Planner,
  Verifier,
} from './types';

export interface AgentDeps {
  planner: Planner;
  actor: Actor;
  verifier: Verifier;
  checkpointer: Checkpointer;
  budget: BudgetGate;
}

/**
 * The control loop: plan -> checkpoint -> act -> verify -> decide, bounded and
 * safe. Pure orchestration over injected steps so every termination path is
 * deterministic and testable.
 *
 * Safety rails (the whole point):
 *   LOOP-1 oscillation       -> same plan repeats past the window -> handoff
 *   LOOP-2 makes it worse     -> verdict regresses -> rollback to the checkpoint
 *   LOOP-3 stuck              -> no confidence progress for N iters -> handoff
 *   LOOP-4 impossible         -> planner says so -> blocked + scoped suggestion
 *   LOOP-5 ambiguous          -> planner asks -> needs-clarification (one question)
 *   LOOP-6 partial success    -> iterations exhausted with progress -> partial
 *   LOOP-7 runaway cost       -> budget gate closes -> handoff before acting
 * A passing verdict is never *committed* unless it clears the accept threshold;
 * a regression is always rolled back, so the loop can't leave the tree worse.
 */
export class AgentLoop {
  private readonly cfg: LoopConfig;

  constructor(
    private readonly deps: AgentDeps,
    cfg: Partial<LoopConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_LOOP_CONFIG, ...cfg };
  }

  async run(task: AgentTask): Promise<LoopResult> {
    const iterations: IterationRecord[] = [];
    const seen = new Map<string, number>();
    let best = -1;
    let noProgress = 0;

    for (let n = 1; n <= this.cfg.maxIterations; n++) {
      // LOOP-7: stop before spending if the budget gate is closed.
      const gate = this.deps.budget.canContinue();
      if (!gate.allowed) {
        return this.finish('handoff', gate.reason ?? 'budget/spend cap reached (LOOP-7)', best, iterations);
      }

      const decision = await this.deps.planner.plan(task, iterations);
      if (decision.kind === 'ambiguous') {
        return { status: 'needs-clarification', reason: 'task is ambiguous (LOOP-5)', question: decision.question, bestConfidence: best < 0 ? 0 : best, iterations };
      }
      if (decision.kind === 'impossible') {
        return { status: 'blocked', reason: decision.reason, scopedSuggestion: decision.scopedSuggestion, bestConfidence: best < 0 ? 0 : best, iterations };
      }
      if (decision.kind === 'handoff') {
        return this.finish('handoff', decision.reason, best, iterations);
      }

      const { signature, description } = decision.step;

      // LOOP-1: the same plan coming back means we're going in circles.
      const repeats = (seen.get(signature) ?? 0) + 1;
      seen.set(signature, repeats);
      if (repeats > this.cfg.oscillationWindow + 1) {
        return this.finish('handoff', `oscillation detected — repeated plan "${description}" (LOOP-1)`, best, iterations);
      }

      const ref = await this.deps.checkpointer.checkpoint(`agent iter ${n}: ${description}`);
      const act = await this.deps.actor.apply(decision.step);
      const verdict = act.ok
        ? await this.deps.verifier.verify()
        : { passed: false, confidence: 0, flags: [act.reason ?? 'edit not applied'] };

      // Accept: a passing verdict that clears the bar is success.
      if (act.ok && verdict.passed && verdict.confidence >= this.cfg.acceptConfidence) {
        iterations.push({ n, signature, acted: true, confidence: verdict.confidence, passed: true, rolledBack: false });
        return { status: 'success', reason: 'verified', bestConfidence: verdict.confidence, iterations };
      }

      // LOOP-2: this iteration made things worse -> roll back to the checkpoint.
      let rolledBack = false;
      if (ref !== undefined && verdict.confidence < best) {
        await this.deps.checkpointer.rollback(ref);
        rolledBack = true;
      }

      const improved = verdict.confidence > best;
      if (improved) {
        best = verdict.confidence;
        noProgress = 0;
      } else {
        noProgress++;
      }

      iterations.push({
        n,
        signature,
        acted: act.ok,
        confidence: verdict.confidence,
        passed: verdict.passed,
        rolledBack,
        note: act.ok ? verdict.flags[0] : act.reason,
      });

      // LOOP-3: no progress for too long -> hand off rather than spin.
      if (noProgress >= this.cfg.noProgressLimit) {
        return this.finish('handoff', 'no progress across iterations — handing off (LOOP-3)', best, iterations);
      }
    }

    // Iterations exhausted (LOOP-6 partial vs clean handoff).
    return this.finish('exhausted', 'iteration cap reached', best, iterations);
  }

  /**
   * Terminal helper. When some real progress was made (best confidence > 0) we
   * report it honestly as `partial` (LOOP-6); otherwise it's a clean handoff.
   */
  private finish(
    kind: 'handoff' | 'exhausted',
    reason: string,
    best: number,
    iterations: IterationRecord[],
  ): LoopResult {
    if (best > 0) {
      return { status: 'partial', reason: `${reason} — partial progress kept (LOOP-6)`, bestConfidence: best, iterations };
    }
    return { status: 'handoff', reason, bestConfidence: 0, iterations };
  }
}
