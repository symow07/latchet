import { test, expect, mock, beforeEach, describe } from 'bun:test';
import { createMemorySqlite, type MemorySqlite, type MemorySqliteHandle } from './test-support/memory-sqlite';
import { dbModuleMock } from './test-support/db-module';
import {
  createUserDatabaseRegistry,
  fnv1a32Hex,
  initializeUserDatabase,
  userDatabaseFileName,
  NoActiveUserDatabaseError,
  UserDatabaseSupersededError,
  type UserDatabaseRegistry,
} from './user-db';
import { defaultAccountId, EPOCH_ISO } from './local-schema';
import { setStorageUser, storageUser, userKeyFor } from './storage-keys';

/**
 * The session lifecycle: whose database is open, and what an explicit
 * sign-out leaves behind.
 *
 * db.ts itself imports expo-sqlite, so user-session.ts is tested against the
 * real registry (user-db.ts), the real schema and the real seed, over SQLite
 * in memory (test-support/memory-sqlite.ts) — './db' is replaced by exactly
 * the functions db.ts builds from that registry. AsyncStorage is a map.
 */

// ── The fakes ────────────────────────────────────────────────────────────────

let mem: MemorySqlite;
let registry: UserDatabaseRegistry<MemorySqliteHandle>;
/** Every step a sign-out takes, in order, as the fakes observe it. */
const steps: string[] = [];

function freshDisk(): void {
  mem = createMemorySqlite();
  registry = createUserDatabaseRegistry(mem.driver, { legacyFileNames: ['real_budget.db'] });
}
freshDisk();

mock.module('./db', () =>
  dbModuleMock({
    openUserDatabase: (userId: string) => registry.open(userId),
    closeUserDatabase: () => registry.close(),
    deleteUserDatabase: async (userId: string) => {
      steps.push('deleteUserDatabase');
      await registry.remove(userId);
    },
    activeUserId: () => registry.activeUserId(),
    getDatabase: () => registry.get(),
  }),
);

const store = new Map<string, string>();
const memoryStorage = {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
  getAllKeys: async () => [...store.keys()],
  multiRemove: async (keys: readonly string[]) => {
    steps.push('removeUserKeys');
    for (const k of keys) store.delete(k);
  },
};
mock.module('@react-native-async-storage/async-storage', () => ({ default: memoryStorage }));

const session = await import('./user-session');

beforeEach(async () => {
  // Whatever the previous test left open is closed before the disk goes away.
  await registry.close().catch(() => {});
  freshDisk();
  store.clear();
  steps.length = 0;
  setStorageUser(null);
});

/** The steps the deps observe; the db and storage fakes push their own. */
function deps(over: Partial<Parameters<typeof session.signOutAndClear>[0]> = {}) {
  const confirmations: unknown[] = [];
  const d = {
    userId: 'alice',
    flush: async () => {
      steps.push('flush');
      return { unsynced: 0 };
    },
    confirmDiscard: async (p: unknown) => {
      confirmations.push(p);
      return false;
    },
    signOut: async () => {
      steps.push('signOut');
    },
    clearQueryCache: () => {
      steps.push('clearQueryCache');
    },
    resetAccountType: () => {
      steps.push('resetAccountType');
    },
    ...over,
  };
  return { d, confirmations };
}

