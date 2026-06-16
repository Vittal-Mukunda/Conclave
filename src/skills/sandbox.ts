import { DEFAULT_SANDBOX_POLICY, permitsEgress, SandboxPolicy } from '../security/SandboxPolicy';
import { ExecDecision, ExecRequest, Skill } from './types';

// The skill execution gate (docs/skills-spec.md SECURITY). Permitted scripts run
// ONLY inside the hardened sandbox (no secrets, least-privilege FS, egress
// allowlist that EXCLUDES provider APIs — reused from Phase 15). This gate:
//   - refuses scripts for instructions-only skills (community default);
//   - enforces `allowed-tools` as a HARD CEILING (advisory upstream, binding here);
//   - requires HITL confirmation before the FIRST script exec, any network
//     access, and any deploy/commit (SKILL-7);
//   - denies provider-API egress always (anti-exfiltration).
//
// The real CONTAINER is deferred (same flagged deviation as Phase 9's process
// sandbox); this gate is the enforcement seam the runner consults.

/**
 * Does an `allowed-tools` entry cover a requested tool? Entries look like
 * `Read`, `Bash`, or `Bash(git:*)`. We match the head (before `(`) and, when the
 * entry scopes arguments, require the request's argument to fall under it.
 */
export function toolAllowed(allowed: string[] | undefined, tool: string): boolean {
  if (!allowed || allowed.length === 0) {
    // No declaration = no tools permitted (deny-by-default ceiling).
    return false;
  }
  const [reqHead, reqArgRaw] = splitTool(tool);
  const reqArg = reqArgRaw ?? '';
  for (const entry of allowed) {
    const [head, argPat] = splitTool(entry);
    if (head.toLowerCase() !== reqHead.toLowerCase()) {
      continue;
    }
    if (argPat === undefined) {
      return true; // unscoped entry covers any use of the tool
    }
    if (globScopeMatch(argPat, reqArg)) {
      return true;
    }
  }
  return false;
}

function splitTool(s: string): [string, string | undefined] {
  const m = /^([^(]+)(?:\(([^)]*)\))?$/.exec(s.trim());
  if (!m) {
    return [s.trim(), undefined];
  }
  return [m[1].trim(), m[2]?.trim()];
}

/** Match a scope pattern like `git:*` against `git:commit`. `*` is a wildcard. */
function globScopeMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    '^' + pattern.split('*').map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
  );
  return re.test(value);
}

export class SkillExecutionGate {
  private firstExecDone = false;

  constructor(private readonly policy: SandboxPolicy = DEFAULT_SANDBOX_POLICY) {}

  /** The hardened policy permitted scripts run under. */
  sandboxPolicy(): SandboxPolicy {
    return this.policy;
  }

  /**
   * Decide whether a skill may perform an action. Pure given the gate's
   * first-exec state; the host performs the actual HITL confirm when
   * `requiresConfirmation` is set.
   */
  decide(skill: Skill, req: ExecRequest): ExecDecision {
    // Instructions-only skills can never execute (community default, SKILL-9).
    if (!skill.scriptsEnabled) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `skill "${skill.name}" is instructions-only (scripts disabled) — execution refused`,
      };
    }

    // allowed-tools hard ceiling.
    if (!toolAllowed(skill.frontmatter.allowedTools, req.tool)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `tool "${req.tool}" is outside skill "${skill.name}"'s allowed-tools ceiling`,
      };
    }

    // Network egress: provider API hosts are always denied (anti-exfiltration).
    if (req.kind === 'network') {
      const egress = permitsEgress(this.policy, req.target ?? '');
      if (!egress.allowed) {
        return { allowed: false, requiresConfirmation: false, reason: egress.reason };
      }
    }

    // HITL: first script exec, any network, any deploy/commit must be confirmed.
    const requiresConfirmation =
      req.kind === 'network' ||
      req.kind === 'deploy' ||
      req.kind === 'commit' ||
      (req.kind === 'script' && !this.firstExecDone);

    return {
      allowed: true,
      requiresConfirmation,
      reason: requiresConfirmation
        ? `permitted but requires confirmation (${req.kind}) before running (SKILL-7)`
        : 'permitted',
    };
  }

  /** Mark that the user confirmed + the first exec ran (subsequent scripts skip the first-run prompt). */
  markExecuted(): void {
    this.firstExecDone = true;
  }
}
