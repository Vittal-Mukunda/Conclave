import { describe, it, expect } from 'vitest';
import { codeTConsensus } from '../../src/bestofn/CodeT';
import { Solution } from '../../src/bestofn/types';

function sol(id: string, passed: boolean[]): Solution {
  return { id, passed };
}

describe('codeTConsensus', () => {
  it('rewards agreement: a cluster passing the same tests outscores a loner', () => {
    const r = codeTConsensus([
      sol('a', [true, true, true]), // cluster with b
      sol('b', [true, true, true]),
      sol('c', [true, true, false]), // loner, fewer tests
    ]);
    expect(r[0].id === 'a' || r[0].id === 'b').toBe(true);
    const a = r.find((x) => x.id === 'a')!;
    expect(a.clusterSize).toBe(2);
    expect(a.testsPassed).toBe(3);
    expect(a.score).toBe(2 * 9); // |sols|·|tests|²
  });

  it('is quadratic in tests passed', () => {
    const r = codeTConsensus([
      sol('few', [true, false, false, false]), // 1 test
      sol('many', [true, true, true, false]), // 3 tests
    ]);
    const few = r.find((x) => x.id === 'few')!;
    const many = r.find((x) => x.id === 'many')!;
    expect(few.score).toBe(1); // 1·1²
    expect(many.score).toBe(9); // 1·3²
    expect(r[0].id).toBe('many');
  });

  it('a solution passing no tests scores zero', () => {
    const r = codeTConsensus([sol('z', [false, false])]);
    expect(r[0].score).toBe(0);
  });

  it('clusters by exact pass signature, not count', () => {
    const r = codeTConsensus([
      sol('a', [true, false]), // signature 10
      sol('b', [false, true]), // signature 01 — different cluster, same count
    ]);
    expect(r.every((x) => x.clusterSize === 1)).toBe(true);
  });
});
