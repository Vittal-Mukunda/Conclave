import { describe, it, expect, vi } from 'vitest';
import { CompetenceLearner, armId } from '../../src/learn/CompetenceLearner';
import { LearnContext } from '../../src/learn/types';
import { RoutedCandidate, RouterModel } from '../../src/router/types';

function cand(modelId: string, cost: number): RoutedCandidate {
  const model: RouterModel = {
    providerId: 'p',
    modelId,
    kind: 'free',
    capabilities: ['code'],
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
  };
  return { model, tier: 'L2', role: 'implement', cost };
}

const CTX: LearnContext = { taskType: 'feature', difficulty: 0.5, role: 'implement' };

describe('CompetenceLearner', () => {
  it('warm-starts unseen arms and breaks ties on cost (cheaper wins)', () => {
    const l = new CompetenceLearner();
    const cheap = cand('cheap', 0);
    const pricey = cand('pricey', 5);
    expect(l.select(CTX, [pricey, cheap]).chosen).toBe(cheap);
  });

  it('learns: a model that passes the ladder beats one that fails', () => {
    const l = new CompetenceLearner();
    const a = cand('a', 0);
    const b = cand('b', 0);
    // Seed both arms, then split outcomes.
    l.select(CTX, [a, b]);
    for (let i = 0; i < 5; i++) {
      l.recordLadder(CTX, a, false);
      l.recordLadder(CTX, b, true);
    }
    expect(l.select(CTX, [a, b]).chosen).toBe(b);
  });

  it('warm-starts from benchmark priors', () => {
    const priors = (arm: string) => (arm === 'p/strong' ? 0.95 : undefined);
    const l = new CompetenceLearner({ priors });
    const strong = cand('strong', 0);
    const weak = cand('weak', 0);
    expect(l.select(CTX, [weak, strong]).chosen).toBe(strong);
  });

  it('human ACCEPT raises an arm more than a single ladder pass and writes a lesson', () => {
    const lesson = vi.fn();
    const l = new CompetenceLearner({ lesson });
    const a = cand('a', 0);
    const beforeScore = l.select(CTX, [a]).scores[0].mean;
    l.recordHuman(CTX, a, true);
    const afterScore = l.select(CTX, [a]).scores[0].mean;
    expect(afterScore).toBeGreaterThan(beforeScore);
    expect(lesson).toHaveBeenCalledWith(expect.stringContaining('ACCEPT p/a'));
  });

  it('human REJECT lowers the arm and is logged', () => {
    const lesson = vi.fn();
    const l = new CompetenceLearner({ lesson });
    const a = cand('a', 0);
    const before = l.select(CTX, [a]).scores[0].mean;
    l.recordHuman(CTX, a, false);
    const after = l.select(CTX, [a]).scores[0].mean;
    expect(after).toBeLessThan(before);
    expect(lesson).toHaveBeenCalledWith(expect.stringContaining('REJECT'));
  });

  it('persists every update via onUpdate', () => {
    const onUpdate = vi.fn();
    const l = new CompetenceLearner({ onUpdate });
    const a = cand('a', 0);
    l.recordLadder(CTX, a, true);
    expect(onUpdate).toHaveBeenCalledWith('p/a', expect.objectContaining({ n: 1 }), undefined);
  });

  it('tracks consumption (rho) per arm', () => {
    const l = new CompetenceLearner();
    const a = cand('a', 0);
    expect(l.expectedConsumption(a, 1000)).toBe(1000); // fallback
    l.observeConsumption(a, 2000);
    expect(l.expectedConsumption(a, 1000)).toBeCloseTo(2000);
  });

  it('restore rehydrates a persisted arm', () => {
    const src = new CompetenceLearner();
    const a = cand('a', 0);
    src.recordLadder(CTX, a, true);
    let captured: { arm: string; state: any } | undefined;
    new CompetenceLearner({
      onUpdate: (arm, state) => (captured = { arm, state }),
    }).recordLadder(CTX, a, true);

    const l = new CompetenceLearner();
    l.restore(captured!.arm, captured!.state, 1234);
    expect(l.expectedConsumption(a, 0)).toBe(1234);
  });

  it('armId is provider/model', () => {
    expect(armId(cand('m', 0))).toBe('p/m');
  });
});
