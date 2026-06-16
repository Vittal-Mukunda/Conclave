import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { CapabilityRegistry } from '../../src/capability/CapabilityRegistry';
import { ProviderRegistry } from '../../src/providers/registry';

const MODEL = 'llama-3.3-70b-versatile';

function registry(): CapabilityRegistry {
  const reg = new CapabilityRegistry(Storage.memory().db);
  reg.seed(new ProviderRegistry().list());
  return reg;
}

describe('CapabilityRegistry', () => {
  it('seeds models from the provider registry with published limits + prices', () => {
    const reg = registry();
    const groq = reg.getModel('groq', MODEL);
    expect(groq).toBeDefined();
    expect(groq?.published_rpm).toBeGreaterThan(0);
    const paid = reg.getModel('openai', 'gpt-4.1');
    expect(paid?.input_price).toBeGreaterThan(0);
  });

  it('seed is idempotent (does not clobber stats on restart)', () => {
    const reg = registry();
    reg.recordOutcome('groq', MODEL, { ok: true, latencyMs: 100, tokensOut: 50 });
    reg.seed(new ProviderRegistry().list()); // simulate a restart re-seed
    expect(reg.getModel('groq', MODEL)?.success).toBe(1);
  });

  it('setProbe updates availability and latency', () => {
    const reg = registry();
    reg.setProbe('groq', MODEL, { available: false, latencyMs: 150, at: 5 });
    const m = reg.getModel('groq', MODEL)!;
    expect(m.available).toBe(0);
    expect(m.latency_ms).toBe(150);
    expect(m.last_probed).toBe(5);
  });

  it('recordOutcome accumulates success/error/429 and rolls latency (EWMA)', () => {
    const reg = registry();
    reg.recordOutcome('groq', MODEL, { ok: true, latencyMs: 200, tokensOut: 100 });
    expect(reg.getModel('groq', MODEL)?.latency_ms).toBe(200);
    reg.recordOutcome('groq', MODEL, { ok: false, rateLimited: true, latencyMs: 400 });
    const m = reg.getModel('groq', MODEL)!;
    expect(m.success).toBe(1);
    expect(m.errors).toBe(1);
    expect(m.rate_limits).toBe(1);
    expect(m.latency_ms).toBeCloseTo(200 * 0.8 + 400 * 0.2); // 240
  });

  it('quota meter decrements and resets correctly', () => {
    const reg = registry();
    const c = reg.consumeQuota('groq', MODEL, 'day', 5, 1000, 100);
    expect(c.used).toBe(5);
    expect(c.remaining).toBe(95);

    // Same window: usage persists.
    expect(reg.remainingQuota('groq', MODEL, 'day', 2000).used).toBe(5);

    // After the window elapses: a lazy reset zeroes usage.
    const afterReset = reg.remainingQuota('groq', MODEL, 'day', 1000 + 86_400_001);
    expect(afterReset.used).toBe(0);

    const c2 = reg.consumeQuota('groq', MODEL, 'day', 3, 1000 + 86_400_002, 100);
    expect(c2.used).toBe(3); // counts from zero after reset
  });
});
