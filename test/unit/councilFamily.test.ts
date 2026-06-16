import { describe, it, expect } from 'vitest';
import { familyOf } from '../../src/council/family';
import { RouterModel } from '../../src/router/types';

function mk(providerId: string, modelId: string): RouterModel {
  return { providerId, modelId, kind: 'free', capabilities: [], inputPricePerMTok: 0, outputPricePerMTok: 0 };
}

describe('familyOf', () => {
  it('detects lineages across providers', () => {
    expect(familyOf(mk('groq', 'llama-3.3-70b-versatile'))).toBe('llama');
    expect(familyOf(mk('cerebras', 'llama-3.3-70b'))).toBe('llama');
    expect(familyOf(mk('google', 'gemini-2.0-flash'))).toBe('gemini');
    expect(familyOf(mk('openrouter', 'deepseek/deepseek-r1:free'))).toBe('deepseek');
    expect(familyOf(mk('mistral', 'codestral-latest'))).toBe('mistral');
    expect(familyOf(mk('openai', 'gpt-4.1'))).toBe('openai');
    expect(familyOf(mk('anthropic', 'claude-3-5-sonnet-latest'))).toBe('anthropic');
  });

  it('treats two Llama derivatives on different providers as the SAME family', () => {
    expect(familyOf(mk('groq', 'llama-3.3-70b'))).toBe(familyOf(mk('cerebras', 'llama-3.3-70b')));
  });

  it('falls back to provider for an unknown lineage', () => {
    expect(familyOf(mk('weirdprov', 'mystery-model-x'))).toBe('weirdprov');
  });
});
