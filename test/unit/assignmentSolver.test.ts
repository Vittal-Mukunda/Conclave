import { describe, it, expect } from 'vitest';
import { AssignmentSolver } from '../../src/council/AssignmentSolver';
import { AuthorResult, CouncilResult, StageRequest } from '../../src/council/types';
import { Role, RoutedCandidate, RouterModel } from '../../src/router/types';

function cand(modelId: string): RoutedCandidate {
  const model: RouterModel = {
    providerId: 'p',
    modelId,
    kind: 'free',
    capabilities: ['code', 'reasoning'],
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
  };
  return { model, tier: 'L2', role: 'implement', cost: 0 } as RoutedCandidate;
}

// llama / gemini / deepseek lineages for family diversity.
const LLAMA = cand('llama-70b');
const GEMINI = cand('gemini-2.0-flash');
const DEEPSEEK = cand('deepseek-r1');

describe('AssignmentSolver', () => {
  it('convergent stage assigns exactly ONE author — the highest LCB', () => {
    const lcb: Record<string, number> = { 'llama-70b': 0.6, 'gemini-2.0-flash': 0.9, 'deepseek-r1': 0.7 };
    const solver = new AssignmentSolver({ score: (_r, c) => lcb[c.model.modelId] });
    const [stage] = solver.assign([{ role: 'implement' }], [LLAMA, GEMINI, DEEPSEEK]) as AuthorResult[];
    expect(stage.kind).toBe('convergent');
    expect(stage.author?.model.modelId).toBe('gemini-2.0-flash');
  });

  it('divergent stage forms a multi-family council', () => {
    const solver = new AssignmentSolver({ score: () => 0.8 });
    const [stage] = solver.assign([{ role: 'review', size: 3 }], [LLAMA, GEMINI, DEEPSEEK]) as CouncilResult[];
    expect(stage.kind).toBe('divergent');
    expect(stage.homogeneous).toBe(false);
    expect(new Set(stage.members.map((m) => m.family)).size).toBe(3);
  });

  it('respects capacity — a model booked by one stage is unavailable to the next', () => {
    const lcb: Record<string, number> = { 'llama-70b': 0.6, 'gemini-2.0-flash': 0.9, 'deepseek-r1': 0.7 };
    const solver = new AssignmentSolver({
      score: (_r, c) => lcb[c.model.modelId],
      capacityOf: () => 1, // each model can take a single stage
    });
    const stages: StageRequest[] = [{ role: 'implement' }, { role: 'mechanical' }];
    const [first, second] = solver.assign(stages, [LLAMA, GEMINI, DEEPSEEK]) as AuthorResult[];
    expect(first.author?.model.modelId).toBe('gemini-2.0-flash'); // best
    expect(second.author?.model.modelId).toBe('deepseek-r1'); // gemini exhausted -> next best
  });

  it('reports no author when nothing clears the floor', () => {
    const solver = new AssignmentSolver({ score: () => 0.1 });
    const [stage] = solver.assign([{ role: 'implement' }], [LLAMA], { floor: 0.5 }) as AuthorResult[];
    expect(stage.author).toBeUndefined();
    expect(stage.flags[0]).toMatch(/no eligible author/);
  });

  it('routes stage kind by role', () => {
    const solver = new AssignmentSolver({ score: () => 0.8 });
    const roles: Role[] = ['plan', 'implement', 'review', 'mechanical'];
    const kinds = solver
      .assign(roles.map((role) => ({ role })), [LLAMA, GEMINI, DEEPSEEK])
      .map((s) => s.kind);
    expect(kinds).toEqual(['divergent', 'convergent', 'divergent', 'convergent']);
  });
});
