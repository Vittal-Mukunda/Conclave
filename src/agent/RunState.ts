// Phase 19 — state, crash recovery & concurrency. Pure control types and logic
// for persisting an in-flight agent run, recovering one orphaned by a reload /
// crash, and preventing two runs from racing the same workspace. Zero vscode /
// SQLite dependency so every STATE-* path is unit-testable with fakes; the host
// wires the SQLite store (RunStateStore) and the vscode glue (AgentService).
//
//   STATE-1 reload mid-task -> resume from the last checkpoint
//   STATE-2 VS Code crash   -> detect the orphaned run; resume-or-discard
//   STATE-3 two runs        -> coordinator queues/prevents the second
//   STATE-6 multi-root      -> everything is scoped by workspace id

export type RunStatus = 'running' | 'completed' | 'aborted';

/** A persisted agent run. The heartbeat is bumped each iteration; a frozen
 * heartbeat on a 'running' row is how a crash is detected (STATE-2). */
export interface RunRecord {
  id: string;
  workspaceId: string;
  goal: string;
  status: RunStatus;
  /** Iterations completed so far (resume point hint). */
  iteration: number;
  /** Last checkpoint to resume-from / roll-back-to (STATE-1). Undefined = nothing committed yet. */
  checkpointRef?: string;
  startedAt: number;
  heartbeatAt: number;
}

/** How long a 'running' row may go without a heartbeat before it's deemed
 * crashed. Generous vs. the per-iteration heartbeat cadence to avoid flagging a
 * slow-but-live run. */
export const DEFAULT_STALE_MS = 60_000;

// --- STATE-3: in-process run coordinator -------------------------------------

export type BeginResult =
  | { state: 'started' }
  | { state: 'queued'; ahead: number; activeRunId: string };

/**
 * At most one active agent run per workspace; further requests queue FIFO
 * behind it (STATE-3 "queue/prevent"). In-process — a single extension host owns
 * one coordinator, so this is the authoritative concurrency gate within a
 * session; cross-session/crash races are caught by the persisted heartbeat
 * (STATE-2), not here. Pure and timer-free: the caller drives begin/end.
 */
export class RunCoordinator {
  private readonly activeByWs = new Map<string, string>();
  private readonly queueByWs = new Map<string, string[]>();

  /** Claim the workspace for `runId`, or queue behind whatever holds it. */
  begin(workspaceId: string, runId: string): BeginResult {
    const active = this.activeByWs.get(workspaceId);
    if (active === undefined || active === runId) {
      this.activeByWs.set(workspaceId, runId);
      return { state: 'started' };
    }
    const queue = this.queueByWs.get(workspaceId) ?? [];
    if (!queue.includes(runId)) {
      queue.push(runId);
      this.queueByWs.set(workspaceId, queue);
    }
    return { state: 'queued', ahead: queue.indexOf(runId) + 1, activeRunId: active };
  }

  /** Release `runId`. Returns the promoted next run id if the queue advances. */
  end(workspaceId: string, runId: string): { next?: string } {
    const active = this.activeByWs.get(workspaceId);
    if (active !== runId) {
      // Not active — just drop it from the queue if present.
      this.dropFromQueue(workspaceId, runId);
      return {};
    }
    const queue = this.queueByWs.get(workspaceId) ?? [];
    const next = queue.shift();
    if (next === undefined) {
      this.activeByWs.delete(workspaceId);
      this.queueByWs.delete(workspaceId);
      return {};
    }
    this.activeByWs.set(workspaceId, next);
    if (queue.length === 0) {
      this.queueByWs.delete(workspaceId);
    } else {
      this.queueByWs.set(workspaceId, queue);
    }
    return { next };
  }

  activeRun(workspaceId: string): string | undefined {
    return this.activeByWs.get(workspaceId);
  }

  queuedRuns(workspaceId: string): string[] {
    return [...(this.queueByWs.get(workspaceId) ?? [])];
  }

  private dropFromQueue(workspaceId: string, runId: string): void {
    const queue = this.queueByWs.get(workspaceId);
    if (!queue) {
      return;
    }
    const next = queue.filter((id) => id !== runId);
    if (next.length === 0) {
      this.queueByWs.delete(workspaceId);
    } else {
      this.queueByWs.set(workspaceId, next);
    }
  }
}

// --- STATE-1 / STATE-2: crash recovery ---------------------------------------

export interface RecoveryCandidate {
  run: RunRecord;
  /** A checkpoint exists, so the tree can be resumed-from / rolled-back-to (STATE-1). */
  recoverable: boolean;
}

/**
 * Of the persisted 'running' rows, which are actually orphaned by a crash/reload
 * (STATE-2) — i.e. their heartbeat froze past the stale window. The live run (if
 * any) heartbeats within the window and is excluded so we never offer to recover
 * a run that's still going. Newest first. A row with a checkpoint is
 * `recoverable` (resume or clean rollback); one without can only be discarded.
 */
export function findCrashedRuns(
  rows: RunRecord[],
  now: number,
  staleMs = DEFAULT_STALE_MS,
): RecoveryCandidate[] {
  return rows
    .filter((r) => r.status === 'running' && now - r.heartbeatAt > staleMs)
    .sort((a, b) => b.heartbeatAt - a.heartbeatAt)
    .map((run) => ({ run, recoverable: run.checkpointRef !== undefined }));
}
