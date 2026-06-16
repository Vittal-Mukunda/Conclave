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
  {
    version: 3,
    // Phase 5: single-row budget/spend state (cap, running spend, cost mode,
    // last warned threshold) — survives reloads so spend guards persist.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS budget (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          cap_usd REAL,
          spent_usd REAL DEFAULT 0,
          mode TEXT DEFAULT 'free-only',
          warned_level INTEGER DEFAULT 0,
          period_start INTEGER DEFAULT 0
        );
        INSERT OR IGNORE INTO budget (id, cap_usd, spent_usd, mode, warned_level, period_start)
          VALUES (1, NULL, 0, 'free-only', 0, 0);
      `);
    },
  },
  {
    version: 4,
    // Phase 8: per-workspace repo memory (test/build command and other learned
    // facts). Scoped by workspace_id so settings never leak across repos
    // (STATE-6); survives reloads so conclave doesn't re-ask (VER-6).
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repo_memory (
          workspace_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER DEFAULT 0,
          PRIMARY KEY (workspace_id, key)
        );
      `);
    },
  },
  {
    version: 5,
    // Phase 12: per-workspace contextual-bandit (LinUCB) arm state — the ridge
    // matrix A and vector b per model, the observation count, and an EWMA of
    // token consumption (rho) feeding pricedCost. Scoped by workspace_id so one
    // repo's learned competence never bleeds into another (STATE-6). Survives
    // reloads so the learner keeps improving across sessions.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bandit (
          workspace_id TEXT NOT NULL,
          arm TEXT NOT NULL,
          dim INTEGER NOT NULL,
          a_mat TEXT NOT NULL,
          b_vec TEXT NOT NULL,
          n INTEGER DEFAULT 0,
          rho REAL DEFAULT 0,
          updated_at INTEGER DEFAULT 0,
          PRIMARY KEY (workspace_id, arm)
        );
      `);
    },
  },
  {
    version: 6,
    // Phase 16: the content-addressed skills index. One row per ingested skill,
    // keyed by (name, source) so the same skill from two sources is distinct.
    // `content_hash` is the git-tree/folder hash for reproducible re-scans and
    // change detection; the body + frontmatter are cached so retrieval can score
    // without re-reading disk. Not workspace-scoped — installed skills are shared.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS skill (
          name TEXT NOT NULL,
          source TEXT NOT NULL,
          source_type TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          trust TEXT NOT NULL,
          description TEXT NOT NULL,
          body TEXT NOT NULL,
          frontmatter TEXT NOT NULL,
          globs TEXT,
          scripts_enabled INTEGER DEFAULT 0,
          updated_at INTEGER DEFAULT 0,
          PRIMARY KEY (name, source)
        );
      `);
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
