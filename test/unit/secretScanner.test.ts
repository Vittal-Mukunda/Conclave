import { describe, it, expect } from 'vitest';
import { scanSecrets, containsNoSecret } from '../../src/security/SecretScanner';

describe('SecretScanner (SEC-1)', () => {
  it('detects and redacts an OpenAI key', () => {
    const r = scanSecrets('const k = "sk-abcdefghijklmnopqrstuvwx1234567890";');
    expect(r.total).toBe(1);
    expect(r.redacted).not.toContain('sk-abcdefghijklmnop');
    expect(r.redacted).toContain('«redacted:openai-key»');
  });

  it('detects an Anthropic key before the generic openai shape', () => {
    const r = scanSecrets('sk-ant-api03-AAAABBBBCCCCDDDDEEEE1234');
    expect(r.findings[0].type).toBe('anthropic-key');
  });

  it('detects Google, GitHub, Groq, AWS, Slack tokens', () => {
    const text = [
      'AIzaSyA1234567890abcdefghijklmnopqrstuvx',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      'gsk_0123456789abcdefghijklmnop',
      'AKIAIOSFODNN7EXAMPLE',
      'xoxb-0123456789-abcdefghij',
    ].join('\n');
    const types = scanSecrets(text).findings.map((f) => f.type);
    expect(types).toEqual(
      expect.arrayContaining(['google-key', 'github-token', 'groq-key', 'aws-access-key', 'slack-token']),
    );
  });

  it('redacts a PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc123\n-----END RSA PRIVATE KEY-----';
    const r = scanSecrets(pem);
    expect(r.findings.some((f) => f.type === 'private-key')).toBe(true);
    expect(r.redacted).not.toContain('MIIEabc123');
  });

  it('redacts a JWT', () => {
    const jwt = 'token=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NQ.SflKxwRJSMeKKF2QT4';
    expect(scanSecrets(jwt).total).toBeGreaterThan(0);
  });

  it('redacts only the value of a secret assignment, keeping the key name', () => {
    const r = scanSecrets('password = "hunter2supersecret"');
    expect(r.findings.some((f) => f.type === 'assigned-secret')).toBe(true);
    expect(r.redacted).toContain('password =');
    expect(r.redacted).not.toContain('hunter2supersecret');
  });

  it('leaves clean code untouched', () => {
    const code = 'function add(a, b) { return a + b; }';
    const r = scanSecrets(code);
    expect(r.total).toBe(0);
    expect(r.redacted).toBe(code);
    expect(containsNoSecret(code)).toBe(true);
  });
});
