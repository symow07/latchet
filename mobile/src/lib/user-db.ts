/**
 * Which SQLite file is open, and for whom.
 *
 * The phone keeps one database file per signed-in user (decision 7 in
 * .unlazy/phase3/PLAN.md). This module is the bookkeeping around that: the
 * file name for a user id, and a registry that opens, switches, closes and
 * deletes those files without ever letting a query reach the wrong one. It
 * imports nothing native — db.ts hands it expo-sqlite as a driver, and the
 * tests hand it an in-memory SQLite — so every rule here runs under `bun test`.
 *
 * The rules the registry enforces:
 *   - Before the first activation since launch, getDatabase() waits: the app
 *     has not decided who is signed in yet, and a query made that early
 *     belongs to whoever it turns out to be.
 *   - After a close (sign-out, or the session ending), getDatabase() refuses.
 *     It must not wait for the next sign-in, or a write still in flight from
 *     the user who left would land in the ledger of the user who arrives.
 *   - A handle obtained for user A stays A's: switching to B closes A's
 *     connection, so a late statement on it fails instead of reaching B.
 *   - Opens, closes and deletes run one at a time, in call order, so a sign-out
 *     during a slow open cannot leave the file open behind it.
 */
import type { SqlDb } from './db';
import { LOCAL_SCHEMA_KEY, LOCAL_SCHEMA_SQL, localSeedStatements } from './local-schema';

