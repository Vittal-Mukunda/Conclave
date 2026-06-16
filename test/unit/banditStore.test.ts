import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { latestVersion } from '../../src/storage/migrations';
import { BanditStore } from '../../src/learn/BanditStore';
import { ArmState } from '../../src/learn/LinUCB';

const WS_A = '/home/me/projA';
const WS_B = '/home/me/projB';

function arm(n: number): ArmState {
  return { A: [[2, 0], [0, 2]], b: [0.5, 0.25], n };
}

describe('BanditStore', () => {
  it('migration v5 is the latest schema version', () => {
    expect(latestVersion()).toBe(5);
    const store = new BanditStore(Storage.memory().db);
    expect(store.load(WS_A)).toEqual([]);
  });

  it('saves and loads arm state', () => {
    const store = new BanditStore(Storage.memory().db);
    store.save(WS_A, 'p/m', arm(3), 1500, 100);
    const loaded = store.load(WS_A);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].arm).toBe('p/m');
    expect(loaded[0].state.A).toEqual([[2, 0], [0, 2]]);
    expect(loaded[0].state.b).toEqual([0.5, 0.25]);
    expect(loaded[0].state.n).toBe(3);
    expect(loaded[0].rho).toBe(1500);
  });

  it('upserts latest state for an arm', () => {
    const store = new BanditStore(Storage.memory().db);
    store.save(WS_A, 'p/m', arm(1), 0, 100);
    store.save(WS_A, 'p/m', arm(9), 42, 200);
    const loaded = store.load(WS_A);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].state.n).toBe(9);
    expect(loaded[0].rho).toBe(42);
  });

  it('scopes arms per workspace (STATE-6)', () => {
    const store = new BanditStore(Storage.memory().db);
    store.save(WS_A, 'p/m', arm(1));
    store.save(WS_B, 'p/m', arm(2));
    expect(store.load(WS_A)[0].state.n).toBe(1);
    expect(store.load(WS_B)[0].state.n).toBe(2);
  });

  it('skips a corrupt row instead of throwing', () => {
    const s = Storage.memory();
    const store = new BanditStore(s.db);
    store.save(WS_A, 'good', arm(1), 0, 100);
    s.db.run(
      `INSERT INTO bandit (workspace_id, arm, dim, a_mat, b_vec, n, rho, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [WS_A, 'broken', 2, '{not json', '[]', 0, 0, 100],
    );
    const loaded = store.load(WS_A);
    expect(loaded.map((a) => a.arm)).toEqual(['good']);
  });
});
