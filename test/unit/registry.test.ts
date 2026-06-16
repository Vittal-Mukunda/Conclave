import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../src/providers/registry';

describe('ProviderRegistry', () => {
  it('exposes both free and paid providers', () => {
    const reg = new ProviderRegistry();
    expect(reg.list('free').length).toBeGreaterThan(0);
    expect(reg.list('paid').length).toBeGreaterThan(0);
    expect(reg.get('anthropic')?.adapter).toBe('anthropic');
    expect(reg.get('groq')?.adapter).toBe('openai');
  });

  it('returns an equivalent model for PROV-8 fallback', () => {
    const reg = new ProviderRegistry();
    const alt = reg.equivalentModel('groq', 'llama-3.3-70b-versatile');
    expect(alt).toBeDefined();
    expect(alt?.id).not.toBe('llama-3.3-70b-versatile');
  });

  it('marks paid models with a non-zero price and free models without', () => {
    const reg = new ProviderRegistry();
    const paid = reg.get('openai')!.defaultModels[0];
    const free = reg.get('groq')!.defaultModels[0];
    expect(paid.inputPricePerMTok).toBeGreaterThan(0);
    expect(free.inputPricePerMTok ?? 0).toBe(0);
  });
});
