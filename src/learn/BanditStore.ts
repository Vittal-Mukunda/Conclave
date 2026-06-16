import { SqlDb } from '../storage/SqlDb';
import { ArmState } from './LinUCB';

// Persists LinUCB arm state per workspace (migration v5 `bandit` table). A and b
// are stored as JSON; the learner hydrates them on startup and writes them back
// after each update so competence accrues across sessions. Scoped by
// workspace_id (STATE-6) so repos never share learned weights.

export interface PersistedArm {
  arm: string;
  state: ArmState;
  rho?: number;
}

interface BanditRow {
  arm: string;
  dim: number;
  a_mat: string;
  b_vec: string;
  n: number;
  rho: number;
}

export class BanditStore {
  constructor(private readonly db: SqlDb) {}

  /** All persisted arms for a workspace. */
  load(workspaceId: string): PersistedArm[] {
    const rows = this.db.all<BanditRow>(
      'SELECT arm, dim, a_mat, b_vec, n, rho FROM bandit WHERE workspace_id = ?',
      [workspaceId],
    );
    const out: PersistedArm[] = [];
    for (const r of rows) {
      try {
        const A = JSON.parse(r.a_mat) as number[][];
        const b = JSON.parse(r.b_vec) as number[];
        out.push({ arm: r.arm, state: { A, b, n: r.n }, rho: r.rho });
      } catch {
        // A corrupt row is skipped, not fatal — the arm just warm-starts fresh.
      }
    }
    return out;
  }

  /** Upsert one arm's state. */
  save(workspaceId: string, arm: string, state: ArmState, rho = 0, now = Date.now()): void {
    this.db.run(
      `INSERT INTO bandit (workspace_id, arm, dim, a_mat, b_vec, n, rho, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(workspace_id, arm) DO UPDATE SET
         dim = excluded.dim, a_mat = excluded.a_mat, b_vec = excluded.b_vec,
         n = excluded.n, rho = excluded.rho, updated_at = excluded.updated_at`,
      [workspaceId, arm, state.b.length, JSON.stringify(state.A), JSON.stringify(state.b), state.n, rho, now],
    );
  }
}
