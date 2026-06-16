import { SqlDb } from './SqlDb';

// Versioned schema migrations (STATE-5). user_version tracks the applied version;
// pending migrations run in order, each in a transaction, losing nothing on
// upgrade. Never edit a shipped migration — add a new one.

export interface Migration {
  version: number;
  up: (db: SqlDb) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          kind TEXT,
          published_rpm INTEGER,
          published_tpm INTEGER,
          published_rpd INTEGER,
          probed_rpm INTEGER,
          probed_tpm INTEGER,
          latency_ms REAL DEFAULT 0,
          throughput_tps REAL DEFAULT 0,
          success INTEGER DEFAULT 0,
          errors INTEGER DEFAULT 0,
          rate_limits INTEGER DEFAULT 0,
          benchmark_prior REAL DEFAULT 0,
          available INTEGER DEFAULT 1,
          last_probed INTEGER DEFAULT 0,
          input_price REAL DEFAULT 0,
          output_price REAL DEFAULT 0,
          PRIMARY KEY (provider, model)
        );
        CREATE TABLE IF NOT EXISTS call (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          stage TEXT,
          tokens_in INTEGER DEFAULT 0,
          tokens_out INTEGER DEFAULT 0,
          latency_ms REAL DEFAULT 0,
          ok INTEGER DEFAULT 1,
          status TEXT,
          cost_usd REAL DEFAULT 0,
          saved_usd REAL DEFAULT 0,
          estimated INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_call_model ON call(provider, model);
        CREATE TABLE IF NOT EXISTS quota (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          window TEXT NOT NULL,
          used REAL DEFAULT 0,
          reset_at INTEGER DEFAULT 0,
          lim REAL,
          PRIMARY KEY (provider, model, window)
        );
      `);
    },
  },
  {
    version: 2,
    // Additive column proving upgrades preserve existing rows.
    up: (db) => {
      db.exec(`ALTER TABLE model ADD COLUMN region TEXT;`);
    },
  },
];

export function latestVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}

/** Apply all pending migrations. Returns the resulting schema version. */
export function runMigrations(db: SqlDb): number {
  const current = db.userVersion();
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.transaction(() => m.up(db));
    db.setUserVersion(m.version);
  }
  return db.userVersion();
}
