import { describe, it, expect } from 'vitest';
import { ingestSkill } from '../../src/skills/ingest';
import { SkillRetriever, RetrievalConfig, DEFAULT_RETRIEVAL_CONFIG } from '../../src/skills/Retriever';
import { Skill, TrustTier } from '../../src/skills/types';

function makeSkill(
  name: string,
  description: string,
  opts: { globs?: string; trust?: TrustTier; bodyLines?: number } = {},
): Skill {
  const globLine = opts.globs ? `metadata:\n  globs: "${opts.globs}"\n` : '';
  const body = opts.bodyLines
    ? Array.from({ length: opts.bodyLines }, (_, i) => `line ${i}`).join('\n')
    : 'short body';
  const r = ingestSkill({
    dirName: name,
    trust: opts.trust ?? 'project',
    source: { source: `/repo/.conclave/skills/${name}`, sourceType: 'local-project' },
    files: { 'SKILL.md': `---\nname: ${name}\ndescription: ${description}\n${globLine}---\n${body}` },
  });
  if (!r.ok) {
    throw new Error(`fixture skill ${name} failed to ingest: ${r.error.detail}`);
  }
  return r.skill;
}

describe('SkillRetriever', () => {
  const pdf = makeSkill('pdf-tools', 'Read and edit PDF documents and extract tables from PDFs.');
  const sql = makeSkill('sql-helper', 'Write and optimize SQL queries for data warehouses.');
  const react = makeSkill('react-style', 'React component conventions and hooks lint rules.');

  it('ranks the description-matching skill first (description is primary)', () => {
    const r = new SkillRetriever().retrieve([pdf, sql, react], {
      taskText: 'extract a table from this PDF document',
    });
    expect(r.active[0].name).toBe('pdf-tools');
  });

  it('drops skills below the activation threshold', () => {
    const r = new SkillRetriever().retrieve([pdf, sql, react], {
      taskText: 'optimize my slow SQL query',
    });
    expect(r.active.map((s) => s.name)).toContain('sql-helper');
    expect(r.active.map((s) => s.name)).not.toContain('pdf-tools');
    expect(r.dropped.some((d) => d.skill.name === 'pdf-tools' && d.reason === 'below-threshold')).toBe(
      true,
    );
  });

  it('file-glob match boosts a skill for changed files', () => {
    const styled = makeSkill('ts-style', 'TypeScript style guide.', { globs: 'src/**/*.ts' });
    const r = new SkillRetriever().retrieve([styled, pdf], {
      taskText: 'make a change',
      changedGlobs: ['src/api/handler.ts'],
    });
    expect(r.active[0].name).toBe('ts-style');
    expect(r.ranked.find((s) => s.skill.name === 'ts-style')!.signals.glob).toBe(1);
  });

  it('SKILL-5: caps active skills at maxActive and reports the overflow', () => {
    const cfg: RetrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG, threshold: 0, maxActive: 2 };
    const r = new SkillRetriever(cfg).retrieve([pdf, sql, react], { taskText: 'pdf sql react' });
    expect(r.active).toHaveLength(2);
    expect(r.dropped.some((d) => d.reason === 'over-cap')).toBe(true);
  });

  it('SKILL-5: enforces the combined token budget', () => {
    const big = makeSkill('big-skill', 'huge body skill for everything', { bodyLines: 4000 });
    const cfg: RetrievalConfig = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      threshold: 0,
      maxActive: 5,
      tokenBudget: 100,
    };
    const r = new SkillRetriever(cfg).retrieve([big, sql], { taskText: 'sql query' });
    // big-skill's body blows the budget — sql-helper (small) still fits.
    expect(r.active.map((s) => s.name)).toContain('sql-helper');
    expect(r.dropped.some((d) => d.skill.name === 'big-skill' && d.reason === 'over-budget')).toBe(
      true,
    );
  });

  it('trust precedence breaks ties (user/project > community)', () => {
    const a = makeSkill('dup-a', 'identical helper for the same generic task', { trust: 'community' });
    const b = makeSkill('dup-b', 'identical helper for the same generic task', { trust: 'user' });
    const cfg: RetrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG, threshold: 0 };
    const r = new SkillRetriever(cfg).retrieve([a, b], { taskText: 'identical helper generic task' });
    expect(r.active[0].name).toBe('dup-b');
  });
});
