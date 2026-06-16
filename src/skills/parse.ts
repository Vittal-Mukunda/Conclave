import { ConclaveError } from '../errors/ErrorReport';
import { SkillFrontmatter } from './types';

// SKILL.md parsing + validation (Phase 16). The build-plan mandates a YAML parser
// for the frontmatter; SKILL.md frontmatter is a *narrow, well-specified subset*
// (scalars, one-level maps, block scalars, a space-separated tool list), so this
// ships a deterministic, dependency-free parser for that subset — the same
// pure-TS deviation pattern used for linalg/embeddings, and the swap seam if a
// full YAML engine is ever wanted. Invalid input FAILS LOUDLY (SKILL-1).

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
/** Body soft limit (spec: keep <= ~500 lines / ~5000 tokens). */
export const MAX_BODY_LINES = 500;

export interface ParsedSkillMd {
  frontmatter: SkillFrontmatter;
  body: string;
  warnings: string[];
}

function skillError(detail: string, cause?: unknown): ConclaveError {
  return new ConclaveError({
    category: 'skill',
    code: 'SKILL-1',
    title: 'A skill could not be loaded',
    detail,
    cause,
    recoveryActions: [
      { label: 'View skill docs', kind: 'docs', command: 'conclave.reportIssue' },
    ],
    canRetry: false,
  });
}

/** Strip one layer of matching quotes from a scalar value. */
function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2) {
    const a = t[0];
    if ((a === '"' || a === "'") && t[t.length - 1] === a) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') {
    i++;
  }
  return i;
}

/**
 * Parse the YAML frontmatter block (the text BETWEEN the `---` fences) into a
 * flat record. Supports: `key: value`, quoted scalars, `key:` + indented
 * `subkey: value` children (a one-level map), and block scalars (`>` fold / `|`
 * literal). Unknown keys are preserved.
 */
export function parseFrontmatterBlock(block: string): Record<string, unknown> {
  const lines = block.split('\n');
  const data: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    if (indentOf(line) > 0) {
      // Stray indented line with no parent key — ignore rather than crash.
      continue;
    }
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!m) {
      continue; // tolerate unparseable lines (robustness > strictness here)
    }
    const key = m[1];
    const rest = m[2].trim();

    // Collect any more-indented child lines that belong to this key.
    const children: string[] = [];
    while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
      children.push(lines[i]);
      i++;
    }
    // Drop trailing blank lines from the child block.
    while (children.length && children[children.length - 1].trim() === '') {
      children.pop();
    }

    const blockScalar = /^[|>][+-]?$/.test(rest);
    if (blockScalar) {
      const fold = rest[0] === '>';
      const minIndent = Math.min(
        ...children.filter((c) => c.trim()).map((c) => indentOf(c)),
      );
      const text = children.map((c) => c.slice(Number.isFinite(minIndent) ? minIndent : 0));
      data[key] = fold ? text.map((t) => t.trim()).join(' ').trim() : text.join('\n');
      continue;
    }

    if (rest === '' && children.length) {
      const childPairs = children.filter((c) => c.trim());
      const allPairs = childPairs.every((c) => /^[ \t]*[A-Za-z0-9_-]+:[ \t]*.*$/.test(c));
      if (allPairs) {
        const map: Record<string, string> = {};
        for (const c of childPairs) {
          const cm = /^[ \t]*([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(c);
          if (cm) {
            map[cm[1]] = unquote(cm[2]);
          }
        }
        data[key] = map;
      } else {
        // Plain wrapped scalar (folded).
        data[key] = childPairs.map((c) => c.trim()).join(' ').trim();
      }
      continue;
    }

    data[key] = rest === '' ? '' : unquote(rest);
  }
  return data;
}

/**
 * Split a SKILL.md document into frontmatter + body. The frontmatter MUST start
 * on line 1 with `---` (SKILL-1) and be closed by a `---` line.
 */
function splitDocument(text: string): { block: string; body: string } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw skillError('SKILL.md must begin with a YAML frontmatter block (`---` on line 1).');
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw skillError('SKILL.md frontmatter is not closed with a `---` line.');
  }
  return {
    block: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''),
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asStringMap(v: unknown): Record<string, string> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof val === 'string' ? val : String(val);
    }
    return out;
  }
  return undefined;
}

/**
 * Parse + VALIDATE a SKILL.md document. Throws a typed SKILL-1 error on any
 * structural problem (missing/invalid name or description, bad YAML) so the
 * caller can quarantine the skill and report the exact issue. `expectedName`
 * (the parent directory name) is enforced when provided — the spec requires
 * `name == directory name`.
 */
export function parseSkillMd(text: string, expectedName?: string): ParsedSkillMd {
  const { block, body } = splitDocument(text);
  const raw = parseFrontmatterBlock(block);
  const warnings: string[] = [];

  const name = asString(raw.name)?.trim();
  if (!name) {
    throw skillError('SKILL.md frontmatter is missing the required `name` field.');
  }
  if (name.length > MAX_NAME || !NAME_RE.test(name)) {
    throw skillError(
      `Skill name "${name}" is invalid — it must be <=${MAX_NAME} chars and match ^[a-z0-9]+(-[a-z0-9]+)*$.`,
    );
  }
  if (expectedName !== undefined && name !== expectedName) {
    throw skillError(
      `Skill name "${name}" does not match its folder "${expectedName}" — name MUST equal the directory name.`,
    );
  }

  const description = asString(raw.description)?.trim();
  if (!description) {
    throw skillError(`Skill "${name}" is missing the required, non-empty \`description\` field.`);
  }
  if (description.length > MAX_DESCRIPTION) {
    throw skillError(
      `Skill "${name}" description exceeds ${MAX_DESCRIPTION} chars (${description.length}).`,
    );
  }

  const compatibility = asString(raw.compatibility)?.trim();
  if (compatibility && compatibility.length > MAX_COMPATIBILITY) {
    throw skillError(`Skill "${name}" compatibility exceeds ${MAX_COMPATIBILITY} chars.`);
  }

  const allowedToolsRaw = asString(raw['allowed-tools']);
  const allowedTools = allowedToolsRaw
    ? allowedToolsRaw.split(/\s+/).filter(Boolean)
    : undefined;

  const metadata = asStringMap(raw.metadata);

  // Preserve every other (unknown) top-level field verbatim.
  const known = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) {
      extra[k] = v;
    }
  }

  const bodyLines = body.split('\n').length;
  if (bodyLines > MAX_BODY_LINES) {
    warnings.push(
      `Body is ${bodyLines} lines (> ${MAX_BODY_LINES}); push detail into references/ for progressive disclosure.`,
    );
  }

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    license: asString(raw.license)?.trim(),
    compatibility,
    metadata,
    allowedTools,
    extra,
  };
  return { frontmatter, body, warnings };
}
