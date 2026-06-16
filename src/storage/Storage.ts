import * as fs from 'fs';
import * as path from 'path';
import { SqlDb, openDatabase } from './SqlDb';
import { runMigrations } from './migrations';

/**
 * Opens the SQLite database and runs migrations. Designed to DEGRADE, never
 * crash: if the engine fails to load/open (STATE-4) the caller marks storage
 * unavailable and the rest of conclave keeps working without persistence.
 */
export class Storage {
  private constructor(
    readonly db: SqlDb,
    readonly version: number,
    readonly dbPath: string,
  ) {}

  /** Open at a directory; creates it if needed. Throws on failure (caller degrades). */
  static open(dir: string, fileName = 'conclave.db'): Storage {
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, fileName);
    const db = openDatabase(dbPath);
    const version = runMigrations(db);
    return new Storage(db, version, dbPath);
  }

  /** In-memory database (tests / fallback). */
  static memory(): Storage {
    const db = openDatabase(':memory:');
    const version = runMigrations(db);
    return new Storage(db, version, ':memory:');
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
