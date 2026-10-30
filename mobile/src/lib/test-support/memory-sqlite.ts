/**
 * expo-sqlite, as far as the app uses it, on top of real SQLite — for tests.
 *
 * Each "file" is an in-memory bun:sqlite database kept in a map, so it
 * survives being closed and reopened the way a file on the phone does, and
 * disappears when deleted. Handles behave like expo-sqlite's in the two ways
 * that matter here: a closed handle refuses every statement, and a file cannot
 * be deleted while a handle to it is open.
 *
 * Imported only by tests; nothing in the app imports it, so Metro never
 * bundles it.
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type { SqlBindParams, SqlDb, SqlRunResult } from '../db';
import type { UserDatabaseDriver } from '../user-db';

function bindings(params?: SqlBindParams): SQLQueryBindings[] {
  if (!params) return [];
  if (!Array.isArray(params)) throw new Error('memory-sqlite: named parameters are not supported');
  // bun:sqlite binds a blob from a typed array only; expo-sqlite also takes an ArrayBuffer.
  return params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof ArrayBuffer ? new Uint8Array(v) : v));
}

export class MemorySqliteHandle implements SqlDb {
  closed = false;

  constructor(
    readonly fileName: string,
    private readonly file: Database,
    private readonly onClose: (handle: MemorySqliteHandle) => void,
  ) {}

  private live(): Database {
    if (this.closed) throw new Error(`Access to closed resource: ${this.fileName}`);
    return this.file;
  }

  async getAllAsync<T>(source: string, params?: SqlBindParams): Promise<T[]> {
    return this.live().query(source).all(...bindings(params)) as T[];
  }

  async getFirstAsync<T>(source: string, params?: SqlBindParams): Promise<T | null> {
    return (this.live().query(source).get(...bindings(params)) as T | null) ?? null;
  }

  async runAsync(source: string, params?: SqlBindParams): Promise<SqlRunResult> {
    const result = this.live().query(source).run(...bindings(params));
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async execAsync(source: string): Promise<void> {
    this.live().exec(source);
  }

  async closeAsync(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this);
  }
}

export interface MemorySqlite {
  /** Every file on the fake disk, by name. */
  files: Map<string, Database>;
  /** open / close / delete, in the order they happened. */
  log: string[];
  /** The registry driver (user-db.ts) over this disk. */
  driver: UserDatabaseDriver<MemorySqliteHandle>;
  /** Stand-ins for expo-sqlite's own exports, for mock.module('expo-sqlite'). */
  expoSqlite: {
    openDatabaseAsync: (fileName: string) => Promise<MemorySqliteHandle>;
    deleteDatabaseAsync: (fileName: string) => Promise<void>;
  };
  /** Make every open wait until releaseOpens(), to stage races. */
  holdOpens: () => void;
  releaseOpens: () => void;
  /** Handles currently open, by file name. */
  openFiles: () => string[];
}

export function createMemorySqlite(): MemorySqlite {
  const files = new Map<string, Database>();
  const open = new Map<string, Set<MemorySqliteHandle>>();
  const log: string[] = [];
  let gate: { promise: Promise<void>; release: () => void } | null = null;

  async function openDatabaseAsync(fileName: string): Promise<MemorySqliteHandle> {
    log.push(`open ${fileName}`);
    if (gate) await gate.promise;
    let file = files.get(fileName);
    if (!file) {
      file = new Database(':memory:');
      files.set(fileName, file);
    }
    const handle = new MemorySqliteHandle(fileName, file, (h) => {
      log.push(`close ${fileName}`);
      open.get(fileName)?.delete(h);
    });
    if (!open.has(fileName)) open.set(fileName, new Set());
    open.get(fileName)!.add(handle);
    return handle;
  }

  async function deleteDatabaseAsync(fileName: string): Promise<void> {
    if ((open.get(fileName)?.size ?? 0) > 0) {
      throw new Error(`Unable to delete database ${fileName} that is currently open. Close it prior to deletion`);
    }
    const file = files.get(fileName);
    if (!file) throw new Error(`Database ${fileName} not found`);
    log.push(`delete ${fileName}`);
    file.close();
    files.delete(fileName);
  }

  return {
    files,
    log,
    expoSqlite: { openDatabaseAsync, deleteDatabaseAsync },
    driver: {
      open: openDatabaseAsync,
      close: (handle) => handle.closeAsync(),
      remove: async (fileName) => {
        try {
          await deleteDatabaseAsync(fileName);
        } catch (e) {
          if (/not found/i.test(e instanceof Error ? e.message : String(e))) return;
          throw e;
        }
      },
    },
    holdOpens: () => {
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { promise, release };
    },
    releaseOpens: () => {
      gate?.release();
      gate = null;
    },
    openFiles: () => [...open.entries()].filter(([, hs]) => hs.size > 0).map(([name]) => name),
  };
}
