import { describe, it, expect } from 'vitest';
import { CouncilBuilder } from '../../src/council/CouncilBuilder';
import { ScoredCandidate } from '../../src/council/types';
import { RoutedCandidate, RouterModel } from '../../src/router/types';

function scored(modelId: string, family: string, lcb: number): ScoredCandidate {
  const model: RouterModel = {
    providerId: 'p',
    modelId,
    kind: 'free',
    capabilities: ['reasoning'],
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
  };
  const candidate: RoutedCandidate = { model, tier: 'L2', role: 'review', lcb, cost: 0 } as RoutedCandidate;
  return { candidate, family, lcb };
}

describe('CouncilBuilder', () => {
  const b = new CouncilBuilder();

  it('seats one model per distinct family with spread strategies + temperatures', () => {
    const r = b.build('review', [
      scored('a', 'llama', 0.9),
      scored('c', 'gemini', 0.8),
      scored('e', 'deepseek', 0.7),
    ]);
    expect(r.homogeneous).toBe(false);
    expect(r.members).toHaveLength(3);
    expect(r.members.map((m) => m.family)).toEqual(['llama', 'gemini', 'deepseek']);
    expect(r.members.map((m) => m.promptStrategy)).toEqual(['direct', 'chain-of-thought', 'test-first']);
    expect(r.members.map((m) => m.temperature)).toEqual([0.2, 0.6, 1.0]);
    expect(r.synthesizer?.model.modelId).toBe('a'); // strongest LCB synthesizes
  });

  it('refuses a single-family (echo-chamber) council — falls back to one author', () => {
    const r = b.build('review', [scored('a', 'llama', 0.9), scored('b', 'llama', 0.85)]);
    expect(r.homogeneous).toBe(true);
    expect(r.members).toHaveLength(1);
    expect(r.flags[0]).toMatch(/>=2 model families/);
  });

  it('keeps a competitive second-of-family member when filling seats', () => {
    const r = b.build('review', [
      scored('a', 'llama', 0.9),
      scored('c', 'gemini', 0.8),
      scored('a2', 'llama', 0.85), // within 0.15 of top -> kept
    ]);
    expect(r.members).toHaveLength(3);
  });

  it('diversity-prunes a redundant, non-competitive same-family member', () => {
    const r = b.build('review', [
      scored('a', 'llama', 0.9),
      scored('c', 'gemini', 0.8),
      scored('a2', 'llama', 0.5), // trails top by >0.15 -> pruned
    ]);
    expect(r.members).toHaveLength(2);
    expect(r.flags.some((f) => /pruned redundant llama/.test(f))).toBe(true);
  });

  it('applies the quality floor', () => {
    const r = b.build('review', [
      scored('a', 'llama', 0.9),
      scored('c', 'gemini', 0.55),
    ], { floor: 0.6 });
    expect(r.homogeneous).toBe(true); // only llama clears the floor
  });

  it('reports no eligible model when the pool is empty', () => {
    const r = b.build('review', []);
    expect(r.members).toHaveLength(0);
    expect(r.flags[0]).toMatch(/no eligible model/);
  });
});
