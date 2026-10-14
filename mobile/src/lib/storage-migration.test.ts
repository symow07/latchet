import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTH_STORAGE_PREFIX_MOVE,
  LEGACY_SHARED_DATABASE,
  ONBOARDING_KEY_MOVE,
  SECURE_STORE_KEY_MOVES,
  createDatabaseFileMigration,
  databaseFileUri,
  migrateAsyncStorageKeys,
  migrateSecureStoreKeys,
  previousUserDatabaseFileName,
  renamedOnboardingKey,
  type AsyncKeyStore,
  type DatabaseFiles,
  type SyncKeyStore,
} from './storage-migration';
import { USER_STORAGE_KEYS } from './storage-keys';
import { fnv1a32Hex, userDatabaseFileName } from './user-db';

/**
 * The one-time move from the names an install had before the rename to the
 * names it has now, run against stand-ins for SecureStore, AsyncStorage and
 * the SQLite directory. This file and storage-migration.ts are the only ones
 * that spell the old names; here they are spelled out in full on purpose, so
 * a change to the module's constants cannot quietly change what is moved.
 */

const SRC = join(import.meta.dir, '..');

function logs() {
  const warnings: string[] = [];
  const notes: string[] = [];
  return {
    warnings,
    notes,
    log: { warn: (m: string) => void warnings.push(m), info: (m: string) => void notes.push(m) },
  };
}

// ── Stand-ins ────────────────────────────────────────────────────────────────

function secureStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const writes: string[] = [];
  const store: SyncKeyStore = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(`set ${k}`);
      items.set(k, v);
    },
    deleteItemAsync: async (k) => {
      writes.push(`delete ${k}`);
      items.delete(k);
    },
  };
  return { items, writes, store };
}

function asyncStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const writes: string[] = [];
  const failing = new Set<string>();
  const store: AsyncKeyStore = {
    getAllKeys: async () => [...items.keys()],
    getItem: async (k) => items.get(k) ?? null,
    setItem: async (k, v) => {
      if (failing.has(k)) throw new Error(`disk full writing ${k}`);
      writes.push(`set ${k}`);
      items.set(k, v);
    },
    removeItem: async (k) => {
      writes.push(`remove ${k}`);
      items.delete(k);
    },
  };
  return { items, writes, failing, store };
}

/** The SQLite directory: file names to contents, and every move in order. */
function databaseDirectory(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const moves: string[] = [];
  let killBefore: string | null = null;
  const disk: DatabaseFiles = {
    exists: async (name) => files.has(name),
    move: async (from, to) => {
      if (killBefore === from) {
        killBefore = null;
        throw new Error('the app was killed');
      }
      if (!files.has(from)) throw new Error(`${from} does not exist`);
      if (files.has(to)) throw new Error(`moving ${from} would overwrite ${to}`);
      files.set(to, files.get(from)!);
      files.delete(from);
      moves.push(`${from} -> ${to}`);
    },
  };
  return { files, moves, disk, killBeforeMoving: (name: string) => (killBefore = name) };
}

// ── SecureStore: the sign-in ─────────────────────────────────────────────────

