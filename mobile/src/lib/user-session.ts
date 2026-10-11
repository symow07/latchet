/**
 * Who the phone's local data belongs to, from sign-in to sign-out (I-SESSION).
 *
 * The phone used to keep one database and one set of AsyncStorage keys for
 * everyone, so the second account signed in on a phone inherited the first
 * one's ledger and health profile and uploaded its settings over its own. Now:
 *
 *   activateUser(id)    opens that user's own database file (switching away
 *                       from whoever was active) and points userKey() at them.
 *                       The root layout calls it once the session is known.
 *   deactivateUser()    closes it again when the session ends without an
 *                       explicit sign-out (expiry, revocation). The file stays,
 *                       so nothing unsynced is lost, but nobody can read it.
 *   signOutAndClear()   the explicit sign-out: flush, sign out, then delete
 *                       everything of this user's the phone holds.
 *
 * AsyncStorage is imported lazily, the way import-profiles does it, so this
 * module's logic runs under `bun test`.
 */
import { activeUserId, closeUserDatabase, deleteUserDatabase, openUserDatabase } from './db';
import {
  DEVICE_STORAGE_KEYS,
  USER_KEY_SEPARATOR,
  USER_STORAGE_KEYS,
  allUserKeysFor,
  setStorageUser,
  storageUser,
  userKey,
  userKeyFor,
} from './storage-keys';

export { DEVICE_STORAGE_KEYS, USER_STORAGE_KEYS, userKey, userKeyFor };

async function storage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

let legacyKeysCleaned = false;

/**
 * Remove per-user values the previous version stored under bare keys.
 *
 * Before per-user storage, `linked_banks`, the import profiles and the
 * onboarding answers were written under the bare key for whoever was signed
 * in, and the account type under `@account_type_<userId>`. Nothing reads those
 * any more; left behind they are one user's data sitting on the phone after
 * that user has gone. Test data only, so removed rather than migrated.
 */
async function removeLegacyUserKeysOnce(): Promise<void> {
  if (legacyKeysCleaned) return;
  legacyKeysCleaned = true;
  try {
    const AsyncStorage = await storage();
    const all = await AsyncStorage.getAllKeys();
    const legacy = all.filter(
      (k) =>
        (USER_STORAGE_KEYS as readonly string[]).includes(k) ||
        (k.startsWith('@account_type_') && !k.includes(USER_KEY_SEPARATOR)),
    );
    if (legacy.length > 0) await AsyncStorage.multiRemove(legacy);
  } catch (e) {
    console.warn('[user-session] legacy key cleanup failed', e);
  }
}

/**
 * Make `userId` the user the phone's local data belongs to.
 *
 * Idempotent: activating the active user again does nothing. Activating a
 * different user closes the previous user's database first. Resolves once the
 * database is open and seeded — only then may anything read or write it.
 */
export async function activateUser(userId: string): Promise<void> {
  if (!userId) throw new Error('activateUser needs a user id');
  // Nobody's per-user keys while the switch is in progress: a userKey() call
  // in this window must not resolve to the user who is leaving.
  if (storageUser() !== userId) setStorageUser(null);
  await openUserDatabase(userId);
  // A later activation (or a sign-out) may have overtaken this one while the
  // file was opening; only the user whose database is actually active wins.
  if (activeUserId() === userId) setStorageUser(userId);
  await removeLegacyUserKeysOnce();
}

/** The session ended without an explicit sign-out: close, keep the file. */
export async function deactivateUser(): Promise<void> {
  setStorageUser(null);
  await closeUserDatabase();
}

/** Delete every per-user AsyncStorage value of this user; device keys stay. */
export async function removeUserKeys(userId: string): Promise<void> {
  const AsyncStorage = await storage();
  await AsyncStorage.multiRemove(allUserKeysFor(userId));
}

/** What a sign-out found it could not hand to the server. */
export interface PendingChanges {
  /** Local changes the flush could not send. */
  unsynced: number;
  /** The flush itself failed, so the count is unknown. */
  flushFailed: boolean;
}

export interface SignOutDeps {
  /** The user signing out: whose database and keys are deleted. */
  userId: string;
  /** Optional, first: bring anything queued on the device into this user's ledger. */
  drainPending?: () => Promise<unknown>;
  /** Send pending changes; report how many could not be sent. */
  flush: () => Promise<{ unsynced: number }>;
  /** Asked only when something would be lost. Resolve false to stay signed in. */
  confirmDiscard: (pending: PendingChanges) => Promise<boolean>;
  /** End the server session. */
  signOut: () => Promise<unknown>;
  /** Drop every cached query of this user, and mark the session gone. */
  clearQueryCache: () => void;
  /** Forget the in-memory personal/business choice. */
  resetAccountType: () => void;
}

export type SignOutOutcome =
  | { status: 'signed-out'; pending: PendingChanges; errors: unknown[] }
  | { status: 'kept'; pending: PendingChanges };

/**
 * Explicit sign-out: flush → server sign-out → delete the user's database →
 * delete their per-user keys → clear the query cache → reset the account type.
 *
 * Unsynced changes are never destroyed silently: if the flush could not send
 * everything (or could not run at all), the user is asked first, and declining
 * leaves them signed in with everything intact.
 *
 * Once past that question every step runs even if an earlier one failed. The
 * server sign-out in particular may fail offline, but the expo auth client has
 * already dropped the stored cookie by then, so the phone is signed out either
 * way — and stopping there would leave this user's data on a phone that no
 * longer knows who they are. Failures are returned, not thrown.
 */
export async function signOutAndClear(deps: SignOutDeps): Promise<SignOutOutcome> {
  const { userId } = deps;

  if (deps.drainPending) {
    try {
      await deps.drainPending();
    } catch (e) {
      console.warn('[sign-out] draining queued captures failed', e);
    }
  }

  let pending: PendingChanges;
  try {
    const result = await deps.flush();
    pending = { unsynced: Math.max(0, Math.floor(result.unsynced) || 0), flushFailed: false };
  } catch (e) {
    console.warn('[sign-out] flush failed', e);
    pending = { unsynced: 0, flushFailed: true };
  }

  if ((pending.unsynced > 0 || pending.flushFailed) && !(await deps.confirmDiscard(pending))) {
    return { status: 'kept', pending };
  }

  const errors: unknown[] = [];
  try {
    await deps.signOut();
  } catch (e) {
    errors.push(e);
  }

  // Nobody's keys from here on, before anything is deleted.
  setStorageUser(null);
  try {
    await deleteUserDatabase(userId);
  } catch (e) {
    errors.push(e);
  }
  try {
    await removeUserKeys(userId);
  } catch (e) {
    errors.push(e);
  }
  try {
    deps.clearQueryCache();
  } catch (e) {
    errors.push(e);
  }
  try {
    deps.resetAccountType();
  } catch (e) {
    errors.push(e);
  }

  if (errors.length > 0) console.warn('[sign-out] completed with errors', errors);
  return { status: 'signed-out', pending, errors };
}
