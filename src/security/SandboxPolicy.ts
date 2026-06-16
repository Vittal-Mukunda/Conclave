// Phase 15 — sandbox security policy (SEC-5 + SKILL-7). Declares the hardened
// posture the verification sandbox MUST run under once it is a real container
// (Phase 9 ships a process sandbox, flagged degraded). Default: no network, no
// host filesystem, dropped Linux capabilities, read-only root. Critically, the
// egress allowlist EXCLUDES provider API hosts — sandboxed code must never be
// able to reach an LLM endpoint and exfiltrate via it (SKILL-7).

export type NetworkMode = 'none' | 'allowlist';

export interface SandboxPolicy {
  network: NetworkMode;
  /** Hosts egress is permitted to (only when network = 'allowlist'). */
  egressAllowlist: string[];
  /** Linux capabilities dropped ('ALL' drops everything). */
  dropCapabilities: string[];
  /** No bind-mount of the host filesystem. */
  noHostFs: boolean;
  /** Root filesystem mounted read-only. */
  readOnlyRoot: boolean;
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  network: 'none',
  egressAllowlist: [],
  dropCapabilities: ['ALL'],
  noHostFs: true,
  readOnlyRoot: true,
};

// Provider API hosts the sandbox may NEVER reach, even if otherwise allowlisted —
// they are the exfiltration channel we most need to deny (SKILL-7).
export const PROVIDER_API_HOSTS: readonly string[] = [
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.cerebras.ai',
  'api.mistral.ai',
  'models.inference.ai.azure.com',
  'api.deepseek.com',
];

export interface EgressDecision {
  allowed: boolean;
  reason: string;
}

function hostOf(target: string): string {
  // Accept a bare host or a URL.
  try {
    return new URL(target).hostname;
  } catch {
    return target.replace(/^.*?@/, '').split('/')[0].split(':')[0];
  }
}

/** Decide whether the sandbox may make egress to a target host/URL. */
export function permitsEgress(policy: SandboxPolicy, target: string): EgressDecision {
  const host = hostOf(target);
  if (PROVIDER_API_HOSTS.includes(host)) {
    return { allowed: false, reason: `provider API host ${host} is always denied inside the sandbox (SKILL-7)` };
  }
  if (policy.network === 'none') {
    return { allowed: false, reason: 'sandbox network is disabled (SEC-5)' };
  }
  if (policy.egressAllowlist.includes(host)) {
    return { allowed: true, reason: `host ${host} is on the egress allowlist` };
  }
  return { allowed: false, reason: `host ${host} is not on the egress allowlist` };
}

/** Validate a policy is at least as strict as the hardened baseline. */
export function isHardened(policy: SandboxPolicy): boolean {
  return (
    policy.noHostFs &&
    policy.readOnlyRoot &&
    (policy.dropCapabilities.includes('ALL') || policy.dropCapabilities.length > 0) &&
    (policy.network === 'none' || policy.egressAllowlist.every((h) => !PROVIDER_API_HOSTS.includes(h)))
  );
}
