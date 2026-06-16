import { Database } from 'node-sqlite3-wasm';

// Storage engine interface. Everything above the storage layer depends on this,
// not on a concrete driver, so the engine is swappable. We currently back it with
// node-sqlite3-wasm (pure WASM, no native build, ABI-independent — works in Node
// and in the VS Code/Electron host). A native better-sqlite3 adapter can be
// slotted in at ship time without touching the repositories.
export interface SqlDb {
  run(sql: string, params?: unknown[]): void;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  exec(sql: string): void;
  userVersion(): number;
  setUserVersion(version: number): void;
  transaction(fn: () => void): void;
  close(): void;
}

// node-sqlite3-wasm accepts string | number | null | bigint | Uint8Array binds.
// We cast our `unknown[]` to its bind type at the boundary.
type Binds = Parameters<Database['run']>[1];

class WasmSqlDb implements SqlDb {
  constructor(private readonly db: Database) {}

  run(sql: string, params?: unknown[]): void {
    this.db.run(sql, params as Binds);
  }
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined {
    return this.db.get(sql, params as Binds) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    return this.db.all(sql, params as Binds) as T[];
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  userVersion(): number {
    const row = this.db.get('PRAGMA user_version') as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  }
  setUserVersion(version: number): void {
    // PRAGMA does not accept bound parameters; version is an internal integer.
    this.db.run(`PRAGMA user_version = ${Math.floor(version)}`);
  }
  transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    }
  }
  close(): void {
    this.db.close();
  }
}

/** Open a database file (or ':memory:'). Throws if the engine cannot load — the
 * caller (Storage) catches this and degrades. */
export function openDatabase(path: string): SqlDb {
  return new WasmSqlDb(new Database(path));
}