describe('storage migration: the sign-in keys', () => {
  test('storage migration moves the sign-in to the new secure keys and deletes the old ones', async () => {
    const { items, store } = secureStore({ realbudget_cookie: '{"c":1}', realbudget_session_data: '{"s":1}', other: 'x' });
    const { log, notes } = logs();
    expect(migrateSecureStoreKeys(store, log)).toEqual(['moved', 'moved']);
    // Copied synchronously: the auth client created right after finds them.
    expect(items.get('latchet_cookie')).toBe('{"c":1}');
    expect(items.get('latchet_session_data')).toBe('{"s":1}');
    await Promise.resolve();
    expect([...items.keys()].sort()).toEqual(['latchet_cookie', 'latchet_session_data', 'other']);
    expect(notes).toHaveLength(1);
  });

  test('storage migration never overwrites a sign-in key already under the new name, and still deletes the old one', async () => {
    const { items, writes, store } = secureStore({ realbudget_cookie: 'old', latchet_cookie: 'newer' });
    expect(migrateSecureStoreKeys(store, logs().log)).toEqual(['kept-newer', 'nothing']);
    await Promise.resolve();
    expect(items.get('latchet_cookie')).toBe('newer');
    expect(items.has('realbudget_cookie')).toBe(false);
    expect(writes).toEqual(['delete realbudget_cookie']);
  });

  test('storage migration with no old sign-in keys writes nothing to the secure store', async () => {
    const { writes, store } = secureStore({ latchet_cookie: 'c' });
    expect(migrateSecureStoreKeys(store, logs().log)).toEqual(['nothing', 'nothing']);
    await Promise.resolve();
    expect(writes).toEqual([]);
  });

  test('storage migration never throws out of the sign-in move, whatever the secure store does', async () => {
    const { log, warnings } = logs();
    const unreadable: SyncKeyStore = {
      getItem: () => {
        throw new Error('keychain locked');
      },
      setItem: () => {},
      deleteItemAsync: async () => {},
    };
    expect(migrateSecureStoreKeys(unreadable, log)).toEqual(['failed', 'failed']);
    expect(warnings).toHaveLength(2);

    // A failed write keeps the old key for the next launch.
    const full = secureStore({ realbudget_cookie: 'c' });
    full.store.setItem = () => {
      throw new Error('keychain full');
    };
    expect(migrateSecureStoreKeys(full.store, logs().log)).toEqual(['failed', 'nothing']);
    await Promise.resolve();
    expect(full.items.get('realbudget_cookie')).toBe('c');

    // A delete that rejects, or throws before it is a promise, is ignored.
    const rejecting = secureStore({ realbudget_cookie: 'c', realbudget_session_data: 's' });
    let calls = 0;
    rejecting.store.deleteItemAsync = (k) => {
      if (++calls === 1) throw new Error(`cannot delete ${k}`);
      return Promise.reject(new Error(`cannot delete ${k}`));
    };
    expect(migrateSecureStoreKeys(rejecting.store, logs().log)).toEqual(['moved', 'moved']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejecting.items.get('latchet_cookie')).toBe('c');
  });

  test('storage migration writes the keys the auth client reads, before the client is created', () => {
    expect(SECURE_STORE_KEY_MOVES).toEqual([
      ['realbudget_cookie', 'latchet_cookie'],
      ['realbudget_session_data', 'latchet_session_data'],
    ]);
    const client = readFileSync(join(SRC, 'lib/auth/auth-client.ts'), 'utf8');
    expect(client.match(/storagePrefix:\s*"([^"]+)"/)?.[1]).toBe(AUTH_STORAGE_PREFIX_MOVE.to);
    const migrated = client.indexOf('migrateSecureStoreKeys(SecureStore)');
    expect(migrated).toBeGreaterThan(-1);
    expect(migrated).toBeLessThan(client.indexOf('createAuthClient('));
    // The expo client still names its keys after the prefix this way.
    const expo = join(SRC, '..', 'node_modules/@better-auth/expo/dist/client.mjs');
    expect(existsSync(expo)).toBe(true);
    const library = readFileSync(expo, 'utf8');
    expect(library).toContain('`${storagePrefix}_cookie`');
    expect(library).toContain('`${storagePrefix}_session_data`');
  });
});

// ── AsyncStorage: the onboarding record ──────────────────────────────────────

