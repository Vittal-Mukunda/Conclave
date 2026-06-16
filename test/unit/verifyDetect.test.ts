import { describe, it, expect } from 'vitest';
import { buildRungs } from '../../src/verify/detect';

describe('buildRungs', () => {
  it('builds the ladder in weakest-to-strongest order', () => {
    const rungs = buildRungs({
      scripts: { typecheck: 'tsc', build: 'esbuild', test: 'vitest', coverage: 'vitest --coverage' },
    });
    expect(rungs.map((r) => r.kind)).toEqual(['typecheck', 'build', 'test', 'coverage']);
  });

  it('VER-6: a remembered test command overrides script detection', () => {
    const rungs = buildRungs({ scripts: { test: 'vitest' }, rememberedTest: 'make check' });
    expect(rungs.find((r) => r.kind === 'test')?.command).toBe('make check');
  });

  it('falls back to test:unit when there is no test script', () => {
    const rungs = buildRungs({ scripts: { 'test:unit': 'vitest run' } });
    expect(rungs.find((r) => r.kind === 'test')?.command).toBe('npm run test:unit');
  });

  it('VER-5: no test command -> no test rung (model flags LOW later)', () => {
    const rungs = buildRungs({ scripts: { typecheck: 'tsc' } });
    expect(rungs.some((r) => r.kind === 'test')).toBe(false);
  });

  it('test rung enables flake detection', () => {
    const rungs = buildRungs({ rememberedTest: 'npm test' });
    expect(rungs.find((r) => r.kind === 'test')?.detectFlake).toBe(true);
  });

  it('empty input yields no rungs', () => {
    expect(buildRungs({})).toEqual([]);
  });
});
