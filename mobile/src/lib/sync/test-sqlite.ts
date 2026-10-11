/**
 * The phone's per-user database on bun:sqlite, for tests of the sync core and
 * for the end-to-end test that runs it in the backend's test runner.
 *
 * A tiny adapter: bun:sqlite's synchronous calls behind the four async
 * methods the store uses (db.ts's SqlDb), on a fresh in-memory database built
 * from LOCAL_SCHEMA_SQL and seeded exactly as a new phone seeds itself. `run`
 * serialises operations the way db.ts's withWriteLock does.
 *
 * Imported only by tests; nothing in the app imports it, so Metro never
 * bundles it.
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { LOCAL_SCHEMA_KEY, LOCAL_SCHEMA_SQL, localSeedStatements } from '../local-schema';
import type { SyncBindParams, SyncDbAccess, SyncSqlDb } from './sqlite-store';

function bindings(params?: SyncBindParams): SQLQueryBindings[] {
  if (!params) return [];
  if (!Array.isArray(params)) throw new Error('test-sqlite: named parameters are not supported');
  return params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

export class BunSqliteDb implements SyncSqlDb {
  constructor(readonly raw: Database) {}

  async getAllAsync<T>(source: string, params?: SyncBindParams): Promise<T[]> {
    return this.raw.query(source).all(...bindings(params)) as T[];
  }

  async getFirstAsync<T>(source: string, params?: SyncBindParams): Promise<T | null> {
    return (this.raw.query(source).get(...bindings(params)) as T | null) ?? null;
  }

  async runAsync(source: string, params?: SyncBindParams): Promise<{ lastInsertRowId: number; changes: number }> {
    const result = this.raw.query(source).run(...bindings(params));
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async execAsync(source: string): Promise<void> {
    this.raw.exec(source);
  }
}

export interface TestUserDatabase {
  db: BunSqliteDb;
  /** Exclusive access, in call order — what the store is given. */
  access: SyncDbAccess;
  close(): void;
}

/** A fresh per-user database, as a new phone creates it for `userId`. */
export function openTestUserDatabase(userId: string, nowISO = new Date().toISOString()): TestUserDatabase {
  const raw = new Database(':memory:');
  raw.exec(LOCAL_SCHEMA_SQL);
  for (const seed of localSeedStatements(userId, nowISO)) raw.query(seed.sql).run(...seed.params);
  raw.query(`INSERT OR REPLACE INTO local_meta (key, value) VALUES ('owner', ?)`).run(userId);
  raw.query(`INSERT INTO migrations (key, appliedAt) VALUES (?, ?)`).run(LOCAL_SCHEMA_KEY, nowISO);

  const db = new BunSqliteDb(raw);
  let queue: Promise<unknown> = Promise.resolve();
  const access: SyncDbAccess = {
    run<T>(fn: (db: SyncSqlDb) => Promise<T>): Promise<T> {
      const next = queue.then(() => fn(db));
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  return { db, access, close: () => raw.close() };
}
