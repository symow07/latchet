/**
 * The one-time move of an install's storage from the names it had before the
 * product was renamed to Latchet (.unlazy/latchet/PLAN.md, decision 2).
 *
 * This file and its test are the only places in the app that spell the old
 * names, and only as the names data is moved from. Three stores, three moves:
 *
 *   SecureStore   the sign-in. Better Auth's expo client keeps its cookie and
 *                 its cached session under `<storagePrefix>_cookie` and
 *                 `<storagePrefix>_session_data`, and reads them synchronously.
 *                 auth-client.ts moves them before it creates the client, so
 *                 the user stays signed in.
 *   AsyncStorage  the onboarding record, one per user (`<key>::<userId>`).
 *                 user-session.ts moves it while activating a user, before
 *                 anything can read it.
 *   SQLite        each user's database file and its -wal, -shm and -journal
 *                 side files. db.ts moves a user's file just before it opens
 *                 it; the side files go first and the main file last.
 *
 * Every move keeps the same rules:
 *   - idempotent: a second run finds nothing to move and writes nothing;
 *   - interrupt-safe: a run cut off part-way is finished by the next one;
 *   - never overwrites: whatever is already under the new name was written by
 *     this build, so it is the newer copy and stays;
 *   - copy first, remove the old second, so nothing is lost if the app dies
 *     in between.
 *
 * Not moved: the queue of shares the old share extension left in its App
 * Group (PLAN decision 3). The new bundle id cannot reach the old group.
 *
 * Imports nothing native: each store is handed in, so storage-migration.test.ts
 * runs every rule under `bun test`.
 */
import { USER_KEY_SEPARATOR, type UserStorageKey } from './storage-keys';

export type MigrationLog = (message: string, error?: unknown) => void;

const defaultWarn: MigrationLog = (message, error) => console.warn(`[storage-migration] ${message}`, error ?? '');
const defaultInfo: MigrationLog = (message) => console.log(`[storage-migration] ${message}`);

/**
 * The shared file every user read and wrote before per-user files. Test data:
 * never moved, deleted on the first activation (db.ts hands it to user-db.ts).
 */
export const LEGACY_SHARED_DATABASE = 'real_budget.db';

// ── SecureStore: the sign-in ─────────────────────────────────────────────────

/** Better Auth's expo client storagePrefix, before and after (auth-client.ts). */
export const AUTH_STORAGE_PREFIX_MOVE = { from: 'realbudget', to: 'latchet' } as const;

/** The keys the expo client names after its prefix (@better-auth/expo, expoClient). */
const AUTH_STORAGE_SUFFIXES = ['_cookie', '_session_data'] as const;

/** [old key, new key] for every SecureStore value the sign-in lives in. */
export const SECURE_STORE_KEY_MOVES: readonly (readonly [from: string, to: string])[] = AUTH_STORAGE_SUFFIXES.map(
  (suffix) => [AUTH_STORAGE_PREFIX_MOVE.from + suffix, AUTH_STORAGE_PREFIX_MOVE.to + suffix] as const,
);

/** expo-secure-store's synchronous reads and writes, and its asynchronous delete. */
export interface SyncKeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  deleteItemAsync(key: string): Promise<void>;
}

/** What happened to one key. */
export type KeyMoveOutcome = 'moved' | 'kept-newer' | 'nothing' | 'failed';

/** Start the delete and forget it: a failure leaves the old key for the next launch. */
function deleteQuietly(store: SyncKeyStore, key: string): void {
  try {
    void Promise.resolve(store.deleteItemAsync(key)).catch(() => {});
  } catch {
    // Thrown before it became a promise: the same, the next launch retries.
  }
}

/**
 * Move the sign-in keys to their new names. Synchronous, because the auth
 * client reads them synchronously from the moment it exists.
 *
 * A new key that already holds a value is never overwritten; the old one is
 * deleted either way once the new one is in place. Never throws: a store that
 * fails is logged, the old key stays where it is, and the app carries on (the
 * next launch tries again).
 */
export function migrateSecureStoreKeys(
  store: SyncKeyStore,
  log: { warn?: MigrationLog; info?: MigrationLog } = {},
): KeyMoveOutcome[] {
  const warn = log.warn ?? defaultWarn;
  const info = log.info ?? defaultInfo;
  const outcomes = SECURE_STORE_KEY_MOVES.map(([from, to]): KeyMoveOutcome => {
    try {
      const value = store.getItem(from);
      if (value === null || value === undefined) return 'nothing';
      const current = store.getItem(to);
      const kept = current !== null && current !== undefined;
      if (!kept) store.setItem(to, value);
      deleteQuietly(store, from);
      return kept ? 'kept-newer' : 'moved';
    } catch (e) {
      warn(`moving the secure key ${from} to ${to} failed; it stays for the next launch`, e);
      return 'failed';
    }
  });
  if (outcomes.includes('moved')) info('moved the sign-in to its new secure keys');
  return outcomes;
}

// ── AsyncStorage: the onboarding record ──────────────────────────────────────

/** The onboarding key, before and after (storage-keys.ts declares the new one). */
export const ONBOARDING_KEY_MOVE: { readonly from: string; readonly to: UserStorageKey } = {
  from: '@real_budget_onboarding',
  to: '@latchet_onboarding',
};

