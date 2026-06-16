import { describe, it, expect } from 'vitest';
import { SlidingWindowLimiter } from '../../src/scheduler/SlidingWindowLimiter';

describe('SlidingWindowLimiter (never exceeds the limit in any window)', () => {
  it('admits up to the limit then blocks until the window slides', () => {
    const l = new SlidingWindowLimiter(3, 1000);
    expect(l.canAccept(0, 1)).toBe(true);
    l.record(0, 1);
    l.record(0, 1);
    l.record(0, 1);
    expect(l.canAccept(0, 1)).toBe(false); // 3 used
    expect(l.canAccept(999, 1)).toBe(false); // still inside the window
    expect(l.canAccept(1000, 1)).toBe(true); // first entry expired
  });

  it('reports time until capacity frees', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    l.record(100, 1);
    l.record(200, 1);
    expect(l.timeUntilAvailable(200, 1)).toBe(900); // oldest (t=100) frees at 1100
  });

  it('handles token amounts, not just counts', () => {
    const l = new SlidingWindowLimiter(1000, 1000);
    l.record(0, 800);
    expect(l.canAccept(0, 300)).toBe(false);
    expect(l.canAccept(0, 200)).toBe(true);
  });

  it('reports an amount larger than the whole limit as never-fitting (windowMs)', () => {
    const l = new SlidingWindowLimiter(100, 1000);
    expect(l.timeUntilAvailable(0, 500)).toBe(1000);
  });

  it('adjustLast reconciles an estimate to actual usage', () => {
    const l = new SlidingWindowLimiter(100, 1000);
    l.record(0, 50);
    l.adjustLast(20); // actual was 70
    expect(l.used(0)).toBe(70);
  });

  it('never exceeds the limit under a randomised admit sequence', () => {
    const limit = 5;
    const l = new SlidingWindowLimiter(limit, 1000);
    let t = 0;
    for (let i = 0; i < 500; i++) {
      t += Math.floor(Math.random() * 300);
      if (l.canAccept(t, 1)) {
        l.record(t, 1);
      }
      expect(l.used(t)).toBeLessThanOrEqual(limit);
    }
  });
});
