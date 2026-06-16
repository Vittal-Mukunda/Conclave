import { hashContent } from '../editing/hash';
import { ConclaveError } from '../errors/ErrorReport';
import { parseSkillMd } from './parse';
import { IngestResult, Skill, SkillFolderInput, SkillFrontmatter } from './types';

// Ingest one skill folder into a validated, content-addressed Skill (Phase 16).
// Pure over an injected file map so it is fully unit-testable; the vscode glue
// (SkillsService) does the disk walk. Invalid skills FAIL LOUDLY and are
// quarantined (SKILL-1); a referenced file that is missing is a graceful note,
// not a failure (SKILL-8).

const ENTRY = 'SKILL.md';
const REF_DIRS = ['references', 'scripts', 'assets'];
/** Matches a folder-relative path into references/ scripts/ assets/. */
const REF_RE = new RegExp(`(?:^|[\\s\\(\\['"\`])((?:${REF_DIRS.join('|')})/[\\w./-]+)`, 'g');

/** Stable content hash over every folder file (path + content), order-independent. */
export function folderHash(files: Record<string, string>): string {
  const parts = Object.keys(files)
    .sort()
    .map((p) => `${p}\0${files[p]}`);
  return hashContent(parts.join(''));
}

/** File globs this skill targets, from metadata.globs / when_to_use / context. */
function extractGlobs(fm: SkillFrontmatter): string[] {
  const out = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== 'string') {
      return;
    }
    for (const tok of raw.split(/[\s,]+/)) {
      // A token that looks like a glob/extension (has * or a leading dot or a slash).
      if (/[*?]/.test(tok) || /^\.\w+$/.test(tok) || tok.includes('/')) {
        out.add(tok.replace(/^['"`]|['"`]$/g, ''));
      }
    }
  };
  add(fm.metadata?.globs);
  add(fm.metadata?.files);
  add(fm.extra['when_to_use']);
  add(fm.extra['context']);
  return [...out];
}

/** Scan the body for referenced files; partition into present vs missing (SKILL-8). */
function resolveReferences(
  body: string,
  files: Record<string, string>,
): { references: string[]; missing: string[] } {
  const present = new Set<string>();
  const missing = new Set<string>();
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(body)) !== null) {
    const path = m[1].replace(/[.,;:)\]"'`]+$/, '');
    if (Object.prototype.hasOwnProperty.call(files, path)) {
      present.add(path);
    } else {
      missing.add(path);
    }
  }
  return { references: [...present].sort(), missing: [...missing].sort() };
}

export function ingestSkill(input: SkillFolderInput): IngestResult {
  try {
    const entry = input.files[ENTRY];
    if (entry === undefined) {
      throw new ConclaveError({
        category: 'skill',
        code: 'SKILL-1',
        title: 'A skill could not be loaded',
        detail: `Folder "${input.dirName}" has no ${ENTRY} entry point.`,
        recoveryActions: [{ label: 'View skill docs', kind: 'docs', command: 'conclave.reportIssue' }],
      });
    }
    const parsed = parseSkillMd(entry, input.dirName);
    const { references, missing } = resolveReferences(parsed.body, input.files);
    const warnings = [...parsed.warnings];
    if (missing.length) {
      warnings.push(`Missing referenced file(s): ${missing.join(', ')} — skipped (SKILL-8).`);
    }

    const skill: Skill = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      dirName: input.dirName,
      source: input.source,
      trust: input.trust,
      contentHash: folderHash(input.files),
      globs: extractGlobs(parsed.frontmatter),
      references,
      missingReferences: missing,
      warnings,
      // Only first-party tiers may run scripts; community is instructions-only by
      // default until vetted (full sandbox/scan lands in Phase 18).
      scriptsEnabled: input.trust === 'user' || input.trust === 'project',
      bodyTokens: Math.ceil(parsed.body.length / 4),
    };
    return { ok: true, skill };
  } catch (err) {
    const error =
      err instanceof ConclaveError
        ? err
        : new ConclaveError({
            category: 'skill',
            code: 'SKILL-1',
            title: 'A skill could not be loaded',
            detail: `Failed to ingest skill "${input.dirName}".`,
            cause: err,
            recoveryActions: [{ label: 'View skill docs', kind: 'docs', command: 'conclave.reportIssue' }],
          });
    return { ok: false, dirName: input.dirName, error };
  }
}
