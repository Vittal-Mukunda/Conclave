import { SqlDb } from '../storage/SqlDb';
import { Skill, SkillFrontmatter, SkillLockEntry, SkillSourceRef, SourceType, TrustTier } from './types';

// Persists the content-addressed skills index (migration v6 `skill` table). The
// body + frontmatter are cached so retrieval can score installed skills without
// re-reading disk; `content_hash` is the reproducibility key — a re-scan that
// finds the same hash is a no-op, a changed hash is an update (diff on bump). A
// corrupt row is skipped, not fatal (STATE-4).

interface SkillRow {
  name: string;
  source: string;
  source_type: string;
  content_hash: string;
  trust: string;
  description: string;
  body: string;
  frontmatter: string;
  globs: string | null;
  scripts_enabled: number;
}

export class SkillStore {
  constructor(private readonly db: SqlDb) {}

  /** All persisted skills. Corrupt rows are skipped. */
  all(): Skill[] {
    const rows = this.db.all<SkillRow>(
      'SELECT name, source, source_type, content_hash, trust, description, body, frontmatter, globs, scripts_enabled FROM skill',
    );
    const out: Skill[] = [];
    for (const r of rows) {
      try {
        const frontmatter = JSON.parse(r.frontmatter) as SkillFrontmatter;
        const globs = r.globs ? (JSON.parse(r.globs) as string[]) : [];
        const source: SkillSourceRef = { source: r.source, sourceType: r.source_type as SourceType };
        out.push({
          name: r.name,
          description: r.description,
          frontmatter,
          body: r.body,
          dirName: r.name,
          source,
          trust: r.trust as TrustTier,
          contentHash: r.content_hash,
          globs,
          references: [],
          missingReferences: [],
          warnings: [],
          scriptsEnabled: r.scripts_enabled === 1,
          bodyTokens: Math.ceil(r.body.length / 4),
        });
      } catch {
        // Skip a corrupt row — the skill just re-ingests on next scan.
      }
    }
    return out;
  }

  /** Upsert one skill (content-addressed by name+source). */
  save(skill: Skill, now = Date.now()): void {
    this.db.run(
      `INSERT INTO skill
         (name, source, source_type, content_hash, trust, description, body, frontmatter, globs, scripts_enabled, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(name, source) DO UPDATE SET
         source_type = excluded.source_type, content_hash = excluded.content_hash,
         trust = excluded.trust, description = excluded.description, body = excluded.body,
         frontmatter = excluded.frontmatter, globs = excluded.globs,
         scripts_enabled = excluded.scripts_enabled, updated_at = excluded.updated_at`,
      [
        skill.name,
        skill.source.source,
        skill.source.sourceType,
        skill.contentHash,
        skill.trust,
        skill.description,
        skill.body,
        JSON.stringify(skill.frontmatter),
        JSON.stringify(skill.globs),
        skill.scriptsEnabled ? 1 : 0,
        now,
      ],
    );
  }

  /** Remove a skill from the index. */
  remove(name: string, source: string): void {
    this.db.run('DELETE FROM skill WHERE name = ? AND source = ?', [name, source]);
  }

  /** The current stored hash for a skill (for change detection on re-scan). */
  hashOf(name: string, source: string): string | undefined {
    const row = this.db.get<{ content_hash: string }>(
      'SELECT content_hash FROM skill WHERE name = ? AND source = ?',
      [name, source],
    );
    return row?.content_hash;
  }

  /** Lock entries for reproducible re-scans (conclave-skills-lock.json). */
  lock(): SkillLockEntry[] {
    return this.all()
      .map((s) => ({
        name: s.name,
        source: s.source.source,
        sourceType: s.source.sourceType,
        computedHash: s.contentHash,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
  }
}