async function rowCount(handle: MemorySqliteHandle, table: string): Promise<number> {
  return (await handle.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;
}

// ── File names (decision 7) ──────────────────────────────────────────────────

describe('database file names', () => {
  test('a plain id names its own file', () => {
    expect(userDatabaseFileName('Ab3_x-9')).toBe('budget_Ab3_x-9.db');
    const longest = 'a'.repeat(64);
    expect(userDatabaseFileName(longest)).toBe(`budget_${longest}.db`);
  });

  test('an unsafe id is hashed, never used as a path', () => {
    for (const id of ['../../evil', 'a/b', 'a.b', '', 'a'.repeat(65), 'ünïcödé', 'with space', 'x\u0000y']) {
      const name = userDatabaseFileName(id);
      expect(name).toMatch(/^budget_u[0-9a-f]{8}\.db$/);
      expect(name).toBe(`budget_u${fnv1a32Hex(id)}.db`);
    }
    // Deterministic, and distinct ids land in distinct files.
    expect(userDatabaseFileName('a/b')).toBe(userDatabaseFileName('a/b'));
    expect(userDatabaseFileName('a/b')).not.toBe(userDatabaseFileName('a/c'));
  });

  test('the hash is FNV-1a 32 over UTF-8 bytes', () => {
    // Published FNV-1a test vectors.
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    expect(fnv1a32Hex('a')).toBe('e40c292c');
    expect(fnv1a32Hex('foobar')).toBe('bf9cf968');
    // Multi-byte characters hash their UTF-8 encoding, checked against an
    // independent encoder.
    const reference = (s: string) => {
      let h = 0x811c9dc5;
      for (const b of Buffer.from(s, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
      return h.toString(16).padStart(8, '0');
    };
    for (const s of ['é', '用户', '😀 id', 'Ab3']) expect(fnv1a32Hex(s)).toBe(reference(s));
  });
});

// ── Activation ───────────────────────────────────────────────────────────────

describe('activation', () => {
  test('activating opens that user’s own file, seeded with epoch defaults', async () => {
    await session.activateUser('alice');
    expect(registry.activeUserId()).toBe('alice');
    expect(mem.openFiles()).toEqual(['budget_alice.db']);
    expect(storageUser()).toBe('alice');

    const db = await registry.get();
    const settings = await db.getFirstAsync<{ clientUpdatedAt: string; dirty: number }>(
      'SELECT clientUpdatedAt, dirty FROM settings WHERE id = 1',
    );
    expect(settings).toEqual({ clientUpdatedAt: EPOCH_ISO, dirty: 1 });
    const account = await db.getFirstAsync<{ id: string; clientUpdatedAt: string; dirty: number; isDefault: number }>(
      'SELECT id, clientUpdatedAt, dirty, isDefault FROM accounts',
    );
    expect(account).toEqual({ id: defaultAccountId('alice'), clientUpdatedAt: EPOCH_ISO, dirty: 1, isDefault: 1 });
    expect(await rowCount(db, 'sync_tombstones')).toBe(0);
  });

  test('activating the same user again is idempotent, even concurrently', async () => {
    await Promise.all([session.activateUser('alice'), session.activateUser('alice')]);
    await session.activateUser('alice');
    expect(mem.log.filter((l) => l === 'open budget_alice.db')).toHaveLength(1);
    expect(mem.openFiles()).toEqual(['budget_alice.db']);
  });

  test('switching users closes the first file before opening the second, and keeps both apart', async () => {
    await session.activateUser('alice');
    const aliceDb = await registry.get();
    await aliceDb.runAsync(`INSERT INTO custom_categories (name, createdAt) VALUES ('Alice only', 'x')`);

    await session.activateUser('bob');
    expect(registry.activeUserId()).toBe('bob');
    expect(mem.openFiles()).toEqual(['budget_bob.db']);
    expect(mem.log.indexOf('close budget_alice.db')).toBeLessThan(mem.log.indexOf('open budget_bob.db'));
    expect(storageUser()).toBe('bob');

    // Bob sees none of Alice's rows, and Alice's old handle refuses to write.
    expect(await rowCount(await registry.get(), 'custom_categories')).toBe(0);
    await expect(aliceDb.runAsync(`INSERT INTO custom_categories (name, createdAt) VALUES ('late', 'x')`)).rejects.toThrow(
      /closed/,
    );

    // Alice's file was closed, not deleted: switching back finds her row.
    await session.activateUser('alice');
    expect(await rowCount(await registry.get(), 'custom_categories')).toBe(1);
  });

  test('queries made before anyone is known wait for the activation, then belong to that user', async () => {
    const early = registry.get();
    await session.activateUser('alice');
    const db = await early;
    expect(await db.getFirstAsync<{ value: string }>(`SELECT value FROM local_meta WHERE key = 'owner'`)).toEqual({
      value: 'alice',
    });
  });

  test('after the session ends a query is refused, not parked for the next user', async () => {
    await session.activateUser('alice');
    await session.deactivateUser();
    expect(registry.activeUserId()).toBeNull();
    expect(storageUser()).toBeNull();
    expect(mem.openFiles()).toEqual([]);
    await expect(registry.get()).rejects.toBeInstanceOf(NoActiveUserDatabaseError);
    // The file stays: nothing unsynced is lost when a session merely expires.
    expect(mem.files.has('budget_alice.db')).toBe(true);
  });

  test('a sign-out during a slow activation leaves nothing open behind it', async () => {
    mem.holdOpens();
    const activating = session.activateUser('alice');
    const closing = session.deactivateUser();
    mem.releaseOpens();
    await expect(activating).rejects.toBeInstanceOf(UserDatabaseSupersededError);
    await closing;
    expect(registry.activeUserId()).toBeNull();
    expect(mem.openFiles()).toEqual([]);
    expect(storageUser()).toBeNull();
  });

  test('the legacy shared real_budget.db is deleted on the first activation only', async () => {
    const { Database } = await import('bun:sqlite');
    mem.files.set('real_budget.db', new Database(':memory:'));
    await session.activateUser('alice');
    expect(mem.files.has('real_budget.db')).toBe(false);

    mem.files.set('real_budget.db', new Database(':memory:'));
    await session.activateUser('bob');
    expect(mem.files.has('real_budget.db')).toBe(true);
  });

  test('defaults are seeded when the file is created, never again', async () => {
    await session.activateUser('alice');
    const db = await registry.get();
    await db.runAsync('DELETE FROM accounts');
    await session.deactivateUser();
    await session.activateUser('alice');
    expect(await rowCount(await registry.get(), 'accounts')).toBe(0);
  });

  test('a file that belongs to someone else is replaced, never shown', async () => {
    // Only a file-name collision could do this; it must not show Bob's data.
    const handle = await mem.driver.open(userDatabaseFileName('alice'));
    expect(await initializeUserDatabase(handle, 'bob', '2026-01-01T00:00:00.000Z')).toBe('ready');
    await handle.runAsync(`INSERT INTO custom_categories (name, createdAt) VALUES ('Bob only', 'x')`);
    await handle.closeAsync();

    await session.activateUser('alice');
    const db = await registry.get();
    expect(await rowCount(db, 'custom_categories')).toBe(0);
    expect(await db.getFirstAsync<{ value: string }>(`SELECT value FROM local_meta WHERE key = 'owner'`)).toEqual({
      value: 'alice',
    });
  });

  test('values the old version stored under bare per-user keys are removed', async () => {
    store.set('linked_banks', '[{"name":"Someone else’s bank"}]');
    store.set('@account_type_olduser', 'business');
    store.set('@biometric_lock', 'true');
    store.set(userKeyFor('alice', 'linked_banks'), '[]');
    // A fresh module, so its once-per-launch cleanup has not run yet.
    const fresh = await import('./user-session.ts?legacy-cleanup' as string) as typeof session;
    await fresh.activateUser('alice');
    expect(store.has('linked_banks')).toBe(false);
    expect(store.has('@account_type_olduser')).toBe(false);
    expect(store.get('@biometric_lock')).toBe('true');
    expect(store.get(userKeyFor('alice', 'linked_banks'))).toBe('[]');
  });
});

// ── Per-user storage ─────────────────────────────────────────────────────────

describe('per-user storage', () => {
  test('removeUserKeys deletes exactly that user’s keys', async () => {
    store.set(userKeyFor('alice', '@account_type'), 'personal');
    store.set(userKeyFor('alice', '@import_profiles_v1'), '[]');
    store.set(userKeyFor('bob', '@account_type'), 'business');
    store.set('@biometric_lock', 'true');
    store.set('theme.preference', 'dark');

    await session.removeUserKeys('alice');

    expect([...store.keys()].sort()).toEqual(
      ['@biometric_lock', 'theme.preference', userKeyFor('bob', '@account_type')].sort(),
    );
  });

  test('userKey follows the active user and is unavailable while nobody is', async () => {
    expect(() => session.userKey('linked_banks')).toThrow(/nobody signed in/);
    await session.activateUser('alice');
    expect(session.userKey('linked_banks')).toBe(userKeyFor('alice', 'linked_banks'));
    await session.activateUser('bob');
    expect(session.userKey('linked_banks')).toBe(userKeyFor('bob', 'linked_banks'));
    expect(userKeyFor('alice', 'linked_banks')).not.toBe(userKeyFor('bob', 'linked_banks'));
  });
});

// ── Explicit sign-out ────────────────────────────────────────────────────────

describe('signOutAndClear', () => {
  async function signedInAlice() {
    await session.activateUser('alice');
    store.set(userKeyFor('alice', '@account_type'), 'personal');
    store.set(userKeyFor('alice', 'linked_banks'), '[]');
    store.set('@biometric_lock', 'true');
  }

  test('flushes, signs out, deletes the database, removes the keys, clears the cache, resets — in that order', async () => {
    await signedInAlice();
    const seenAtCacheClear: { file: boolean; keys: number }[] = [];
    const { d, confirmations } = deps({
      clearQueryCache: () => {
        steps.push('clearQueryCache');
        seenAtCacheClear.push({
          file: mem.files.has('budget_alice.db'),
          keys: [...store.keys()].filter((k) => k.endsWith('::alice')).length,
        });
      },
    });

    const outcome = await session.signOutAndClear(d);

    expect(outcome.status).toBe('signed-out');
    expect(steps).toEqual(['flush', 'signOut', 'deleteUserDatabase', 'removeUserKeys', 'clearQueryCache', 'resetAccountType']);
    expect(confirmations).toEqual([]); // nothing pending, nothing to ask
    // By the time React hears about it, the file and the keys are gone.
    expect(seenAtCacheClear).toEqual([{ file: false, keys: 0 }]);
    expect(store.get('@biometric_lock')).toBe('true');
    expect(registry.activeUserId()).toBeNull();
    expect(storageUser()).toBeNull();
  });

  test('unsynced changes are not destroyed when the user declines', async () => {
    await signedInAlice();
    const { d, confirmations } = deps({
      flush: async () => {
        steps.push('flush');
        return { unsynced: 3 };
      },
    });

    const outcome = await session.signOutAndClear(d);

    expect(outcome).toEqual({ status: 'kept', pending: { unsynced: 3, flushFailed: false } });
    expect(confirmations).toEqual([{ unsynced: 3, flushFailed: false }]);
    expect(steps).toEqual(['flush']);
    expect(mem.files.has('budget_alice.db')).toBe(true);
    expect(registry.activeUserId()).toBe('alice');
    expect(store.has(userKeyFor('alice', '@account_type'))).toBe(true);
    expect(storageUser()).toBe('alice');
  });

  test('a failed flush asks too, and confirming goes ahead', async () => {
    await signedInAlice();
    const { d, confirmations } = deps({
      flush: async () => {
        steps.push('flush');
        throw new Error('offline');
      },
      confirmDiscard: async (p) => {
        confirmations.push(p);
        return true;
      },
    });

    const outcome = await session.signOutAndClear(d);

    expect(confirmations).toEqual([{ unsynced: 0, flushFailed: true }]);
    expect(outcome.status).toBe('signed-out');
    expect(steps).toEqual(['flush', 'signOut', 'deleteUserDatabase', 'removeUserKeys', 'clearQueryCache', 'resetAccountType']);
    expect(mem.files.has('budget_alice.db')).toBe(false);
  });

  test('a server sign-out that fails offline still clears the phone', async () => {
    await signedInAlice();
    const { d } = deps({
      signOut: async () => {
        steps.push('signOut');
        throw new Error('network down');
      },
    });

    const outcome = await session.signOutAndClear(d);

    expect(outcome.status).toBe('signed-out');
    if (outcome.status === 'signed-out') expect(outcome.errors).toHaveLength(1);
    expect(mem.files.has('budget_alice.db')).toBe(false);
    expect(store.has(userKeyFor('alice', 'linked_banks'))).toBe(false);
  });

  test('captures queued on the phone are drained into the leaving user before the flush', async () => {
    await signedInAlice();
    const { d } = deps({
      drainPending: async () => {
        steps.push(`drain:${registry.activeUserId()}`);
      },
    });
    await session.signOutAndClear(d);
    expect(steps.slice(0, 2)).toEqual(['drain:alice', 'flush']);
  });

  test('after sign-out a late write is refused, and the next user starts empty', async () => {
    await signedInAlice();
    const aliceDb = await registry.get();
    await aliceDb.runAsync(`INSERT INTO custom_categories (name, createdAt) VALUES ('Alice only', 'x')`);

    await session.signOutAndClear(deps().d);

    await expect(registry.get()).rejects.toBeInstanceOf(NoActiveUserDatabaseError);
    await expect(aliceDb.runAsync(`DELETE FROM custom_categories`)).rejects.toThrow(/closed/);

    await session.activateUser('bob');
    const bobDb = await registry.get();
    expect(await rowCount(bobDb, 'custom_categories')).toBe(0);
    expect(
      (await bobDb.getFirstAsync<{ id: string }>('SELECT id FROM accounts'))?.id,
    ).toBe(defaultAccountId('bob'));
  });
});

describe('signOutAndClear reminders', () => {
  test('clears the user\'s reminders last, and a failure there still signs out', async () => {
    await session.activateUser('alice');
    const { d } = deps({});
    let cleared = 0;
    const outcome = await session.signOutAndClear({ ...d, clearNotifications: async () => { cleared++; steps.push('clearNotifications'); } });
    expect(outcome.status).toBe('signed-out');
    expect(cleared).toBe(1);
    expect(steps[steps.length - 1]).toBe('clearNotifications');

    await session.activateUser('alice');
    const failing = await session.signOutAndClear({ ...deps({}).d, clearNotifications: async () => { throw new Error('os said no'); } });
    expect(failing.status).toBe('signed-out');
    if (failing.status === 'signed-out') expect(failing.errors.length).toBe(1);
  });
});

