import { describe, it, expect } from 'vitest';
import { AgentLoop, AgentDeps } from '../../src/agent/AgentLoop';
import {
  ActResult,
  AgentTask,
  PlanDecision,
  VerifyOutcome,
} from '../../src/agent/types';

// Fakes: each step is scripted by a queue (falls back to the last value).
function queued<T>(items: T[], fallback: T): () => T {
  return () => (items.length > 1 ? items.shift()! : (items[0] ?? fallback));
}

interface Harness {
  deps: AgentDeps;
  checkpoints: string[];
  rollbacks: string[];
  acts: number;
}

function harness(opts: {
  plans?: PlanDecision[];
  verdicts?: VerifyOutcome[];
  act?: ActResult;
  budgetAllowed?: boolean | boolean[];
  noCheckpoint?: boolean;
}): Harness {
  const checkpoints: string[] = [];
  const rollbacks: string[] = [];
  let acts = 0;
  const nextPlan = queued(opts.plans ?? [{ kind: 'plan', step: { signature: 's1', description: 'edit X' } }], {
    kind: 'plan',
    step: { signature: 's1', description: 'edit X' },
  });
  const nextVerdict = queued(opts.verdicts ?? [{ passed: false, confidence: 0.3, flags: [] }], { passed: false, confidence: 0.3, flags: [] });
  const budgetQueue = Array.isArray(opts.budgetAllowed) ? [...opts.budgetAllowed] : undefined;

  return {
    checkpoints,
    rollbacks,
    get acts() {
      return acts;
    },
    deps: {
      planner: { plan: () => nextPlan() },
      actor: {
        apply: () => {
          acts++;
          return opts.act ?? { ok: true };
        },
      },
      verifier: { verify: () => nextVerdict() },
      checkpointer: {
        checkpoint: (label) => {
          if (opts.noCheckpoint) return undefined;
          const ref = `cp${checkpoints.length + 1}`;
          checkpoints.push(label);
          return ref;
        },
        rollback: (ref) => {
          rollbacks.push(ref);
        },
      },
      budget: {
        canContinue: () => {
          const allowed = budgetQueue ? budgetQueue.shift() ?? true : opts.budgetAllowed ?? true;
          return allowed ? { allowed: true } : { allowed: false, reason: 'cap reached' };
        },
      },
    },
  };
}

const task: AgentTask = { goal: 'do the thing' };

describe('AgentLoop', () => {
  it('succeeds when a verdict clears the accept threshold', async () => {
    const h = harness({ verdicts: [{ passed: true, confidence: 0.9, flags: [] }] });
    const r = await new AgentLoop(h.deps).run(task);
    expect(r.status).toBe('success');
    expect(r.bestConfidence).toBe(0.9);
    expect(h.checkpoints).toHaveLength(1); // checkpointed before acting
  });

  it('UX-2: a cancelled signal -> clean handoff before acting', async () => {
    const h = harness({ verdicts: [{ passed: true, confidence: 0.9, flags: [] }] });
    const r = await new AgentLoop({ ...h.deps, signal: { isCancelled: () => true } }).run(task);
    expect(r.status).toBe('handoff');
    expect(r.reason).toMatch(/cancelled/);
    expect(h.acts).toBe(0); // never acted
  });

  it('LOOP-5: ambiguous plan -> needs-clarification with one question', async () => {
    const h = harness({ plans: [{ kind: 'ambiguous', question: 'Which file?' }] });
    const r = await new AgentLoop(h.deps).run(task);
    expect(r.status).toBe('needs-clarification');
    expect(r.question).toBe('Which file?');
    expect(h.acts).toBe(0); // never acted
  });

  it('LOOP-4: impossible plan -> blocked with scoped suggestion', async () => {
    const h = harness({ plans: [{ kind: 'impossible', reason: 'out of scope', scopedSuggestion: 'do just A' }] });
    const r = await new AgentLoop(h.deps).run(task);
    expect(r.status).toBe('blocked');
    expect(r.scopedSuggestion).toBe('do just A');
  });

  it('LOOP-7: closed budget gate -> handoff before acting', async () => {
    const h = harness({ budgetAllowed: false });
    const r = await new AgentLoop(h.deps).run(task);
    expect(r.status).toBe('handoff');
    expect(r.reason).toMatch(/cap/);
    expect(h.acts).toBe(0);
  });

  it('LOOP-1: repeated identical plan -> oscillation handoff', async () => {
    // Every plan has the same signature; verdicts never pass.
    const h = harness({
      plans: [{ kind: 'plan', step: { signature: 'same', description: 'edit X' } }],
      verdicts: [{ passed: false, confidence: 0.1, flags: [] }],
    });
    const r = await new AgentLoop(h.deps, { oscillationWindow: 1, noProgressLimit: 99 }).run(task);
    expect(r.status).toMatch(/handoff|partial/);
    expect(r.reason).toMatch(/oscillation|LOOP-1/i);
  });

  it('LOOP-2: a regression rolls back to the checkpoint', async () => {
    // iter1 confidence 0.5 (progress, best=0.5); iter2 confidence 0.2 (regression -> rollback).
    const h = harness({
      plans: [
        { kind: 'plan', step: { signature: 'a', description: 'A' } },
        { kind: 'plan', step: { signature: 'b', description: 'B' } },
      ],
      verdicts: [
        { passed: false, confidence: 0.5, flags: [] },
        { passed: false, confidence: 0.2, flags: [] },
      ],
    });
    const r = await new AgentLoop(h.deps, { noProgressLimit: 1, oscillationWindow: 5 }).run(task);
    expect(h.rollbacks.length).toBeGreaterThanOrEqual(1); // regressed iter rolled back
    expect(r.bestConfidence).toBe(0.5);
  });

  it('LOOP-3: no progress for the limit -> handoff (or partial if any progress)', async () => {
    const h = harness({
      plans: [
        { kind: 'plan', step: { signature: 'a', description: 'A' } },
        { kind: 'plan', step: { signature: 'b', description: 'B' } },
        { kind: 'plan', step: { signature: 'c', description: 'C' } },
      ],
      verdicts: [{ passed: false, confidence: 0, flags: [] }],
    });
    const r = await new AgentLoop(h.deps, { noProgressLimit: 2, oscillationWindow: 5 }).run(task);
    expect(r.status).toBe('handoff');
    expect(r.reason).toMatch(/no progress|LOOP-3/i);
  });

  it('LOOP-6: progress but never accepted -> partial', async () => {
    const h = harness({
      plans: [
        { kind: 'plan', step: { signature: 'a', description: 'A' } },
        { kind: 'plan', step: { signature: 'b', description: 'B' } },
      ],
      verdicts: [
        { passed: false, confidence: 0.4, flags: [] },
        { passed: false, confidence: 0.6, flags: [] },
      ],
    });
    const r = await new AgentLoop(h.deps, { maxIterations: 2, acceptConfidence: 0.9, noProgressLimit: 9, oscillationWindow: 9 }).run(task);
    expect(r.status).toBe('partial');
    expect(r.bestConfidence).toBe(0.6);
  });

  it('a failed edit is verified as failure, not acted-as-pass', async () => {
    const h = harness({ act: { ok: false, reason: 'drift (EDIT-1)' }, plans: [{ kind: 'plan', step: { signature: 'a', description: 'A' } }] });
    const r = await new AgentLoop(h.deps, { noProgressLimit: 1, oscillationWindow: 9 }).run(task);
    expect(r.iterations[0].acted).toBe(false);
    expect(r.iterations[0].passed).toBe(false);
  });
});
