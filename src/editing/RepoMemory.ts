import { SqlDb } from '../storage/SqlDb';

// Per-workspace key/value facts conclave learns and should not re-ask: the
// detected test command (VER-6 "ask ONCE; remember in repo memory"), build
// command, etc. Scoped by workspace id so a multi-root / multi-project user
// never leaks one repo's settings into another (STATE-6). Persisted in the
// `repo_memory` table (migration v4) so it survives reloads.

/** Well-known keys. Free-form keys are allowed; these are the ones conclave sets. */
export const RepoMemoryKeys = {
  TestCommand: 'test.command',
  BuildCommand: 'build.command',
} as const;

export interface RepoFact {
  key: string;
  value: string;
  updatedAt: number;
}

interface FactRow {
  key: string;
  value: string;
  updated_at: number;
}

export class RepoMemory {
  constructor(private readonly db: SqlDb) {}

  /** Read one fact for a workspace, or undefined if unset (STATE-6 scoped). */
  get(workspaceId: string, key: string): string | undefined {
    const row = this.db.get<FactRow>(
      'SELECT value FROM repo_memory WHERE workspace_id = ? AND key = ?',
      [workspaceId, key],
    );
    return row?.value;
  }

  /** Upsert a fact (latest write wins), stamping the update time. */
  set(workspaceId: string, key: string, value: string, now = Date.now()): void {
    this.db.run(
      `INSERT INTO repo_memory (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [workspaceId, key, value, now],
    );
  }

  /** Forget a fact (e.g. the remembered test command was wrong). */
  delete(workspaceId: string, key: string): void {
    this.db.run('DELETE FROM repo_memory WHERE workspace_id = ? AND key = ?', [workspaceId, key]);
  }

  /** All facts for one workspace, newest first. */
  all(workspaceId: string): RepoFact[] {
    return this.db
      .all<FactRow>(
        'SELECT key, value, updated_at FROM repo_memory WHERE workspace_id = ? ORDER BY updated_at DESC',
        [workspaceId],
      )
      .map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  }
}
