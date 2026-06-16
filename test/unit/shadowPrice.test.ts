import { describe, it, expect } from 'vitest';
import { ShadowPriceEngine } from '../../src/cost/ShadowPriceEngine';
import { CostCalculator } from '../../src/cost/CostCalculator';
import { PricedCost } from '../../src/cost/PricedCost';
import { ProviderRegistry } from '../../src/providers/registry';

describe('ShadowPriceEngine', () => {
  it('starts every resource at price 0', () => {
    const s = new ShadowPriceEngine();
    expect(s.priceOf('groq:rpm')).toBe(0);
  });

  it('raises price when consumption exceeds budget (subgradient ascent)', () => {
    const s = new ShadowPriceEngine({ eta: 0.1 });
    const p = s.update('groq:rpm', 30, 20); // over by 10 -> +1.0
    expect(p).toBeCloseTo(1.0);
    expect(s.priceOf('groq:rpm')).toBeCloseTo(1.0);
  });

  it('decays toward 0 when under budget, projected to >= 0', () => {
    const s = new ShadowPriceEngine({ eta: 0.1 });
    s.set('r', 0.5);
    s.update('r', 0, 10); // under -> 0.5 + 0.1*(-10) = -0.5 -> clamped 0
    expect(s.priceOf('r')).toBe(0);
  });

  it('snapshots non-zero prices', () => {
    const s = new ShadowPriceEngine();
    s.update('a', 10, 0);
    expect(s.snapshot().a).toBeGreaterThan(0);
  });
});

describe('PricedCost', () => {
  const registry = new ProviderRegistry();
  const cost = new CostCalculator(registry);

  it('paid model => real dollar cost, free => $0 dollar term', () => {
    const shadow = new ShadowPriceEngine();
    const priced = new PricedCost(cost, shadow);
    const paid = priced.price({ providerId: 'openai', modelId: 'gpt-4.1', tokensIn: 1_000_000, tokensOut: 0 });
    expect(paid.dollarCost).toBeCloseTo(2);
    const free = priced.price({ providerId: 'groq', modelId: 'llama-3.3-70b-versatile', tokensIn: 1_000_000, tokensOut: 0 });
    expect(free.dollarCost).toBe(0);
  });

  it('adds shadow-priced scarcity so a free but rate-limited call is not free', () => {
    const shadow = new ShadowPriceEngine();
    shadow.set('groq:default:rpm', 2); // scarce
    const priced = new PricedCost(cost, shadow);
    const b = priced.price({
      providerId: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      tokensIn: 0,
      tokensOut: 0,
      resources: [{ id: 'groq:default:rpm', amount: 1 }],
    });
    expect(b.dollarCost).toBe(0);
    expect(b.shadowCost).toBeCloseTo(2);
    expect(b.total).toBeCloseTo(2);
  });
});
