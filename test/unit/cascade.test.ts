import { describe, it, expect } from 'vitest';
import { Cascade, shouldEscalate, HIGH_DIFFICULTY } from '../../src/router/Cascade';
import { Estimate, Tier } from '../../src/router/types';

function est(d: number, level: Tier, taskType: Estimate['taskType'] = 'feature'): Estimate {
  return { d, level, taskType, reasons: [] };
}

describe('Cascade', () => {
  const c = new Cascade();

  it('mechanical role always starts at the cheapest tier', () => {
    expect(c.startTier('mechanical', est(0.9, 'L3'))).toBe('L0');
    expect(c.startTier('mechanical', est(0.05, 'L0'))).toBe('L0');
  });

  it('implement floors at L2 (strong coder) even for trivial difficulty', () => {
    expect(c.startTier('implement', est(0.05, 'L0'))).toBe('L2');
    expect(c.startTier('implement', est(0.5, 'L1'))).toBe('L2');
  });

  it('implement climbs to L3 only when difficulty is high', () => {
    expect(c.startTier('implement', est(HIGH_DIFFICULTY, 'L3'))).toBe('L3');
    expect(c.startTier('implement', est(0.74, 'L2'))).toBe('L2');
  });

  it('plan/review enter at the difficulty bucket', () => {
    expect(c.startTier('plan', est(0.1, 'L0'))).toBe('L0');
    expect(c.startTier('review', est(0.6, 'L2'))).toBe('L2');
  });

  it('next() climbs one tier and caps at L3', () => {
    expect(c.next('L0')).toBe('L1');
    expect(c.next('L2')).toBe('L3');
    expect(c.next('L3')).toBe('L3');
    expect(c.isTop('L3')).toBe(true);
    expect(c.isTop('L2')).toBe(false);
  });

  it('requires a code capability for authoring roles only', () => {
    expect(c.requiredCapability('implement')).toBe('code');
    expect(c.requiredCapability('mechanical')).toBe('code');
    expect(c.requiredCapability('plan')).toBeUndefined();
    expect(c.requiredCapability('review')).toBeUndefined();
  });
});

describe('shouldEscalate', () => {
  it('escalates on a ladder failure', () => {
    expect(shouldEscalate({ ladderFailed: true, tau: 0.7, difficulty: 0.1 })).toBe(true);
  });

  it('escalates on a regression', () => {
    expect(shouldEscalate({ regressionFailed: true, tau: 0.7, difficulty: 0.1 })).toBe(true);
  });

  it('escalates when confidence is below tau', () => {
    expect(shouldEscalate({ confidence: 0.5, tau: 0.7, difficulty: 0.1 })).toBe(true);
    expect(shouldEscalate({ confidence: 0.8, tau: 0.7, difficulty: 0.1 })).toBe(false);
  });

  it('does not escalate speculatively on a clean pass', () => {
    expect(shouldEscalate({ confidence: 0.9, tau: 0.7, difficulty: 0.95 })).toBe(false);
  });

  it('honours the optional high-difficulty trigger when set', () => {
    expect(shouldEscalate({ confidence: 0.9, tau: 0.7, difficulty: 0.9, highDifficultyTrigger: 0.75 })).toBe(true);
  });
});