describe('storage migration: the onboarding keys', () => {
  test('storage migration moves the onboarding record, bare and per user, to the same suffix under the new key', async () => {
    const { items, store } = asyncStore({
      '@real_budget_onboarding': '{"completed":true}',
      '@real_budget_onboarding::alice': '{"completed":true,"checklistDismissed":true}',
      '@real_budget_onboarding::u::odd': '{"completed":false}',
    });
    expect(await migrateAsyncStorageKeys(store, logs().log)).toEqual({ moved: 3, keptNewer: 0, failed: 0 });
    expect(Object.fromEntries(items)).toEqual({
      '@latchet_onboarding': '{"completed":true}',
      '@latchet_onboarding::alice': '{"completed":true,"checklistDismissed":true}',
      '@latchet_onboarding::u::odd': '{"completed":false}',
    });
    expect(ONBOARDING_KEY_MOVE).toEqual({ from: '@real_budget_onboarding', to: '@latchet_onboarding' });
    expect(USER_STORAGE_KEYS as readonly string[]).toContain(ONBOARDING_KEY_MOVE.to);
  });

  test('storage migration keeps an onboarding record already under the new key and removes the old one', async () => {
    const { items, writes, store } = asyncStore({
      '@real_budget_onboarding::alice': '{"completed":false}',
      '@latchet_onboarding::alice': '{"completed":true}',
    });
    expect(await migrateAsyncStorageKeys(store, logs().log)).toEqual({ moved: 0, keptNewer: 1, failed: 0 });
    expect(Object.fromEntries(items)).toEqual({ '@latchet_onboarding::alice': '{"completed":true}' });
    expect(writes).toEqual(['remove @real_budget_onboarding::alice']);
  });

  test('storage migration leaves every other key alone, and with nothing to move writes nothing', async () => {
    const { writes, store } = asyncStore({
      '@latchet_onboarding::alice': '{}',
      '@real_budget_onboardingX': 'not ours',
      linked_banks: '[]',
      '@biometric_lock': 'true',
    });
    expect(await migrateAsyncStorageKeys(store, logs().log)).toEqual({ moved: 0, keptNewer: 0, failed: 0 });
    expect(writes).toEqual([]);
    expect(renamedOnboardingKey('@real_budget_onboardingX')).toBeNull();
    expect(renamedOnboardingKey('linked_banks')).toBeNull();
  });

  test('storage migration: a key that fails to move is counted and kept, the others move, and a re-run finishes it', async () => {
    const { items, failing, store } = asyncStore({
      '@real_budget_onboarding::alice': 'a',
      '@real_budget_onboarding::bob': 'b',
    });
    failing.add('@latchet_onboarding::alice');
    const { log, warnings } = logs();
    expect(await migrateAsyncStorageKeys(store, log)).toEqual({ moved: 1, keptNewer: 0, failed: 1 });
    expect(items.get('@real_budget_onboarding::alice')).toBe('a');
    expect(items.get('@latchet_onboarding::bob')).toBe('b');
    expect(warnings).toHaveLength(1);

    failing.clear();
    expect(await migrateAsyncStorageKeys(store, log)).toEqual({ moved: 1, keptNewer: 0, failed: 0 });
    expect(Object.fromEntries(items)).toEqual({ '@latchet_onboarding::alice': 'a', '@latchet_onboarding::bob': 'b' });
  });
});

// ── SQLite: each user's database file ────────────────────────────────────────

