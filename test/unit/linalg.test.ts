import { describe, it, expect } from 'vitest';
import { addOuter, dot, identity, matVec, quadFormInv, solve } from '../../src/learn/linalg';

describe('linalg', () => {
  it('identity is diagonal and scaled', () => {
    const I = identity(3, 2);
    expect(I).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]);
  });

  it('solve recovers x for A x = b', () => {
    const A = [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 5],
    ];
    const x = solve(A, [4, 9, 10]);
    expect(x[0]).toBeCloseTo(2);
    expect(x[1]).toBeCloseTo(3);
    expect(x[2]).toBeCloseTo(2);
  });

  it('solve handles a non-diagonal system (partial pivoting)', () => {
    const A = [
      [0, 2],
      [3, 1],
    ];
    const x = solve(A, [4, 5]); // 2y=4 -> y=2 ; 3x+y=5 -> x=1
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
  });

  it('addOuter accumulates c·x xᵀ in place', () => {
    const A = identity(2, 0);
    addOuter(A, [1, 2], 1);
    expect(A).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  it('quadFormInv on identity equals |x|²', () => {
    const I = identity(3, 1);
    expect(quadFormInv(I, [1, 2, 2])).toBeCloseTo(9);
  });

  it('matVec and dot', () => {
    expect(matVec([[1, 2], [3, 4]], [1, 1])).toEqual([3, 7]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('does not mutate inputs in solve', () => {
    const A = [
      [2, 1],
      [1, 2],
    ];
    const b = [3, 3];
    solve(A, b);
    expect(A).toEqual([
      [2, 1],
      [1, 2],
    ]);
    expect(b).toEqual([3, 3]);
  });
});
