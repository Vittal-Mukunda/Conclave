import { describe, it, expect } from 'vitest';
import { evaluateTrust } from '../../src/skills/trust';
import { ScanResult } from '../../src/skills/types';

const CLEAN: ScanResult = { risk: 'none', findings: [], clean: true };
const HIGH: ScanResult = {
  risk: 'high',
  findings: [{ id: 'dangerous-exec', severity: 'high', file: 'scripts/x.py', detail: 'x' }],
  clean: false,
};

describe('evaluateTrust', () => {
  it('first-party (user/project) skills are trusted to run scripts', () => {
    const d = evaluateTrust({ declaredTier: 'project', scan: CLEAN });
    expect(d.tier).toBe('project');
    expect(d.scriptsAllowed).toBe(true);
    expect(d.quarantine).toBe(false);
  });

  it('SKILL-2: high-risk scan quarantines, never runs', () => {
    const d = evaluateTrust({ declaredTier: 'project', scan: HIGH });
    expect(d.quarantine).toBe(true);
    expect(d.scriptsAllowed).toBe(false);
  });

  it('community + permissive license + scan-clean + popular → vetted (scripts on)', () => {
    const d = evaluateTrust({
      declaredTier: 'community',
      scan: CLEAN,
      license: 'Apache-2.0',
      stats: { installs: 5000, stars: 200 },
    });
    expect(d.tier).toBe('vetted');
    expect(d.scriptsAllowed).toBe(true);
  });

  it('SKILL-9: popular but unlicensed stays community, scripts OFF', () => {
    const d = evaluateTrust({
      declaredTier: 'community',
      scan: CLEAN,
      stats: { installs: 100000, stars: 9999 },
    });
    expect(d.tier).toBe('community');
    expect(d.scriptsAllowed).toBe(false);
    expect(d.reasons.some((r) => /popularity does NOT grant trust/i.test(r))).toBe(true);
  });

  it('community + license but NOT popular → community, scripts off', () => {
    const d = evaluateTrust({ declaredTier: 'community', scan: CLEAN, license: 'MIT' });
    expect(d.tier).toBe('community');
    expect(d.scriptsAllowed).toBe(false);
  });

  it('operator-vetted source is trusted', () => {
    const d = evaluateTrust({ declaredTier: 'community', scan: CLEAN, operatorVetted: true });
    expect(d.tier).toBe('vetted');
    expect(d.scriptsAllowed).toBe(true);
  });
});
