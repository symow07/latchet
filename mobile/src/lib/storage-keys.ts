/**
 * Every AsyncStorage key the app uses, and whose it is.
 *
 * AsyncStorage is one flat store per install, shared by everyone who signs in
 * on the phone. So each key is declared here exactly once, as one of:
 *
 *   device  about the phone or the app install, whoever is signed in. Read
 *           and written under the bare key, and kept across sign-outs.
 *   user    about one account. Always read and written through userKey(),
 *           which appends the user id, and deleted on explicit sign-out
 *           (user-session.ts removeUserKeys).
 *
 * storage-keys.test.ts scans src/ and fails on a key used anywhere that is not
 * declared here, and on a user key used without userKey(). Imports nothing,
 * so screens and pure modules alike can use it.
 */

/**
 * Device keys. The non-obvious ones:
 *   @biometric_lock          read at cold start, before anyone is signed in, to
 *                            decide whether to show the lock screen at all. It
 *                            protects this phone's copy of the app, and the
 *                            person holding the phone is the one who set it.
 *   @locale_chosen_v1        the language the app is shown in before sign-in
 *                            (the login screen has to be in some language).
 *                            The account's own choice travels in its synced
 *                            settings row and is applied once it is active.
 *   pending_*_seen_v1        de-duplication for the Siri and share-sheet
 *                            queues. Those queues are files on the device,
 *                            written by iOS while the app is not running and
 *                            without knowing who is signed in; the ids that
 *                            have been drained belong to the queue, not to an
 *                            account, and resetting them per user would replay
 *                            old captures into the next account.
 */
export const DEVICE_STORAGE_KEYS = [
  '@biometric_lock',
  'theme.preference',
  '@locale_chosen_v1',
  '@exchange_rates_v1',
  'pending_capture_seen_v1',
  'pending_share_seen_v1',
] as const;

/**
 * User keys. The non-obvious ones:
 *   @account_type            personal or business. Not synced, so a user who
 *                            signs out picks it again on the next sign-in, the
 *                            same as on a new phone.
 *   linked_banks/_accounts   an offline snapshot of the user's Plaid links:
 *                            bank names and masked account numbers.
 */
export const USER_STORAGE_KEYS = [
  '@account_type',
  '@real_budget_onboarding',
  '@import_profiles_v1',
  'linked_banks',
  'linked_accounts',
] as const;

export type DeviceStorageKey = (typeof DEVICE_STORAGE_KEYS)[number];
export type UserStorageKey = (typeof USER_STORAGE_KEYS)[number];

/** Separates the base key from the user id; no declared key contains it. */
export const USER_KEY_SEPARATOR = '::';

/** The per-user AsyncStorage key for an explicit user. */
export function userKeyFor(userId: string, base: UserStorageKey): string {
  if (!userId) throw new Error(`userKeyFor(${base}) needs a user id`);
  return `${base}${USER_KEY_SEPARATOR}${userId}`;
}

let storageUserId: string | null = null;

/**
 * Point userKey() at a user. Called by user-session.ts when a user's database
 * becomes active, and with null when nobody is.
 */
export function setStorageUser(userId: string | null): void {
  storageUserId = userId;
}

export function storageUser(): string | null {
  return storageUserId;
}

/** Thrown by userKey() when nobody is signed in. */
export class NoStorageUserError extends Error {
  constructor(base: string) {
    super(`userKey(${base}) called with nobody signed in`);
    this.name = 'NoStorageUserError';
  }
}

/**
 * The per-user AsyncStorage key for the signed-in user.
 *
 * Throws rather than falling back to the bare key: a per-user value written
 * under no user would be read back by whoever signs in next.
 */
export function userKey(base: UserStorageKey): string {
  if (!storageUserId) throw new NoStorageUserError(base);
  return userKeyFor(storageUserId, base);
}

/** Every key userKeyFor() can produce for this user. */
export function allUserKeysFor(userId: string): string[] {
  return USER_STORAGE_KEYS.map((base) => userKeyFor(userId, base));
}
