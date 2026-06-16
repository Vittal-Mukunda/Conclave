import { describe, it, expect } from 'vitest';
import { Selector, DEFAULT_WEIGHTS } from '../../src/bestofn/Selector';
import { Solution } from '../../src/bestofn/types';

describe('Selector', () => {
  const sel = new Selector();

  it('picks the consensus winner', () => {
    const r = sel.select([
      { id: 'a', passed: [true, true, true] },
      { id: 'b', passed: [true, true, true] }, // agrees with a -> cluster 2
      { id: 'c', passed: [true, false, false] },
    ]);
    expect(['a', 'b']).toContain(r.winnerId);
  });

  it('breaks a consensus tie on type/critic/coverage signals', () => {
    const r = sel.select([
      { id: 'a', passed: [true, true], typeSignal: 0.2, criticVote: 0.2, coverage: 0.2 },
      { id: 'b', passed: [true, true], typeSignal: 1, criticVote: 1, coverage: 1 },
    ]);
    expect(r.winnerId).toBe('b');
  });

  it('flags a selector miss when oracle passes but the winner does not', () => {
    // 'good' passes the ladder but fails most tests; consensus favours the pair.
    const sols: Solution[] = [
      { id: 'x', passed: [true, true, true], ladderPass: false },
      { id: 'y', passed: [true, true, true], ladderPass: false },
      { id: 'good', passed: [false, false, false], ladderPass: true },
    ];
    const r = sel.select(sols);
    expect(r.oraclePass).toBe(true);
    expect(r.bestPass).toBe(false);
    expect(r.selectorMiss).toBe(true);
  });

  it('reports no selector miss when the winner passes the ladder', () => {
    const r = sel.select([
      { id: 'a', passed: [true, true, true], ladderPass: true },
      { id: 'b', passed: [true, true, true], ladderPass: true },
    ]);
    expect(r.bestPass).toBe(true);
    expect(r.selectorMiss).toBe(false);
  });

  it('empty input yields no winner', () => {
    const r = sel.select([]);
    expect(r.winnerId).toBeUndefined();
    expect(r.oraclePass).toBe(false);
  });

  it('weights sum to 1 by default', () => {
    const w = DEFAULT_WEIGHTS;
    expect(w.consensus + w.typeSignal + w.criticVote + w.coverage).toBeCloseTo(1);
  });
});
