import { describe, it, expect } from 'vitest';
import { parseSkillMd, parseFrontmatterBlock } from '../../src/skills/parse';
import { ConclaveError } from '../../src/errors/ErrorReport';

const VALID = `---
name: pdf-tools
description: Read and edit PDF files. Use when the user mentions a .pdf file.
license: Apache-2.0
allowed-tools: Bash(git:*) Read
metadata:
  version: 1.2.0
  author: jane
when_to_use: when working with PDF documents
---
# PDF tools

Body content here.
`;

describe('parseFrontmatterBlock', () => {
  it('parses scalars, quoted values, nested maps and block scalars', () => {
    const data = parseFrontmatterBlock(
      [
        'name: x',
        'description: "quoted value"',
        'meta:',
        '  a: 1',
        '  b: two',
        'note: >',
        '  folded line one',
        '  folded line two',
        'literal: |',
        '  kept one',
        '  kept two',
      ].join('\n'),
    );
    expect(data.name).toBe('x');
    expect(data.description).toBe('quoted value');
    expect(data.meta).toEqual({ a: '1', b: 'two' });
    expect(data.note).toBe('folded line one folded line two');
    expect(data.literal).toBe('kept one\nkept two');
  });
});

describe('parseSkillMd', () => {
  it('parses a valid SKILL.md (frontmatter + body, fields normalised)', () => {
    const r = parseSkillMd(VALID, 'pdf-tools');
    expect(r.frontmatter.name).toBe('pdf-tools');
    expect(r.frontmatter.description).toMatch(/Read and edit PDF/);
    expect(r.frontmatter.license).toBe('Apache-2.0');
    expect(r.frontmatter.allowedTools).toEqual(['Bash(git:*)', 'Read']);
    expect(r.frontmatter.metadata).toEqual({ version: '1.2.0', author: 'jane' });
    // Unknown field preserved.
    expect(r.frontmatter.extra['when_to_use']).toBe('when working with PDF documents');
    expect(r.body.trim().startsWith('# PDF tools')).toBe(true);
  });

  /** Capture the thrown ConclaveError so we can assert on code + detail. */
  function detailOf(fn: () => unknown): string {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ConclaveError);
      const ce = err as ConclaveError;
      expect(ce.code).toBe('SKILL-1');
      return ce.detail;
    }
    throw new Error('expected parseSkillMd to throw');
  }

  it('SKILL-1: frontmatter must start on line 1', () => {
    expect(detailOf(() => parseSkillMd('\n---\nname: x\ndescription: y\n---\n'))).toMatch(
      /must begin with a YAML frontmatter/,
    );
  });

  it('SKILL-1: unclosed frontmatter fails loudly', () => {
    expect(detailOf(() => parseSkillMd('---\nname: x\ndescription: y\nbody'))).toMatch(/not closed/);
  });

  it('SKILL-1: missing name fails loudly', () => {
    expect(detailOf(() => parseSkillMd('---\ndescription: y\n---\n'))).toMatch(/missing the required .name/);
  });

  it('SKILL-1: missing description fails loudly', () => {
    expect(detailOf(() => parseSkillMd('---\nname: x\n---\n'))).toMatch(/description/);
  });

  it('SKILL-1: invalid name shape fails loudly', () => {
    expect(detailOf(() => parseSkillMd('---\nname: Bad_Name\ndescription: y\n---\n', 'Bad_Name'))).toMatch(
      /is invalid/,
    );
  });

  it('SKILL-1: name must equal the directory name', () => {
    expect(detailOf(() => parseSkillMd(VALID, 'other-dir'))).toMatch(/does not match its folder/);
  });

  it('SKILL-1: over-long description rejected', () => {
    const long = 'd'.repeat(1025);
    expect(detailOf(() => parseSkillMd(`---\nname: x\ndescription: ${long}\n---\n`, 'x'))).toMatch(
      /exceeds 1024/,
    );
  });

  it('warns on an over-long body (progressive disclosure)', () => {
    const body = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
    const r = parseSkillMd(`---\nname: x\ndescription: y\n---\n${body}`, 'x');
    expect(r.warnings.some((w) => /push detail into references/.test(w))).toBe(true);
  });
});
