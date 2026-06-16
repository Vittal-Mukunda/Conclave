import { describe, it, expect } from 'vitest';
import { CascadeRouter, classifyTier } from '../../src/router/CascadeRouter';
import { DifficultyEstimator } from '../../src/router/DifficultyEstimator';
import { CostPolicy, CostMode } from '../../src/cost/CostPolicy';
import { RouterModel } from '../../src/router/types';

function m(
  modelId: string,
  kind: 'free' | 'paid',
  capabilities: string[],
): RouterModel {
  return { providerId: 'p', modelId, kind, capabilities, inputPricePerMTok: 0, outputPricePerMTok: 0 };
}

// Tier fixtures (modelId drives the small-model heuristic).
const TINY = m('tiny-8b-instant', 'free', ['code']); // L0
const MID = m('llama-70b', 'free', ['code']); // L1
const FREE_REASONER = m('deepseek-r1', 'free', ['code', 'reasoning']); // L2
const PAID_MINI = m('gpt-4.1-mini', 'paid', ['code']); // L2 (small paid)
const FRONTIER = m('claude-sonnet', 'paid', ['code', 'reasoning']); // L3
const PLAN_ONLY = m('reasoner-x', 'free', ['reasoning']); // L2, no 'code'

const COST: Record<string, number> = {
  'tiny-8b-instant': 1,
  'llama-70b': 2,
  'reasoner-x': 4,
  'deepseek-r1': 5,
  'gpt-4.1-mini': 8,
  'claude-sonnet': 30,
};

function router(pool: RouterModel[], mode: CostMode = 'free-first', capReached = false): CascadeRouter {
  return new CascadeRouter({
    pool: () => pool,
    priceOf: (x) => COST[x.modelId] ?? 99,
    policy: new CostPolicy(mode),
    policyCtx: () => ({ capReached }),
    estimator: new DifficultyEstimator(),
  });
}

describe('classifyTier', () => {
  it('maps free small -> L0, free 70b -> L1, free reasoner -> L2', () => {
    expect(classifyTier(TINY)).toBe('L0');
    expect(classifyTier(MID)).toBe('L1');
    expect(classifyTier(FREE_REASONER)).toBe('L2');
  });
  it('maps small paid -> L2, frontier paid -> L3', () => {
    expect(classifyTier(PAID_MINI)).toBe('L2');
    expect(classifyTier(FRONTIER)).toBe('L3');
  });
});

describe('CascadeRouter.route', () => {
  const POOL = [TINY, MID, FREE_REASONER, PAID_MINI, FRONTIER, PLAN_ONLY];

  it('implement enters at L2 and picks the cheapest at-or-above-floor candidate', () => {
    const r = router(POOL).route('implement', 'add a new feature');
    expect(r.startTier).toBe('L2');
    expect(r.chosen?.model.modelId).toBe('deepseek-r1'); // L2 free, cost 5 < paid mini 8
    expect(r.flags).toHaveLength(0);
  });

  it('excludes models without the required code capability for implement', () => {
    const r = router(POOL).route('implement', 'add a new feature');
    expect(r.candidates.map((c) => c.model.modelId)).not.toContain('reasoner-x');
  });

  it('plan keeps reasoning-only models (no hard code requirement)', () => {
    const r = router(POOL).route('plan', 'add a new feature');
    expect(r.candidates.map((c) => c.model.modelId)).toContain('reasoner-x');
  });

  it('free-only mode drops paid candidates entirely', () => {
    const r = router(POOL, 'free-only').route('implement', 'add a new feature');
    const ids = r.candidates.map((c) => c.model.modelId);
    expect(ids).not.toContain('gpt-4.1-mini');
    expect(ids).not.toContain('claude-sonnet');
    expect(r.chosen?.model.modelId).toBe('deepseek-r1');
  });

  it('flags a below-floor pick when the pool cannot reach the desired tier', () => {
    const r = router([TINY, MID], 'free-only').route('implement', 'add a new feature');
    expect(r.startTier).toBe('L2');
    expect(r.chosen?.model.modelId).toBe('llama-70b'); // best available = L1
    expect(r.flags[0]).toMatch(/below desired/);
  });

  it('reports no eligible model when the pool is empty under the policy', () => {
    const r = router([PAID_MINI, FRONTIER], 'free-only').route('implement', 'add a feature');
    expect(r.chosen).toBeUndefined();
    expect(r.flags[0]).toMatch(/no eligible model/);
  });

  it('hard spend cap blocks paid even in best-quality mode', () => {
    const r = router(POOL, 'best-quality', true).route('implement', 'add a feature');
    const ids = r.candidates.map((c) => c.model.modelId);
    expect(ids).not.toContain('claude-sonnet');
    expect(ids).not.toContain('gpt-4.1-mini');
  });
});

describe('CascadeRouter.escalate', () => {
  const POOL = [TINY, MID, FREE_REASONER, PAID_MINI, FRONTIER];

  it('climbs one tier on a verifier-triggered escalation', () => {
    const cr = router(POOL);
    const first = cr.route('implement', 'add a feature');
    expect(first.chosen?.tier).toBe('L2');
    const next = cr.escalate(first, 'add a feature');
    expect(next.startTier).toBe('L3');
    expect(next.chosen?.model.modelId).toBe('claude-sonnet');
  });

  it('cannot climb past L3 — returns the prior pick with a top-tier flag', () => {
    const cr = router(POOL);
    const first = cr.route('implement', 'add a feature');
    const second = cr.escalate(first, 'add a feature'); // -> L3
    const third = cr.escalate(second, 'add a feature'); // already top
    expect(third.chosen?.model.modelId).toBe('claude-sonnet');
    expect(third.flags.some((f) => /top tier/.test(f))).toBe(true);
  });
});
