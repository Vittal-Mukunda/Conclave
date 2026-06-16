import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { latestVersion } from '../../src/storage/migrations';
import { RepoMemory, RepoMemoryKeys } from '../../src/editing/RepoMemory';

const WS_A = '/home/me/projA';
const WS_B = '/home/me/projB';

describe('RepoMemory', () => {
  it('migration v4 is the latest schema version', () => {
    expect(latestVersion()).toBe(4);
    // Storage.memory() runs all migrations; repo_memory must be queryable.
    const m = new RepoMemory(Storage.memory().db);
    expect(m.all(WS_A)).toEqual([]);
  });

  it('VER-6: stores and reads back the test command', () => {
    const m = new RepoMemory(Storage.memory().db);
    m.set(WS_A, RepoMemoryKeys.TestCommand, 'npm test', 100);
    expect(m.get(WS_A, RepoMemoryKeys.TestCommand)).toBe('npm test');
  });

  it('upsert: latest write wins', () => {
    const m = new RepoMemory(Storage.memory().db);
    m.set(WS_A, RepoMemoryKeys.TestCommand, 'old', 100);
    m.set(WS_A, RepoMemoryKeys.TestCommand, 'new', 200);
    expect(m.get(WS_A, RepoMemoryKeys.TestCommand)).toBe('new');
    expect(m.all(WS_A)).toHaveLength(1);
  });

  it('STATE-6: facts are scoped per workspace', () => {
    const m = new RepoMemory(Storage.memory().db);
    m.set(WS_A, RepoMemoryKeys.TestCommand, 'pytest', 1);
    m.set(WS_B, RepoMemoryKeys.TestCommand, 'go test ./...', 2);
    expect(m.get(WS_A, RepoMemoryKeys.TestCommand)).toBe('pytest');
    expect(m.get(WS_B, RepoMemoryKeys.TestCommand)).toBe('go test ./...');
    expect(m.all(WS_A)).toHaveLength(1);
  });

  it('delete forgets a fact', () => {
    const m = new RepoMemory(Storage.memory().db);
    m.set(WS_A, RepoMemoryKeys.TestCommand, 'npm test', 1);
    m.delete(WS_A, RepoMemoryKeys.TestCommand);
    expect(m.get(WS_A, RepoMemoryKeys.TestCommand)).toBeUndefined();
  });

  it('persists across instances on the same db', () => {
    const db = Storage.memory().db;
    new RepoMemory(db).set(WS_A, RepoMemoryKeys.BuildCommand, 'npm run build', 1);
    expect(new RepoMemory(db).get(WS_A, RepoMemoryKeys.BuildCommand)).toBe('npm run build');
  });

  it('all() returns facts newest first', () => {
    const m = new RepoMemory(Storage.memory().db);
    m.set(WS_A, RepoMemoryKeys.TestCommand, 't', 100);
    m.set(WS_A, RepoMemoryKeys.BuildCommand, 'b', 200);
    expect(m.all(WS_A).map((f) => f.key)).toEqual([RepoMemoryKeys.BuildCommand, RepoMemoryKeys.TestCommand]);
  });
});
