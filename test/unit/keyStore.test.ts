import { describe, it, expect } from 'vitest';
import { KeyStore, SecretStore } from '../../src/keys/KeyStore';
import { SecretRedactor, REDACTION_PLACEHOLDER } from '../../src/logging/redaction';

class MemoryStore implements SecretStore {
  readonly map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key);
  }
  async store(key: string, value: string) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

describe('KeyStore (keys persist; never leak)', () => {
  it('sets, reads and reports presence', async () => {
    const store = new MemoryStore();
    const ks = new KeyStore(store);
    expect(await ks.hasKey('groq')).toBe(false);
    await ks.setKey('groq', '  sk-abc  ');
    expect(await ks.hasKey('groq')).toBe(true);
    expect(await ks.getKey('groq')).toBe('sk-abc'); // trimmed
  });

  it('persists across KeyStore instances backed by the same store', async () => {
    const store = new MemoryStore();
    await new KeyStore(store).setKey('openai', 'sk-persist');
    const reopened = new KeyStore(store);
    expect(await reopened.getKey('openai')).toBe('sk-persist');
  });

  it('clears a key', async () => {
    const store = new MemoryStore();
    const ks = new KeyStore(store);
    await ks.setKey('groq', 'sk-zzz');
    await ks.clearKey('groq');
    expect(await ks.hasKey('groq')).toBe(false);
  });

  it('registers a stored key with the redactor and unregisters on clear (SEC-4)', async () => {
    const redactor = new SecretRedactor();
    const ks = new KeyStore(new MemoryStore(), redactor);
    await ks.setKey('groq', 'unguessable-token-9');
    expect(redactor.redactText('x unguessable-token-9 y')).toContain(REDACTION_PLACEHOLDER);
    await ks.clearKey('groq');
    expect(redactor.redactText('x unguessable-token-9 y')).toContain('unguessable-token-9');
  });
});
