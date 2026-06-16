import { describe, it, expect } from 'vitest';
import { LinUCB } from '../../src/learn/LinUCB';

const X = [1, 0]; // a fixed context direction

describe('LinUCB', () => {
  it('an unseen arm is pure optimism: mean 0, width = alpha (lambda=1)', () => {
    const b = new LinUCB({ dim: 2, alpha: 1, lambda: 1 });
    const s = b.score('m', X);
    expect(s.mean).toBeCloseTo(0);
    expect(s.width).toBeCloseTo(1);
    expect(s.ucb).toBeCloseTo(1);
  });

  it('warm-start biases the predicted mean toward the prior', () => {
    const b = new LinUCB({ dim: 2 });
    b.warmStart('m', 0.8); // A=I+e0e0ᵀ, b=0.8·e0 -> theta0 = 0.8/2 = 0.4
    expect(b.score('m', X).mean).toBeCloseTo(0.4);
  });

  it('warm-start never overwrites learned data', () => {
    const b = new LinUCB({ dim: 2 });
    b.update('m', X, 1, 5);
    const before = b.score('m', X).mean;
    b.warmStart('m', 0.0);
    expect(b.score('m', X).mean).toBeCloseTo(before);
  });

  it('a positive reward raises the mean and shrinks the width', () => {
    const b = new LinUCB({ dim: 2 });
    const before = b.score('m', X);
    b.update('m', X, 1, 10);
    const after = b.score('m', X);
    expect(after.mean).toBeGreaterThan(before.mean);
    expect(after.width).toBeLessThan(before.width);
  });

  it('the selector favours the arm with stronger evidence', () => {
    const b = new LinUCB({ dim: 2 });
    b.update('good', X, 1, 8);
    b.update('bad', X, 0, 8);
    expect(b.score('good', X).ucb).toBeGreaterThan(b.score('bad', X).ucb);
  });

  it('forget decays accumulated evidence toward the prior', () => {
    const b = new LinUCB({ dim: 2 });
    b.update('m', X, 1, 10);
    const hot = b.score('m', X).mean;
    b.forget('m', 0.5);
    expect(b.score('m', X).mean).toBeLessThan(hot);
  });

  it('export/import round-trips an arm', () => {
    const b = new LinUCB({ dim: 2 });
    b.update('m', X, 1, 4);
    const snap = b.export('m')!;
    const b2 = new LinUCB({ dim: 2 });
    b2.import('m', snap);
    expect(b2.score('m', X).mean).toBeCloseTo(b.score('m', X).mean);
    expect(b2.has('m')).toBe(true);
  });
});
