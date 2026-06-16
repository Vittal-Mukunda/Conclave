import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { latestVersion } from '../../src/storage/migrations';
import { SkillStore } from '../../src/skills/SkillStore';
import { ingestSkill } from '../../src/skills/ingest';
import { Skill } from '../../src/skills/types';

function sampleSkill(name = 'pdf-tools'): Skill {
  const r = ingestSkill({
    dirName: name,
    trust: 'project',
    source: { source: `/repo/.conclave/skills/${name}`, sourceType: 'local-project' },
    files: {
      'SKILL.md': `---\nname: ${name}\ndescription: Read PDF files.\nmetadata:\n  globs: "*.pdf"\n---\nbody`,
    },
  });
  if (!r.ok) {
    throw new Error('fixture failed');
  }
  return r.skill;
}

describe('SkillStore', () => {
  it('skill table (migration v6) is queryable at the latest schema version', () => {
    expect(latestVersion()).toBe(7);
    const store = new SkillStore(Storage.memory().db);
    expect(store.all()).toEqual([]);
  });

  it('saves and reloads a skill (content-addressed)', () => {
    const store = new SkillStore(Storage.memory().db);
    const s = sampleSkill();
    store.save(s);
    const loaded = store.all();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('pdf-tools');
    expect(loaded[0].description).toBe('Read PDF files.');
    expect(loaded[0].globs).toEqual(['*.pdf']);
    expect(loaded[0].contentHash).toBe(s.contentHash);
  });

  it('upsert by (name, source): re-saving updates the hash', () => {
    const store = new SkillStore(Storage.memory().db);
    store.save(sampleSkill());
    expect(store.hashOf('pdf-tools', '/repo/.conclave/skills/pdf-tools')).toBeDefined();
    // A changed body yields a new hash on the same key.
    const changed = ingestSkill({
      dirName: 'pdf-tools',
      trust: 'project',
      source: { source: '/repo/.conclave/skills/pdf-tools', sourceType: 'local-project' },
      files: { 'SKILL.md': `---\nname: pdf-tools\ndescription: Read PDF files.\n---\nNEW body` },
    });
    if (!changed.ok) {
      throw new Error('changed fixture failed');
    }
    store.save(changed.skill);
    expect(store.all()).toHaveLength(1);
    expect(store.hashOf('pdf-tools', '/repo/.conclave/skills/pdf-tools')).toBe(changed.skill.contentHash);
  });

  it('persists across instances on the same db', () => {
    const db = Storage.memory().db;
    new SkillStore(db).save(sampleSkill());
    expect(new SkillStore(db).all()).toHaveLength(1);
  });

  it('lock() lists content-addressed entries for reproducibility', () => {
    const store = new SkillStore(Storage.memory().db);
    store.save(sampleSkill('a-skill'));
    store.save(sampleSkill('b-skill'));
    const lock = store.lock();
    expect(lock.map((e) => e.name)).toEqual(['a-skill', 'b-skill']);
    expect(lock[0].computedHash).toMatch(/^[0-9a-f]+-\d+$/);
    expect(lock[0].sourceType).toBe('local-project');
  });

  it('remove deletes a skill from the index', () => {
    const store = new SkillStore(Storage.memory().db);
    const s = sampleSkill();
    store.save(s);
    store.remove(s.name, s.source.source);
    expect(store.all()).toEqual([]);
  });
});
