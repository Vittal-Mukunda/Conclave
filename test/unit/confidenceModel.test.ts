import { describe, it, expect } from 'vitest';
import { ConfidenceModel } from '../../src/verify/ConfidenceModel';
import { RungResult } from '../../src/verify/types';

const model = new ConfidenceModel();
const r = (kind: RungResult['kind'], status: RungResult['status'], reason?: string): RungResult => ({
  kind,
  status,
  durationMs: 1,
  reason,
});

describe('ConfidenceModel', () => {
  it('full ladder passing -> high confidence, no flags, passed', () => {
    const v = model.score([
      r('typecheck', 'pass'),
      r('build', 'pass'),
      r('test', 'pass'),
      r('coverage', 'pass'),
    ]);
    expect(v.passed).toBe(true);
    expect(v.flags).toEqual([]);
    expect(v.confidence).toBeGreaterThan(0.9);
  });

  it('VER-5: no test rung caps confidence LOW and flags', () => {
    const v = model.score([r('typecheck', 'pass'), r('build', 'pass')]);
    expect(v.confidence).toBeLessThanOrEqual(0.4);
    expect(v.flags.some((f) => /VER-5/.test(f))).toBe(true);
  });

  it('VER-10: tests pass but no coverage -> conservative cap + flag', () => {
    const v = model.score([r('typecheck', 'pass'), r('build', 'pass'), r('test', 'pass')]);
    expect(v.confidence).toBeLessThanOrEqual(0.85);
    expect(v.flags.some((f) => /VER-10/.test(f))).toBe(true);
    expect(v.passed).toBe(true);
  });

  it('a failing rung -> low confidence, not passed', () => {
    const v = model.score([r('typecheck', 'pass'), r('build', 'fail')]);
    expect(v.passed).toBe(false);
    expect(v.confidence).toBeLessThanOrEqual(0.2);
  });

  it('VER-2/4: a timeout -> partial, capped, not passed', () => {
    const v = model.score([r('typecheck', 'pass'), r('test', 'timeout')]);
    expect(v.passed).toBe(false);
    expect(v.confidence).toBeLessThanOrEqual(0.5);
    expect(v.flags.some((f) => /VER-2\/4/.test(f))).toBe(true);
  });

  it('VER-1: a flaky rung lowers confidence and is not "passed"', () => {
    const clean = model.score([r('typecheck', 'pass'), r('build', 'pass'), r('test', 'pass'), r('coverage', 'pass')]);
    const flaky = model.score([r('typecheck', 'pass'), r('build', 'pass'), r('test', 'flaky'), r('coverage', 'pass')]);
    expect(flaky.confidence).toBeLessThan(clean.confidence);
    expect(flaky.passed).toBe(false);
    expect(flaky.flags.some((f) => /VER-1/.test(f))).toBe(true);
  });

  it('VER-3: a service-skipped rung lowers confidence and flags', () => {
    const v = model.score([r('typecheck', 'pass'), r('test', 'pass'), r('coverage', 'skipped', 'needs network service')]);
    expect(v.flags.some((f) => /VER-3/.test(f))).toBe(true);
  });

  it('VER-9: env divergence flags and lowers confidence', () => {
    const base = model.score([r('typecheck', 'pass'), r('build', 'pass'), r('test', 'pass'), r('coverage', 'pass')]);
    const diff = model.score(
      [r('typecheck', 'pass'), r('build', 'pass'), r('test', 'pass'), r('coverage', 'pass')],
      { envDiff: true },
    );
    expect(diff.confidence).toBeLessThan(base.confidence);
    expect(diff.flags.some((f) => /VER-9/.test(f))).toBe(true);
  });
});
