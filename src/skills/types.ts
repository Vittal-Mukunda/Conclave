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
