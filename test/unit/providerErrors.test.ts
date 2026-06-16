import { describe, it, expect } from 'vitest';
import { mapHttpError, mapTransportError } from '../../src/providers/errors';
import { TransportError } from '../../src/providers/http';
import { ProviderRegistry } from '../../src/providers/registry';

const registry = new ProviderRegistry();
const groq = registry.get('groq')!;
const openai = registry.get('openai')!;

describe('provider error mapping (SETUP/PROV catalog)', () => {
  it.each([
    [401, 'SETUP-2'],
    [403, 'SETUP-2'],
    [404, 'PROV-8'],
    [429, 'PROV-1'],
    [451, 'SETUP-10'],
    [500, 'PROV-3'],
    [503, 'PROV-3'],
  ])('maps HTTP %i -> %s with an action', (status, code) => {
    const err = mapHttpError(status as number, groq);
    expect(err.code).toBe(code);
    expect(err.recoveryActions.length).toBeGreaterThanOrEqual(1);
  });

  it('maps free-tier quota exhaustion to SETUP-4', () => {
    const err = mapHttpError(429, groq, 'You have exceeded your current quota');
    // body mentions quota -> SETUP-4 (not the generic 429 path)
    expect(err.code).toBe('SETUP-4');
  });

  it('maps paid billing failure to PROV-13 with a fallback', () => {
    const err = mapHttpError(402, openai, 'insufficient credit balance');
    expect(err.code).toBe('PROV-13');
    expect(err.fallbackApplied).toBeTruthy();
  });

  it('maps a context-length 400 to PROV-10', () => {
    const err = mapHttpError(400, groq, 'This model maximum context length is 8192 tokens');
    expect(err.code).toBe('PROV-10');
  });

  it('maps a timeout transport error to PROV-4', () => {
    const err = mapTransportError(new TransportError('t', 'timeout'), groq);
    expect(err.code).toBe('PROV-4');
    expect(err.canRetry).toBe(true);
  });

  it('maps a network transport error to SETUP-8 (connectivity)', () => {
    const err = mapTransportError(new TransportError('n', 'network'), groq);
    expect(err.code).toBe('SETUP-8');
    expect(err.category).toBe('connectivity');
  });
});
