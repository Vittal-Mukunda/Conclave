import { describe, it, expect } from 'vitest';
import { CostPolicy, Candidate } from '../../src/cost/CostPolicy';

const free: Candidate = { kind: 'free' };
const paid: Candidate = { kind: 'paid' };
const open = { capReached: false };
const capped = { capReached: true };

describe('CostPolicy candidate gating', () => {
  it('free-only: free allowed, paid never', () => {
    const p = new CostPolicy('free-only');
    expect(p.allows(free, open)).toBe(true);
    expect(p.allows(paid, open)).toBe(false);
  });

  it('free-first: free always, paid as spillover while under cap', () => {
    const p = new CostPolicy('free-first');
    expect(p.allows(free, open)).toBe(true);
    expect(p.allows(paid, open)).toBe(true);
    expect(p.allows(paid, capped)).toBe(false); // hard cap blocks paid
  });

  it('best-quality: both allowed, paid still blocked at the hard cap', () => {
    const p = new CostPolicy('best-quality');
    expect(p.allows(paid, open)).toBe(true);
    expect(p.allows(paid, capped)).toBe(false);
    expect(p.allows(free, capped)).toBe(true);
  });

  it('filter keeps only permitted candidates', () => {
    const p = new CostPolicy('free-only');
    expect(p.filter([free, paid], open)).toEqual([free]);
  });
});
