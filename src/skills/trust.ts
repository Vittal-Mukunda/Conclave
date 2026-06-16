import { ScanResult, SkillStats, TrustDecision, TrustTier } from './types';

// Trust-tier evaluation (docs/skills-spec.md SECURITY). Tiers:
//   first-party/user + project  > vetted > untrusted community (DEFAULT).
// The two load-bearing rules:
//   - community skills are INSTRUCTIONS-ONLY (scripts DISABLED) by default;
//   - popularity NEVER grants trust — a popular-but-unvetted skill stays
//     scripts-off until vetted (SKILL-9).
// A high-risk scan forces quarantine: the skill is never loaded/run (SKILL-2).

/** Licenses we accept for the vetted tier (permissive, auditable). */
const VETTED_LICENSES = /^(apache(-2\.0)?|mit|bsd(-[23]-clause)?|isc)$/i;
/** Popularity floor for vetting (a precondition, not sufficient on its own). */
const VETTED_MIN_INSTALLS = 1000;
const VETTED_MIN_STARS = 50;

export interface TrustInput {
  /** The tier the source maps to (local-project=project, local-user=user, remote=community). */
  declaredTier: TrustTier;
  scan: ScanResult;
  license?: string;
  stats?: SkillStats;
  /** Has an operator explicitly marked this skill/source as vetted? */
  operatorVetted?: boolean;
}

/**
 * Decide a skill's effective trust + whether its scripts may run. First-party
 * (user/project) is trusted. Everything else defaults to community
 * instructions-only; it is promoted to vetted ONLY by passing license + scan +
 * popularity floor, or by an explicit operator vet. Popularity alone never
 * promotes (SKILL-9). High-risk scan → quarantine (SKILL-2).
 */
export function evaluateTrust(input: TrustInput): TrustDecision {
  const reasons: string[] = [];

  // Quarantine takes precedence over everything (SKILL-2).
  if (input.scan.risk === 'high') {
    return {
      tier: input.declaredTier,
      scriptsAllowed: false,
      quarantine: true,
      reasons: [`scan flagged HIGH-risk content (${input.scan.findings.map((f) => f.id).join(', ')}) — quarantined, never run (SKILL-2)`],
    };
  }

  // First-party: the user's own / checked-in skills are trusted to run scripts
  // (still HITL-gated on first exec by the sandbox).
  if (input.declaredTier === 'user' || input.declaredTier === 'project') {
    return {
      tier: input.declaredTier,
      scriptsAllowed: true,
      quarantine: false,
      reasons: ['first-party (user/project) skill — trusted'],
    };
  }

  // Operator explicitly vetted this source.
  if (input.operatorVetted) {
    return {
      tier: 'vetted',
      scriptsAllowed: true,
      quarantine: false,
      reasons: ['operator-vetted source'],
    };
  }

  // Auto-vetting precondition: permissive license + scan-clean + popular.
  const licenseOk = !!input.license && VETTED_LICENSES.test(input.license.trim());
  const popular =
    (input.stats?.installs ?? 0) >= VETTED_MIN_INSTALLS ||
    (input.stats?.stars ?? 0) >= VETTED_MIN_STARS;
  if (licenseOk && input.scan.clean && popular) {
    reasons.push('permissive license + scan-clean + popular → vetted');
    return { tier: 'vetted', scriptsAllowed: true, quarantine: false, reasons };
  }

  // Otherwise community: instructions-only. Explain why (esp. SKILL-9).
  if (!licenseOk) {
    reasons.push('no permissive license');
  }
  if (!input.scan.clean) {
    reasons.push(`scan found ${input.scan.risk}-risk content`);
  }
  if (popular && licenseOk && input.scan.clean) {
    // unreachable given the branch above, kept for clarity
  } else if (popular) {
    reasons.push('popular but unvetted — popularity does NOT grant trust (SKILL-9)');
  }
  reasons.push('community tier → instructions-only, scripts disabled');
  return { tier: 'community', scriptsAllowed: false, quarantine: false, reasons };
}
