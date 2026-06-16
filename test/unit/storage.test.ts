import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { openDatabase } from '../../src/storage/SqlDb';
import { MIGRATIONS, runMigrations, latestVersion } from '../../src/storage/migrations';
import { Storage } from '../../src/storage/Storage';
import { TelemetryStore } from '../../src/telemetry/TelemetryStore';

describe('storage + migrations (STATE-5)', () => {
  it('opens in memory and reaches the latest schema version', () => {
    const s = Storage.memory();
    expect(s.version).toBe(latestVersion());
    s.close();
  });

  it('migrates incrementally and preserves existing rows', () => {
    const db = openDatabase(':memory:');
    // Apply only v1, insert a row, then upgrade.
    MIGRATIONS[0].up(db);
    db.setUserVersion(1);
    db.run('INSERT INTO model (provider, model) VALUES (?,?)', ['groq', 'm1']);
    expect(db.userVersion()).toBe(1);

    const v = runMigrations(db);
    expect(v).toBe(latestVersion());

    const row = db.get<{ model: string; region: string | null }>(
      'SELECT model, region FROM model WHERE provider = ?',
      ['groq'],
    );
    expect(row?.model).toBe('m1'); // preserved across the upgrade
    expect(row && 'region' in row).toBe(true); // new column added

    // v3 seeds a single-row budget with safe defaults.
    const budget = db.get<{ cap_usd: number | null; mode: string }>('SELECT cap_usd, mode FROM budget WHERE id = 1');
    expect(budget).toMatchObject({ cap_usd: null, mode: 'free-only' });
    db.close();
  });

  it('persists across reopen (reload)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-'));
    try {
      const s1 = Storage.open(dir);
      new TelemetryStore(s1.db).record({
        ts: 1,
        provider: 'groq',
        model: 'm',
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 100,
        ok: true,
        status: 'ok',
        costUsd: 0,
        savedUsd: 0.001,
        estimated: false,
      });
      s1.close();

      const s2 = Storage.open(dir);
      expect(new TelemetryStore(s2.db).totals().calls).toBe(1);
      s2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