describe('storage migration: the database files', () => {
  test('storage migration moves a database with its -wal and -shm to the new name, the main file last', async () => {
    const { files, moves, disk } = databaseDirectory({
      'budget_alice.db': 'main',
      'budget_alice.db-wal': 'wal',
      'budget_alice.db-shm': 'shm',
      'budget_bob.db': 'bob',
    });
    const { log, notes } = logs();
    expect(await createDatabaseFileMigration(disk, log)('latchet_alice.db')).toBe('moved');
    expect(moves).toEqual([
      'budget_alice.db-wal -> latchet_alice.db-wal',
      'budget_alice.db-shm -> latchet_alice.db-shm',
      'budget_alice.db -> latchet_alice.db',
    ]);
    expect(Object.fromEntries(files)).toEqual({
      'latchet_alice.db': 'main',
      'latchet_alice.db-wal': 'wal',
      'latchet_alice.db-shm': 'shm',
      // Another user's file waits for that user's own activation.
      'budget_bob.db': 'bob',
    });
    expect(notes).toEqual(['moved budget_alice.db to latchet_alice.db']);
  });

  test('storage migration: a run cut off after the side files is finished by the next one', async () => {
    const { files, moves, disk, killBeforeMoving } = databaseDirectory({
      'budget_alice.db': 'main',
      'budget_alice.db-wal': 'wal',
      'budget_alice.db-shm': 'shm',
    });
    killBeforeMoving('budget_alice.db');
    // The failure reaches the caller, which must not open the file then.
    await expect(createDatabaseFileMigration(disk, logs().log)('latchet_alice.db')).rejects.toThrow(/killed/);
    expect([...files.keys()].sort()).toEqual(['budget_alice.db', 'latchet_alice.db-shm', 'latchet_alice.db-wal']);

    // The next launch: a fresh migration finds the old main file and finishes.
    expect(await createDatabaseFileMigration(disk, logs().log)('latchet_alice.db')).toBe('moved');
    expect(Object.fromEntries(files)).toEqual({
      'latchet_alice.db': 'main',
      'latchet_alice.db-wal': 'wal',
      'latchet_alice.db-shm': 'shm',
    });
    expect(moves.at(-1)).toBe('budget_alice.db -> latchet_alice.db');
  });

  test('storage migration never overwrites a database already under the new name; the old files stay, warned once', async () => {
    const { files, moves, disk } = databaseDirectory({
      'budget_alice.db': 'old',
      'budget_alice.db-wal': 'old wal',
      'latchet_alice.db': 'newer',
    });
    const { log, warnings } = logs();
    const migrate = createDatabaseFileMigration(disk, log);
    expect(await migrate('latchet_alice.db')).toBe('kept-newer');
    expect(await migrate('latchet_alice.db')).toBe('kept-newer');
    expect(moves).toEqual([]);
    expect(Object.fromEntries(files)).toEqual({
      'budget_alice.db': 'old',
      'budget_alice.db-wal': 'old wal',
      'latchet_alice.db': 'newer',
    });
    expect(warnings).toEqual(['latchet_alice.db already exists, so budget_alice.db was left where it is']);
  });

  test('storage migration leaves a side file whose new name is taken, and still moves the rest', async () => {
    const { files, disk } = databaseDirectory({
      'budget_alice.db': 'main',
      'budget_alice.db-wal': 'wal',
      'budget_alice.db-journal': 'journal',
      'latchet_alice.db-journal': 'taken',
    });
    const { log, warnings } = logs();
    expect(await createDatabaseFileMigration(disk, log)('latchet_alice.db')).toBe('moved');
    expect(Object.fromEntries(files)).toEqual({
      'budget_alice.db-journal': 'journal',
      'latchet_alice.db': 'main',
      'latchet_alice.db-wal': 'wal',
      'latchet_alice.db-journal': 'taken',
    });
    expect(warnings).toHaveLength(1);
  });

  test('storage migration moves hashed file names, and only ever names a user file', async () => {
    for (const id of ['a/b', 'ünïcödé', '', 'x'.repeat(65)]) {
      const name = userDatabaseFileName(id);
      expect(name).toBe(`latchet_u${fnv1a32Hex(id)}.db`);
      expect(previousUserDatabaseFileName(name)).toBe(`budget_u${fnv1a32Hex(id)}.db`);
    }
    expect(previousUserDatabaseFileName(userDatabaseFileName('Ab3_x-9'))).toBe('budget_Ab3_x-9.db');
    for (const other of [LEGACY_SHARED_DATABASE, 'budget_alice.db', 'latchet_.db', 'latchet_alice.db-wal', 'notes.db']) {
      expect(previousUserDatabaseFileName(other)).toBeNull();
    }
    expect(LEGACY_SHARED_DATABASE).toBe('real_budget.db');

    const hashed = userDatabaseFileName('a/b');
    const { files, disk } = databaseDirectory({ [`budget_u${fnv1a32Hex('a/b')}.db`]: 'main' });
    expect(await createDatabaseFileMigration(disk, logs().log)(hashed)).toBe('moved');
    expect([...files.keys()]).toEqual([hashed]);
  });

  test('storage migration with no earlier file moves nothing', async () => {
    const { moves, disk } = databaseDirectory({ 'latchet_alice.db': 'main', 'budget_bob.db': 'bob' });
    const migrate = createDatabaseFileMigration(disk, logs().log);
    expect(await migrate('latchet_alice.db')).toBe('nothing');
    expect(await migrate('latchet_carol.db')).toBe('nothing');
    expect(moves).toEqual([]);
  });

  test('storage migration addresses expo-sqlite\'s directory as file:// URIs', () => {
    const dir = '/var/mobile/Containers/Data/Application/0A1B/Documents/SQLite';
    expect(databaseFileUri(dir, 'latchet_alice.db')).toBe(`file://${dir}/latchet_alice.db`);
    expect(databaseFileUri(`${dir}/`, 'latchet_alice.db-wal')).toBe(`file://${dir}/latchet_alice.db-wal`);
    expect(databaseFileUri('/data/user/0/app/files/My Files/SQLite', 'x.db')).toBe(
      'file:///data/user/0/app/files/My%20Files/SQLite/x.db',
    );
    expect(databaseFileUri('file:///already/a/uri/', 'x.db')).toBe('file:///already/a/uri/x.db');
  });

  test('storage migration runs in db.ts before a user\'s file is opened, and in activation before userKey() is set', () => {
    const db = readFileSync(join(SRC, 'lib/db.ts'), 'utf8');
    const open = db.slice(db.indexOf('const expoDriver'), db.indexOf('close:', db.indexOf('const expoDriver')));
    expect(open.indexOf('await moveEarlierDatabaseFile(fileName)')).toBeGreaterThan(-1);
    expect(open.indexOf('await moveEarlierDatabaseFile(fileName)')).toBeLessThan(open.indexOf('SQLite.openDatabaseAsync(fileName)'));
    expect(db).toContain('legacyFileNames: [LEGACY_SHARED_DATABASE]');

    const session = readFileSync(join(SRC, 'lib/user-session.ts'), 'utf8');
    const activate = session.slice(session.indexOf('export async function activateUser'));
    expect(activate.indexOf('await moveRenamedKeysOnce()')).toBeGreaterThan(-1);
    expect(activate.indexOf('await moveRenamedKeysOnce()')).toBeLessThan(activate.indexOf('setStorageUser(userId)'));
  });
});