/** Ids that are already safe as part of a file name, unchanged (decision 7). */
const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function utf8Bytes(input: string): number[] {
  const out: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

/** 32-bit FNV-1a of the UTF-8 bytes of `input`, as 8 lowercase hex digits. */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The database file for a user.
 *
 * Better Auth's ids are plain alphanumerics and are used as they are. Anything
 * else — a slash, a dot, an empty string, something too long — is hashed, so
 * no id can name a path outside the SQLite directory or another file in it.
 *
 * A file an earlier build named differently is moved to this name before it
 * is opened (storage-migration.ts, called from db.ts).
 */
export function userDatabaseFileName(userId: string): string {
  return SAFE_USER_ID.test(userId) ? `latchet_${userId}.db` : `latchet_u${fnv1a32Hex(userId)}.db`;
}

/**
 * Create the schema in a freshly opened file and seed it, once.
 *
 * Returns 'foreign' when the file already belongs to a different user, which
 * only a file-name collision could cause; the registry then replaces it rather
 * than show one person another's data.
 */
export async function initializeUserDatabase(
  db: SqlDb,
  userId: string,
  nowISO: string,
): Promise<'ready' | 'foreign'> {
  await db.execAsync(LOCAL_SCHEMA_SQL);

  const owner = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM local_meta WHERE key = 'owner'`,
  );
  if (owner && owner.value !== userId) return 'foreign';

  const created = await db.getFirstAsync<{ key: string }>(
    `SELECT key FROM migrations WHERE key = ?`,
    [LOCAL_SCHEMA_KEY],
  );
  if (!created) {
    // One transaction, so a crash part-way leaves a file that seeds again on
    // the next open (every seed is INSERT OR IGNORE) rather than half a seed.
    await db.execAsync('BEGIN');
    try {
      for (const seed of localSeedStatements(userId, nowISO)) {
        await db.runAsync(seed.sql, seed.params);
      }
      await db.runAsync(`INSERT OR REPLACE INTO local_meta (key, value) VALUES ('owner', ?)`, [userId]);
      await db.runAsync(`INSERT INTO migrations (key, appliedAt) VALUES (?, ?)`, [LOCAL_SCHEMA_KEY, nowISO]);
      await db.execAsync('COMMIT');
    } catch (e) {
      await db.execAsync('ROLLBACK').catch(() => {});
      throw e;
    }
  } else if (!owner) {
    await db.runAsync(`INSERT OR IGNORE INTO local_meta (key, value) VALUES ('owner', ?)`, [userId]);
  }
  return 'ready';
}

/** The native half: how to open, close and delete a database file. */
export interface UserDatabaseDriver<D extends SqlDb> {
  open(fileName: string): Promise<D>;
  close(db: D): Promise<void>;
  /** Delete a closed file. Must resolve, not throw, when the file does not exist. */
  remove(fileName: string): Promise<void>;
}

export interface UserDatabaseRegistryOptions {
  /** Files from before per-user storage, deleted once on the first activation. */
  legacyFileNames?: readonly string[];
  now?: () => string;
  onWarning?: (message: string, error?: unknown) => void;
}

/** getDatabase() after sign-out, or before any user is known and none will be. */
export class NoActiveUserDatabaseError extends Error {
  constructor() {
    super('No user database is open: nobody is signed in.');
    this.name = 'NoActiveUserDatabaseError';
  }
}

/** An activation that was overtaken by a sign-out or another activation. */
export class UserDatabaseSupersededError extends Error {
  constructor(userId: string) {
    super(`The database activation for ${userId} was superseded.`);
    this.name = 'UserDatabaseSupersededError';
  }
}

type State<D> =
  | { kind: 'idle' }
  | { kind: 'opening'; userId: string; token: number; ready: Promise<D> }
  | { kind: 'open'; userId: string; token: number; db: D }
  | { kind: 'failed'; userId: string; error: unknown }
  | { kind: 'closed' };

export interface UserDatabaseRegistry<D extends SqlDb> {
  /** Open (or keep) the user's file and make it the active one. Idempotent. */
  open(userId: string): Promise<D>;
  /** Close the active file. Later getDatabase() calls refuse until the next open. */
  close(): Promise<void>;
  /** Close the user's file if it is open, then delete it. */
  remove(userId: string): Promise<void>;
  /** The user whose file is open and ready, or null. */
  activeUserId(): string | null;
  /** The active database, waiting while it opens. */
  get(): Promise<D>;
  /** The active database together with the user it belongs to. */
  active(): Promise<{ db: D; userId: string }>;
}

export function createUserDatabaseRegistry<D extends SqlDb>(
  driver: UserDatabaseDriver<D>,
  options: UserDatabaseRegistryOptions = {},
): UserDatabaseRegistry<D> {
  const now = options.now ?? (() => new Date().toISOString());
  const warn = options.onWarning ?? (() => {});

  let state: State<D> = { kind: 'idle' };
  /** What is physically open, which can lag `state` while a close is queued. */
  let current: { userId: string; db: D } | null = null;
  let tokens = 0;
  let legacyCleaned = false;
  let queue: Promise<unknown> = Promise.resolve();
  /** Callers that asked before the first activation since launch. */
  let idleWaiters: { resolve: (v: { db: D; userId: string }) => void; reject: (e: unknown) => void }[] = [];

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function settleIdleWaiters(ready: Promise<D>, userId: string): void {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) ready.then((db) => w.resolve({ db, userId }), w.reject);
  }

  async function closeCurrent(): Promise<void> {
    if (!current) return;
    const { db, userId } = current;
    current = null;
    try {
      await driver.close(db);
    } catch (e) {
      warn(`closing the database of ${userId} failed`, e);
    }
  }

  async function cleanLegacyOnce(): Promise<void> {
    if (legacyCleaned) return;
    legacyCleaned = true;
    for (const name of options.legacyFileNames ?? []) {
      try {
        await driver.remove(name);
      } catch (e) {
        warn(`deleting the legacy database ${name} failed`, e);
      }
    }
  }

  async function openInitialized(userId: string): Promise<D> {
    const fileName = userDatabaseFileName(userId);
    let db = await driver.open(fileName);
    try {
      if ((await initializeUserDatabase(db, userId, now())) === 'foreign') {
        warn(`${fileName} belonged to another user; replacing it`);
        await driver.close(db);
        await driver.remove(fileName);
        db = await driver.open(fileName);
        if ((await initializeUserDatabase(db, userId, now())) !== 'ready') {
          throw new Error(`${fileName} could not be claimed for its user`);
        }
      }
      return db;
    } catch (e) {
      await driver.close(db).catch(() => {});
      throw e;
    }
  }

  function isCurrentToken(token: number): boolean {
    return (state.kind === 'opening' || state.kind === 'open') && state.token === token;
  }

  function open(userId: string): Promise<D> {
    if (!userId) return Promise.reject(new Error('openUserDatabase needs a user id'));
    if (state.kind === 'open' && state.userId === userId) return Promise.resolve(state.db);
    if (state.kind === 'opening' && state.userId === userId) return state.ready;

    const token = ++tokens;
    const ready = serial(async () => {
      // Whoever was open before is closed first, even when that is the same
      // user re-activating after a failure: one connection at a time.
      await closeCurrent();
      await cleanLegacyOnce();
      const db = await openInitialized(userId);
      if (!isCurrentToken(token)) {
        // Signed out, or switched to someone else, while this was opening.
        await driver.close(db).catch(() => {});
        throw new UserDatabaseSupersededError(userId);
      }
      current = { userId, db };
      state = { kind: 'open', userId, token, db };
      return db;
    });
    state = { kind: 'opening', userId, token, ready };
    settleIdleWaiters(ready, userId);
    ready.catch((error) => {
      if (state.kind === 'opening' && state.token === token) state = { kind: 'failed', userId, error };
    });
    return ready;
  }

  function close(): Promise<void> {
    tokens++;
    state = { kind: 'closed' };
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w.reject(new NoActiveUserDatabaseError());
    return serial(closeCurrent);
  }

  function remove(userId: string): Promise<void> {
    if (state.kind !== 'idle' && state.kind !== 'closed' && state.userId === userId) {
      tokens++;
      state = { kind: 'closed' };
    }
    return serial(async () => {
      if (current?.userId === userId) await closeCurrent();
      await driver.remove(userDatabaseFileName(userId));
    });
  }

  function active(): Promise<{ db: D; userId: string }> {
    switch (state.kind) {
      case 'open':
        return Promise.resolve({ db: state.db, userId: state.userId });
      case 'opening': {
        const { userId } = state;
        return state.ready.then((db) => ({ db, userId }));
      }
      case 'idle':
        return new Promise((resolve, reject) => idleWaiters.push({ resolve, reject }));
      case 'failed':
        return Promise.reject(state.error);
      case 'closed':
        return Promise.reject(new NoActiveUserDatabaseError());
    }
  }

  return {
    open,
    close,
    remove,
    activeUserId: () => (state.kind === 'open' ? state.userId : null),
    get: () => active().then((a) => a.db),
    active,
  };
}
