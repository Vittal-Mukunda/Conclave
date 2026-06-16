import { SqlDb } from '../storage/SqlDb';
import { RunRecord, RunStatus } from './RunState';

// Persists agent runs (migration v7 `agent_run` table) so a run survives a
// reload (STATE-1) and an orphaned one survives a crash to be recovered
// (STATE-2). Scoped by workspace_id (STATE-6). A corrupt/garbage row is skipped,
// never fatal (STATE-4 pattern) — a run we can't parse just isn't offered for
// recovery.

interface RunRow {
  id: string;
  workspace_id: string;
  goal: string;
  status: string;
  iteration: number;
  checkpoint_ref: string | null;
  started_at: number;
  heartbeat_at: number;
}

const VALID_STATUS: ReadonlySet<string> = new Set<RunStatus>(['running', 'completed', 'aborted']);

function toRecord(r: RunRow): RunRecord | undefined {
  if (!r.id || !r.workspace_id || !VALID_STATUS.has(r.status)) {
    return undefined; // unparseable / unknown status -> skip (STATE-4)
  }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    goal: r.goal,
    status: r.status as RunStatus,
    iteration: r.iteration,
    checkpointRef: r.checkpoint_ref ?? undefined,
    startedAt: r.started_at,
    heartbeatAt: r.heartbeat_at,
  };
}

export class RunStateStore {
  constructor(private readonly db: SqlDb) {}

  /** Record a run as started (status 'running'), or reset an existing id to running. */
  begin(record: RunRecord): void {
    this.db.run(
      `INSERT INTO agent_run (id, workspace_id, goal, status, iteration, checkpoint_ref, started_at, heartbeat_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id = excluded.workspace_id, goal = excluded.goal, status = excluded.status,
         iteration = excluded.iteration, checkpoint_ref = excluded.checkpoint_ref,
         started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at`,
      [
        record.id,
        record.workspaceId,
        record.goal,
        record.status,
        record.iteration,
        record.checkpointRef ?? null,
        record.startedAt,
        record.heartbeatAt,
      ],
    );
  }

  /** Bump liveness + progress for a running row (STATE-1 resume point / STATE-2 liveness). */
  heartbeat(id: string, now: number, iteration?: number, checkpointRef?: string): void {
    this.db.run(
      `UPDATE agent_run
         SET heartbeat_at = ?,
             iteration = COALESCE(?, iteration),
             checkpoint_ref = COALESCE(?, checkpoint_ref)
       WHERE id = ? AND status = 'running'`,
      [now, iteration ?? null, checkpointRef ?? null, id],
    );
  }

  /** Mark a run terminal so it's no longer a recovery candidate. */
  finish(id: string, status: Exclude<RunStatus, 'running'>, now = Date.now()): void {
    this.db.run('UPDATE agent_run SET status = ?, heartbeat_at = ? WHERE id = ?', [status, now, id]);
  }

  get(id: string): RunRecord | undefined {
    const row = this.db.get<RunRow>('SELECT * FROM agent_run WHERE id = ?', [id]);
    return row ? toRecord(row) : undefined;
  }

  /** All 'running' rows for a workspace (recovery candidates before staleness filtering). */
  running(workspaceId: string): RunRecord[] {
    return this.db
      .all<RunRow>(
        "SELECT * FROM agent_run WHERE workspace_id = ? AND status = 'running' ORDER BY heartbeat_at DESC",
        [workspaceId],
      )
      .map(toRecord)
      .filter((r): r is RunRecord => r !== undefined);
  }

  delete(id: string): void {
    this.db.run('DELETE FROM agent_run WHERE id = ?', [id]);
  }
}
