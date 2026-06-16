import { describe, it, expect } from 'vitest';
import { dataPosture, allowsProvider } from '../../src/security/privacy';

describe('provider privacy (SEC-2)', () => {
  it('classifies free tiers as training and paid APIs as no-train', () => {
    expect(dataPosture('groq', 'free')).toBe('trains');
    expect(dataPosture('google', 'free')).toBe('trains');
    expect(dataPosture('openai', 'paid')).toBe('no-train');
    expect(dataPosture('anthropic', 'paid')).toBe('no-train');
    expect(dataPosture('google-paid', 'paid')).toBe('no-train');
  });

  it('allows everything when not sensitive', () => {
    expect(allowsProvider('groq', 'free', false)).toBe(true);
    expect(allowsProvider('openai', 'paid', false)).toBe(true);
  });

  it('blocks training providers in Sensitive mode, keeps no-train ones', () => {
    expect(allowsProvider('groq', 'free', true)).toBe(false);
    expect(allowsProvider('google', 'free', true)).toBe(false);
    expect(allowsProvider('openai', 'paid', true)).toBe(true);
    expect(allowsProvider('anthropic', 'paid', true)).toBe(true);
  });
});
