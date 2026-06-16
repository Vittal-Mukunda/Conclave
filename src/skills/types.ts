import { ConclaveError } from '../errors/ErrorReport';

// Core types for the Skills subsystem (Phase 16: format / ingest / retrieval).
// A skill = a folder with a SKILL.md entry point + optional scripts/ references/
// assets/. See docs/skills-spec.md — the spec wins over any marketplace format.

/** Trust tier governs precedence and whether scripts may ever run (Phase 18). */
export type TrustTier = 'user' | 'project' | 'vetted' | 'community';

/** Numeric prior so trust contributes to retrieval ranking but never as raw
 * trust (popularity boosts, never overrides — Phase 18). */
export const TRUST_PRIOR: Record<TrustTier, number> = {
  user: 0.3,
  project: 0.3,
  vetted: 0.15,
  community: 0.05,
};

export type SourceType = 'local-user' | 'local-project' | 'git' | 'marketplace';

export interface SkillSourceRef {
  /** Human-readable origin: a directory path, `owner/repo`, or a URL. */
  source: string;
  sourceType: SourceType;
}

/** Parsed + normalised SKILL.md frontmatter. Unknown fields are preserved in
 * `extra` (the spec says tolerate & keep when_to_use/context/agent/...). */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Parsed from the space-separated `allowed-tools` field. */
  allowedTools?: string[];
  /** Every other top-level key, preserved verbatim. */
  extra: Record<string, unknown>;
}

/** A fully ingested, validated skill ready for retrieval/activation. */
export interface Skill {
  name: string;
  description: string;
  frontmatter: SkillFrontmatter;
  /** The Markdown body (everything after the frontmatter). */
  body: string;
  /** The parent directory name (MUST equal `name`). */
  dirName: string;
  source: SkillSourceRef;
  trust: TrustTier;
  /** FNV content hash over all folder files — the content-addressed key. */
  contentHash: string;
  /** File globs this skill targets (from metadata.globs / when_to_use hints). */
  globs: string[];
  /** referenced files (references/ scripts/ assets/) that exist in the folder. */
  references: string[];
  /** referenced files that are MISSING — graceful skip + note (SKILL-8). */
  missingReferences: string[];
  /** Non-fatal advisories (e.g. body too long). */
  warnings: string[];
  /** Community skills default to scripts DISABLED (instructions-only). */
  scriptsEnabled: boolean;
  /** Estimated token cost of the body — drives the active-skill budget (SKILL-5). */
  bodyTokens: number;
}

/** Input to ingest: a skill folder's files keyed by path relative to the folder. */
export interface SkillFolderInput {
  dirName: string;
  /** Relative path -> file content. MUST include `SKILL.md`. */
  files: Record<string, string>;
  trust: TrustTier;
  source: SkillSourceRef;
}

export type IngestResult =
  | { ok: true; skill: Skill }
  | { ok: false; dirName: string; error: ConclaveError };

/** A lock-file entry for reproducible re-scans (conclave-skills-lock.json). */
export interface SkillLockEntry {
  name: string;
  source: string;
  sourceType: SourceType;
  computedHash: string;
}

// ---- Phase 17: composition + injection ----

/** Sub-agent injection points (docs/skills-spec.md). Each is context-isolated. */
export type SubAgentRole = 'localizer' | 'planner' | 'editor' | 'verifier' | 'reviewer';

/** Skill category — drives which sub-agent role(s) a skill is injected into. */
export type SkillCategory =
  | 'repo-map'
  | 'architecture'
  | 'domain-workflow'
  | 'plan-critique'
  | 'convention'
  | 'style'
  | 'framework'
  | 'commit-message'
  | 'test'
  | 'build'
  | 'deploy'
  | 'reproduction'
  | 'security-audit'
  | 'code-review'
  | 'general';

/** One composed, source-tagged skill block in the layered context. */
export interface ComposedBlock {
  name: string;
  trust: TrustTier;
  source: string;
  /** The delimited, data-fenced block text injected into the sub-agent. */
  text: string;
}

export type ConflictKind = 'directive' | 'shadowed';

/** A composition conflict surfaced to the planner (SKILL-4) — never silently merged. */
export interface SkillConflict {
  kind: ConflictKind;
  /** The contested key (e.g. `test_command`) or skill concern. */
  key: string;
  /** The winning skill name (highest precedence). */
  winner: string;
  /** Shadowed skill names. */
  losers: string[];
  reason: string;
}

/** The result of composing the active skills for one sub-agent role. */
export interface ComposedContext {
  role: SubAgentRole;
  /** Ordered highest-precedence first. */
  blocks: ComposedBlock[];
  /** The full layered text (all blocks concatenated), ready to inject. */
  text: string;
  /** Winning execution-affecting directives (build/test/deploy/run commands). */
  directives: Record<string, string>;
  /** Conflicts to surface to the planner (SKILL-4). */
  conflicts: SkillConflict[];
  /** Skills pulled in to satisfy `metadata.requires`. */
  dependencies: string[];
  /** Required skills that are not installed (graceful note). */
  missingDependencies: string[];
  /** Role policy: localizer/reviewer are read-only ("report, don't modify"). */
  readOnly: boolean;
  /** Whether permitted skills may run scripts in this role (off until Phase 18). */
  scriptsAllowed: boolean;
}

// ---- Phase 18: security scan + trust + sandbox + marketplace ----

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

/** One static/supply-chain scan finding on a skill. */
export interface ScanFinding {
  id: string;
  severity: RiskLevel;
  /** The folder-relative file the finding is in (or 'SKILL.md'). */
  file: string;
  detail: string;
}

export interface ScanResult {
  /** Highest severity across findings. */
  risk: RiskLevel;
  findings: ScanFinding[];
  /** True when nothing medium-or-higher was found (a vetting precondition). */
  clean: boolean;
}

/** Discovery priors (ranking only — NEVER trust; SKILL-9). */
export interface SkillStats {
  installs?: number;
  stars?: number;
}

/** Effective trust + whether scripts may run, with the reasons. */
export interface TrustDecision {
  tier: TrustTier;
  scriptsAllowed: boolean;
  /** High-risk scan → the skill must be quarantined, never loaded (SKILL-2). */
  quarantine: boolean;
  reasons: string[];
}

export type ExecKind = 'script' | 'network' | 'deploy' | 'commit';

export interface ExecRequest {
  /** The tool being invoked, e.g. 'Bash(git:commit)' or 'python'. */
  tool: string;
  kind: ExecKind;
  /** Target host/URL for a network request. */
  target?: string;
}

export interface ExecDecision {
  allowed: boolean;
  /** HITL must confirm before this proceeds (first exec / network / deploy / commit). */
  requiresConfirmation: boolean;
  reason: string;
}

/** A skill listing from a marketplace/discovery source. */
export interface MarketplaceEntry {
  name: string;
  description: string;
  source: string;
  sourceType: SourceType;
  license?: string;
  stats?: SkillStats;
}