// ── All three together ───────────────────────────────────────────────────────

describe('storage migration: the whole install', () => {
  test('storage migration run twice moves everything once, and the second run is a no-op', async () => {
    const secure = secureStore({ realbudget_cookie: 'c', realbudget_session_data: 's' });
    const keys = asyncStore({ '@real_budget_onboarding::alice': '{"completed":true}', linked_banks: '[]' });
    const dir = databaseDirectory({ 'budget_alice.db': 'main', 'budget_alice.db-wal': 'wal' });

    const runAll = async () => {
      const { log } = logs();
      migrateSecureStoreKeys(secure.store, log);
      await Promise.resolve();
      await migrateAsyncStorageKeys(keys.store, log);
      return createDatabaseFileMigration(dir.disk, log)('latchet_alice.db');
    };

    expect(await runAll()).toBe('moved');
    const after = {
      secure: Object.fromEntries(secure.items),
      keys: Object.fromEntries(keys.items),
      files: Object.fromEntries(dir.files),
    };
    expect(after).toEqual({
      secure: { latchet_cookie: 'c', latchet_session_data: 's' },
      keys: { '@latchet_onboarding::alice': '{"completed":true}', linked_banks: '[]' },
      files: { 'latchet_alice.db': 'main', 'latchet_alice.db-wal': 'wal' },
    });
    const writes = [secure.writes.length, keys.writes.length, dir.moves.length];

    expect(await runAll()).toBe('nothing');
    expect([secure.writes.length, keys.writes.length, dir.moves.length]).toEqual(writes);
    expect({
      secure: Object.fromEntries(secure.items),
      keys: Object.fromEntries(keys.items),
      files: Object.fromEntries(dir.files),
    }).toEqual(after);
  });
});
