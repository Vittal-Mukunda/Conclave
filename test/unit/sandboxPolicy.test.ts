import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SANDBOX_POLICY,
  permitsEgress,
  isHardened,
  SandboxPolicy,
} from '../../src/security/SandboxPolicy';

describe('SandboxPolicy (SEC-5 / SKILL-7)', () => {
  it('the default policy is hardened: no net, no host FS, caps dropped', () => {
    expect(DEFAULT_SANDBOX_POLICY.network).toBe('none');
    expect(DEFAULT_SANDBOX_POLICY.noHostFs).toBe(true);
    expect(DEFAULT_SANDBOX_POLICY.readOnlyRoot).toBe(true);
    expect(DEFAULT_SANDBOX_POLICY.dropCapabilities).toContain('ALL');
    expect(isHardened(DEFAULT_SANDBOX_POLICY)).toBe(true);
  });

  it('denies all egress when network is disabled', () => {
    expect(permitsEgress(DEFAULT_SANDBOX_POLICY, 'https://example.com/x').allowed).toBe(false);
  });

  it('ALWAYS denies provider API hosts even if allowlisted (SKILL-7)', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_SANDBOX_POLICY,
      network: 'allowlist',
      egressAllowlist: ['api.openai.com', 'example.com'],
    };
    expect(permitsEgress(policy, 'https://api.openai.com/v1').allowed).toBe(false);
    expect(permitsEgress(policy, 'api.anthropic.com').allowed).toBe(false);
    // a non-provider allowlisted host is permitted
    expect(permitsEgress(policy, 'https://example.com').allowed).toBe(true);
  });

  it('denies a host not on the allowlist', () => {
    const policy: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, network: 'allowlist', egressAllowlist: ['ok.com'] };
    expect(permitsEgress(policy, 'evil.com').allowed).toBe(false);
  });

  it('a policy that allowlists a provider API is NOT considered hardened', () => {
    const policy: SandboxPolicy = {
      ...DEFAULT_SANDBOX_POLICY,
      network: 'allowlist',
      egressAllowlist: ['api.openai.com'],
    };
    expect(isHardened(policy)).toBe(false);
  });
});
