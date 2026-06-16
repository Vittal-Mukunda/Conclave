import { describe, it, expect } from 'vitest';
import { SecretRedactor, REDACTION_PLACEHOLDER } from '../../src/logging/redaction';

describe('SecretRedactor (SEC-4: no secret substring survives)', () => {
  it('removes a registered key verbatim regardless of shape', () => {
    const redactor = new SecretRedactor();
    const key = 'totally-custom-shape_KEY_42!!';
    redactor.registerSecret(key);

    const out = redactor.redactText(`calling provider with ${key} now`);
    expect(out).not.toContain(key);
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it('redacts common key shapes without registration', () => {
    const redactor = new SecretRedactor();
    const samples = [
      'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX1234',
      'AIzaSyA1234567890abcdefghijklmnopqrstuvw',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'gsk_ABCDEFGHIJKLMNOPQRSTUVWX1234567890',
    ];
    for (const s of samples) {
      const out = redactor.redactText(`token=${s}`);
      expect(out, `should redact ${s}`).not.toContain(s);
    }
  });

  it('redacts Bearer tokens but keeps the scheme word', () => {
    const redactor = new SecretRedactor();
    const out = redactor.redactText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz123');
    expect(out).toContain('Bearer');
  });

  it('redacts key=value style assignments', () => {
    const redactor = new SecretRedactor();
    const out = redactor.redactText('API_KEY=supersecretvalue123');
    expect(out).not.toContain('supersecretvalue123');
  });

  it('deep-redacts nested objects', () => {
    const redactor = new SecretRedactor();
    redactor.registerSecret('nested-secret-xyz');
    const out = redactor.redact({ a: { b: ['nested-secret-xyz', 'fine'] } });
    expect(JSON.stringify(out)).not.toContain('nested-secret-xyz');
    expect(JSON.stringify(out)).toContain('fine');
  });
});
