import { describe, it, expect } from 'vitest';
import { ingestSkill, folderHash } from '../../src/skills/ingest';
import { SkillFolderInput } from '../../src/skills/types';

function folder(overrides: Partial<SkillFolderInput> = {}): SkillFolderInput {
  return {
    dirName: 'pdf-tools',
    trust: 'project',
    source: { source: '/repo/.conclave/skills/pdf-tools', sourceType: 'local-project' },
    files: {
      'SKILL.md': `---
name: pdf-tools
description: Read and edit PDF files. Use when the user mentions a .pdf file.
metadata:
  globs: "**/*.pdf *.pdf"
---
# PDF tools
See references/forms.md and run scripts/extract.py.
`,
      'references/forms.md': '# forms',
      'scripts/extract.py': 'print(1)',
    },
    ...overrides,
  };
}

describe('ingestSkill', () => {
  it('ingests a valid skill with references, globs and a content hash', () => {
    const r = ingestSkill(folder());
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.skill.name).toBe('pdf-tools');
    expect(r.skill.references).toEqual(['references/forms.md', 'scripts/extract.py']);
    expect(r.skill.missingReferences).toEqual([]);
    expect(r.skill.globs).toEqual(expect.arrayContaining(['**/*.pdf', '*.pdf']));
    expect(r.skill.contentHash).toMatch(/^[0-9a-f]+-\d+$/);
    expect(r.skill.trust).toBe('project');
    // project tier may run scripts; community may not.
    expect(r.skill.scriptsEnabled).toBe(true);
  });

  it('SKILL-8: a missing referenced file is a graceful note, not a failure', () => {
    const f = folder();
    delete f.files['references/forms.md'];
    const r = ingestSkill(f);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.skill.missingReferences).toContain('references/forms.md');
    expect(r.skill.warnings.some((w) => /SKILL-8/.test(w))).toBe(true);
  });

  it('SKILL-1: name != directory quarantines the skill (fails loudly)', () => {
    const r = ingestSkill(folder({ dirName: 'wrong-dir' }));
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error.code).toBe('SKILL-1');
    expect(r.dirName).toBe('wrong-dir');
  });

  it('SKILL-1: missing SKILL.md entry point fails', () => {
    const r = ingestSkill(folder({ files: { 'README.md': 'nope' } }));
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error.code).toBe('SKILL-1');
  });

  it('community skills default to scripts disabled (instructions-only)', () => {
    const r = ingestSkill(
      folder({ trust: 'community', source: { source: 'owner/repo', sourceType: 'git' } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.skill.scriptsEnabled).toBe(false);
  });

  it('folderHash is order-independent and content-sensitive', () => {
    const a = folderHash({ 'a.txt': '1', 'b.txt': '2' });
    const b = folderHash({ 'b.txt': '2', 'a.txt': '1' });
    const c = folderHash({ 'a.txt': '1', 'b.txt': '3' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