/** AsyncStorage's calls the move needs. */
export interface AsyncKeyStore {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The new name for an old onboarding key, or null for any other key. */
export function renamedOnboardingKey(key: string): string | null {
  const { from, to } = ONBOARDING_KEY_MOVE;
  if (key === from) return to;
  if (key.startsWith(from + USER_KEY_SEPARATOR)) return to + key.slice(from.length);
  return null;
}

export interface AsyncKeyMigration {
  moved: number;
  keptNewer: number;
  failed: number;
}

/**
 * Move every onboarding key, bare or per user, to the same suffix under the
 * new name. A key already present under the new name is kept and the old one
 * removed. One key failing does not stop the others; `failed` says whether a
 * later run has anything left to do. Throws only when the keys cannot be
 * listed at all.
 */
export async function migrateAsyncStorageKeys(
  store: AsyncKeyStore,
  log: { warn?: MigrationLog; info?: MigrationLog } = {},
): Promise<AsyncKeyMigration> {
  const warn = log.warn ?? defaultWarn;
  const info = log.info ?? defaultInfo;
  const result: AsyncKeyMigration = { moved: 0, keptNewer: 0, failed: 0 };
  for (const from of await store.getAllKeys()) {
    const to = renamedOnboardingKey(from);
    if (!to) continue;
    try {
      if ((await store.getItem(to)) !== null) {
        result.keptNewer++;
      } else {
        const value = await store.getItem(from);
        if (value !== null) {
          await store.setItem(to, value);
          result.moved++;
        }
      }
      await store.removeItem(from);
    } catch (e) {
      result.failed++;
      warn(`moving ${from} to ${to} failed; it stays for the next activation`, e);
    }
  }
  if (result.moved > 0) info(`moved ${result.moved} onboarding record(s) to the new key`);
  return result;
}

// ── SQLite: each user's database file ────────────────────────────────────────

/** A user's database file name starts with this, before and after (user-db.ts userDatabaseFileName). */
export const DATABASE_PREFIX_MOVE = { from: 'budget_', to: 'latchet_' } as const;

/** The files SQLite keeps beside a database, which belong with it. */
export const DATABASE_SIDE_FILE_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/** The name an earlier build gave this user's database file, or null for a file it never named. */
export function previousUserDatabaseFileName(fileName: string): string | null {
  const { from, to } = DATABASE_PREFIX_MOVE;
  if (!fileName.startsWith(to) || !fileName.endsWith('.db') || fileName.length <= to.length + 3) return null;
  return from + fileName.slice(to.length);
}

/** The database directory, by file name. */
export interface DatabaseFiles {
  exists(fileName: string): Promise<boolean>;
  /** Rename a closed file. Only ever called with a destination that does not exist. */
  move(from: string, to: string): Promise<void>;
}

export type DatabaseFileMigration = 'moved' | 'kept-newer' | 'nothing';

/**
 * The file:// URI of a file in expo-sqlite's database directory, for
 * expo-file-system, which refuses a bare path. expo-sqlite gives the
 * directory as a plain path; each segment is percent-encoded so the native
 * side reads the same path back. A directory that is already a file:// URI is
 * used as it is.
 */
export function databaseFileUri(directory: string, fileName: string): string {
  const base = directory.startsWith('file://')
    ? directory
    : `file://${directory.split('/').map(encodeURIComponent).join('/')}`;
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(fileName)}`;
}

/**
 * Returns the move to run before a user's database file is opened.
 *
 * When the file is not there yet but the earlier build's file is, the side
 * files that exist move first (each only to a free name) and the main file
 * moves last: until the main file has moved, the next run sees the old one and
 * finishes the job, and SQLite never opens a new name that holds only part of
 * a database. When a file is already under the new name, the old files are
 * left untouched (warned once per file, never overwritten).
 *
 * Throws when the disk does: the caller must not open the file then, or it
 * would create an empty one in front of the user's data.
 */
export function createDatabaseFileMigration(
  files: DatabaseFiles,
  log: { warn?: MigrationLog; info?: MigrationLog } = {},
): (fileName: string) => Promise<DatabaseFileMigration> {
  const warn = log.warn ?? defaultWarn;
  const info = log.info ?? defaultInfo;
  const warned = new Set<string>();

  return async (fileName) => {
    const previous = previousUserDatabaseFileName(fileName);
    if (!previous || !(await files.exists(previous))) return 'nothing';
    if (await files.exists(fileName)) {
      if (!warned.has(fileName)) {
        warned.add(fileName);
        warn(`${fileName} already exists, so ${previous} was left where it is`);
      }
      return 'kept-newer';
    }
    for (const suffix of DATABASE_SIDE_FILE_SUFFIXES) {
      if (!(await files.exists(previous + suffix))) continue;
      if (await files.exists(fileName + suffix)) {
        warn(`${fileName + suffix} already exists, so ${previous + suffix} was left where it is`);
        continue;
      }
      await files.move(previous + suffix, fileName + suffix);
    }
    await files.move(previous, fileName);
    info(`moved ${previous} to ${fileName}`);
    return 'moved';
  };
}
