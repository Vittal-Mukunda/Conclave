import { describe, it, expect } from 'vitest';
import {
  RunCoordinator,
  findCrashedRuns,
  RunRecord,
  DEFAULT_STALE_MS,
} from '../../src/agent/RunState';

const WS_A = '/home/me/projA';
const WS_B = '/home/me/projB';

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'r1',
    workspaceId: WS_A,
    goal: 'do a thing',
    status: 'running',
    iteration: 1,
    startedAt: 1000,
    heartbeatAt: 1000,
    ...over,
  };
}

describe('RunCoordinator (STATE-3)', () => {
  it('starts the first run for a workspace', () => {
    const c = new RunCoordinator();
    expect(c.begin(WS_A, 'a')).toEqual({ state: 'started' });
    expect(c.activeRun(WS_A)).toBe('a');
  });

  it('queues a second run behind the active one (prevents the race)', () => {
    const c = new RunCoordinator();
    c.begin(WS_A, 'a');
    const r = c.begin(WS_A, 'b');
    expect(r).toEqual({ state: 'queued', ahead: 1, activeRunId: 'a' });
    expect(c.queuedRuns(WS_A)).toEqual(['b']);
  });

  it('is idempotent for the same active run id', () => {
    const c = new RunCoordinator();
    c.begin(WS_A, 'a');
    expect(c.begin(WS_A, 'a')).toEqual({ state: 'started' });
    expect(c.queuedRuns(WS_A)).toEqual([]);
  });

  it('does not couple distinct workspaces (STATE-6)', () => {
    const c = new RunCoordinator();
    c.begin(WS_A, 'a');
    expect(c.begin(WS_B, 'b')).toEqual({ state: 'started' });
  });

  it('promotes the next queued run when the active one ends', () => {
    const c = new RunCoordinator();
    c.begin(WS_A, 'a');
    c.begin(WS_A, 'b');
    c.begin(WS_A, 'c');
    expect(c.end(WS_A, 'a')).toEqual({ next: 'b' });
    expect(c.activeRun(WS_A)).toBe('b');
    expect(c.queuedRuns(WS_A)).toEqual(['c']);
  });

  it('clears the workspace when the last run ends', () => {
    const c = new RunCoordinator();
    c.begin(WS_A, 'a');
    expect(c.end(WS_A, 'a')).toEqual({});
    expect(c.activeRun(WS_A)).toBeUndefined();
  });

  it('ending a queued (non-active) run just removes it from the queue', () => {
    const c = new RunCoordinator();
    c.begin(WS_A, 'a');
    c.begin(WS_A, 'b');
    expect(c.end(WS_A, 'b')).toEqual({});
    expect(c.activeRun(WS_A)).toBe('a');
    expect(c.queuedRuns(WS_A)).toEqual([]);
  });
});

describe('findCrashedRuns (STATE-1/2)', () => {
  const now = 1_000_000;

  it('flags a running row whose heartbeat froze past the stale window', () => {
    const rows = [run({ heartbeatAt: now - DEFAULT_STALE_MS - 1 })];
    const crashed = findCrashedRuns(rows, now);
    expect(crashed).toHaveLength(1);
    expect(crashed[0].run.id).toBe('r1');
  });

  it('excludes a live run (heartbeat within the window)', () => {
    const rows = [run({ heartbeatAt: now - 1000 })];
    expect(findCrashedRuns(rows, now)).toEqual([]);
  });

  it('excludes terminal runs', () => {
    const rows = [
      run({ id: 'done', status: 'completed', heartbeatAt: 0 }),
      run({ id: 'gone', status: 'aborted', heartbeatAt: 0 }),
    ];
    expect(findCrashedRuns(rows, now)).toEqual([]);
  });

  it('marks a run with a checkpoint recoverable, without one not', () => {
    const rows = [
      run({ id: 'withCp', heartbeatAt: 0, checkpointRef: 'sha1' }),
      run({ id: 'noCp', heartbeatAt: 0 }),
    ];
    const crashed = findCrashedRuns(rows, now);
    const byId = Object.fromEntries(crashed.map((c) => [c.run.id, c.recoverable]));
    expect(byId).toEqual({ withCp: true, noCp: false });
  });

  it('returns newest heartbeat first', () => {
    const rows = [
      run({ id: 'old', heartbeatAt: 10 }),
      run({ id: 'new', heartbeatAt: 500 }),
    ];
    expect(findCrashedRuns(rows, now).map((c) => c.run.id)).toEqual(['new', 'old']);
  });
});
