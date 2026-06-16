import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Storage } from '../../src/storage/Storage';
import { latestVersion } from '../../src/storage/migrations';
import { RunStateStore } from '../../src/agent/RunStateStore';
import { RunRecord, findCrashedRuns } from '../../src/agent/RunState';

const WS_A = '/home/me/projA';
const WS_B = '/home/me/projB';

function rec(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'r1',
    workspaceId: WS_A,
    goal: 'add a feature',
    status: 'running',
    iteration: 0,
    startedAt: 1000,
    heartbeatAt: 1000,
    ...over,
  };
}

describe('RunStateStore (STATE-1/2)', () => {
  it('agent_run table is queryable at the latest schema version (v7)', () => {
    expect(latestVersion()).toBe(7);
    const store = new RunStateStore(Storage.memory().db);
    expect(store.running(WS_A)).toEqual([]);
  });

  it('persists a started run and reads it back', () => {
    const store = new RunStateStore(Storage.memory().db);
    store.begin(rec());
    const got = store.get('r1');
    expect(got?.goal).toBe('add a feature');
    expect(got?.status).toBe('running');
    expect(store.running(WS_A).map((r) => r.id)).toEqual(['r1']);
  });

  it('heartbeat bumps liveness, iteration and checkpoint for a running row', () => {
    const store = new RunStateStore(Storage.memory().db);
    store.begin(rec());
    store.heartbeat('r1', 5000, 2, 'sha-abc');
    const got = store.get('r1')!;
    expect(got.heartbeatAt).toBe(5000);
    expect(got.iteration).toBe(2);
    expect(got.checkpointRef).toBe('sha-abc');
  });

  it('heartbeat is a no-op once a run is terminal', () => {
    const store = new RunStateStore(Storage.memory().db);
    store.begin(rec());
    store.finish('r1', 'completed', 4000);
    store.heartbeat('r1', 9000, 9, 'sha-x');
    const got = store.get('r1')!;
    expect(got.status).toBe('completed');
    expect(got.iteration).toBe(0); // unchanged — terminal rows don't heartbeat
  });

  it('finish removes a run from the recovery set', () => {
    const store = new RunStateStore(Storage.memory().db);
    store.begin(rec({ heartbeatAt: 0 }));
    expect(findCrashedRuns(store.running(WS_A), 1_000_000)).toHaveLength(1);
    store.finish('r1', 'aborted');
    expect(store.running(WS_A)).toEqual([]);
  });

  it('scopes runs per workspace (STATE-6)', () => {
    const store = new RunStateStore(Storage.memory().db);
    store.begin(rec({ id: 'a', workspaceId: WS_A }));
    store.begin(rec({ id: 'b', workspaceId: WS_B }));
    expect(store.running(WS_A).map((r) => r.id)).toEqual(['a']);
    expect(store.running(WS_B).map((r) => r.id)).toEqual(['b']);
  });

  it('skips a corrupt row (unknown status) instead of returning it (STATE-4)', () => {
    const s = Storage.memory();
    const store = new RunStateStore(s.db);
    store.begin(rec({ id: 'good' }));
    s.db.run(
      `INSERT INTO agent_run (id, workspace_id, goal, status, iteration, checkpoint_ref, started_at, heartbeat_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['broken', WS_A, 'x', 'bogus-status', 0, null, 1000, 1000],
    );
    expect(store.running(WS_A).map((r) => r.id)).toEqual(['good']);
  });

  it('survives a reload — an orphaned run is recoverable from a reopened db (STATE-2)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-run-'));
    try {
      const s1 = Storage.open(dir);
      new RunStateStore(s1.db).begin(rec({ id: 'crashy', checkpointRef: 'sha-1', heartbeatAt: 0 }));
      s1.close(); // simulates a crash — the row stays 'running'

      const s2 = Storage.open(dir);
      const crashed = findCrashedRuns(new RunStateStore(s2.db).running(WS_A), 1_000_000);
      expect(crashed).toHaveLength(1);
      expect(crashed[0].run.id).toBe('crashy');
      expect(crashed[0].recoverable).toBe(true);
      s2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
