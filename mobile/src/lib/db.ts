/**
 * The phone's local store: expo-sqlite, one database file per signed-in user.
 *
 * There is no shared database any more. Until the root layout activates the
 * signed-in user (user-session.ts activateUser), getDatabase() waits; after a
 * sign-out it refuses. Which file belongs to whom, and the rules for switching
 * between them, live in user-db.ts; the schema is local-schema.ts.
 *
 * Every user-originated write here stamps `clientUpdatedAt` with the time of
 * the change, sets `dirty = 1` and tells the local-mutation listeners, and
 * every user-originated delete of a synced row leaves a `sync_tombstones` row
 * so the deletion reaches the server (I-LOCAL-SCHEMA). Applying rows that came
 * from the server is the sync engine's job and does none of that.
 *
 * The email findings cache (email_findings) is the one table here outside
 * sync: the server's copy is the truth, so its writes stamp and announce
 * nothing.
 *
 * This file is also the one place SQLite's representations are translated:
 * 0/1 into booleans, NULL into null and a net-worth breakdown's JSON text
 * into an object, on the way out.
 */
import * as SQLite from 'expo-sqlite';
import { setActiveCurrency } from './calculations';
import { todayISO } from './dates';
import {
  DEFAULT_ACCOUNT,
  EPOCH_ISO,
  LOCAL_SYNC_TABLES,
  SYNC_ENTITIES,
  defaultAccountId,
  upgradeLocalSchema,
  type SyncEntity,
} from './local-schema';
import { billPaidChange } from './offline/bills';
import { parseBreakdown, serializeBreakdown, type Breakdown } from './offline/breakdown';
import type { LocalSyncState, RecurringFrequency } from './offline/recurring';
import {
  LEGACY_SHARED_DATABASE,
  createDatabaseFileMigration,
  databaseFileUri,
  type DatabaseFiles,
} from './storage-migration';
import {
  insertOccurrenceRow,
  isSubscriptionDecision,
  moveOccurrenceRows,
  writeDetectedSubscription,
  writeSubscriptionDecision,
  type DetectedSubscriptionWrite,
  type SubscriptionDecision,
  type SubscriptionStatus,
} from './sync/subscription-rows';
import type { Transaction } from './transaction';
import { createUserDatabaseRegistry, type UserDatabaseDriver } from './user-db';

/**
 * The slice of expo-sqlite's database the app and the sync engine use.
 * Structural, so code written against it (leaf-1.2.2's sync store, the tests)
 * does not depend on expo-sqlite itself.
 */
export type SqlBindValue = string | number | null | boolean | Uint8Array | ArrayBuffer;
export type SqlBindParams = SqlBindValue[] | Record<string, SqlBindValue>;
export interface SqlRunResult {
  lastInsertRowId: number;
  changes: number;
}
export interface SqlDb {
  getAllAsync<T>(source: string, params?: SqlBindParams): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: SqlBindParams): Promise<T | null>;
  runAsync(source: string, params?: SqlBindParams): Promise<SqlRunResult>;
  execAsync(source: string): Promise<void>;
}

/**
 * expo-sqlite's database directory, through expo-file-system. Imported when
 * first needed, the way AsyncStorage is elsewhere, so the tests (which stand
 * in for expo-sqlite and have no directory) never load it.
 */
function databaseFiles(directory: string): DatabaseFiles {
  return {
    exists: async (fileName) => {
      const FileSystem = await import('expo-file-system/legacy');
      return (await FileSystem.getInfoAsync(databaseFileUri(directory, fileName))).exists;
    },
    move: async (from, to) => {
      const FileSystem = await import('expo-file-system/legacy');
      await FileSystem.moveAsync({ from: databaseFileUri(directory, from), to: databaseFileUri(directory, to) });
    },
  };
}

let moveEarlierFile: ReturnType<typeof createDatabaseFileMigration> | null = null;

/**
 * Move this user's file from the name an earlier build gave it, before
 * anything opens it (storage-migration.ts). A failure fails the open: opening
 * now would create an empty file in front of the user's data, and the next
 * activation finishes the move instead.
 */
async function moveEarlierDatabaseFile(fileName: string): Promise<void> {
  const directory: unknown = SQLite.defaultDatabaseDirectory;
  // No directory on the web, nor in the tests' stand-in: no file to move.
  if (typeof directory !== 'string' || !directory) return;
  moveEarlierFile ??= createDatabaseFileMigration(databaseFiles(directory), {
    warn: (message, error) => console.warn(`[db] ${message}`, error ?? ''),
    info: (message) => console.log(`[db] ${message}`),
  });
  await moveEarlierFile(fileName);
}

const expoDriver: UserDatabaseDriver<SQLite.SQLiteDatabase> = {
  // A file an earlier build made is moved to its current name, then brought
  // to the current schema version here, before user-db.ts's initializer runs
  // the schema on it and decides whether it is new (local-schema.ts
  // upgradeLocalSchema says why).
  open: async (fileName) => {
    await moveEarlierDatabaseFile(fileName);
    const db = await SQLite.openDatabaseAsync(fileName);
    try {
      await upgradeLocalSchema(db, new Date().toISOString());
    } catch (e) {
      await db.closeAsync().catch(() => {});
      throw e;
    }
    return db;
  },
  close: (db) => db.closeAsync(),
  remove: async (fileName) => {
    try {
      await SQLite.deleteDatabaseAsync(fileName);
    } catch (e) {
      // expo-sqlite throws "Database <path> not found" for a file that was
      // never created, which for a delete is success.
      if (/not found/i.test(e instanceof Error ? e.message : String(e))) return;
      throw e;
    }
  },
};

const registry = createUserDatabaseRegistry(expoDriver, {
  legacyFileNames: [LEGACY_SHARED_DATABASE],
  onWarning: (message, error) => console.warn(`[db] ${message}`, error ?? ''),
});

/**
 * Open the user's database and make it the active one. Idempotent; switching
 * to another user closes the previous user's file first. Called by
 * user-session.ts activateUser, not by screens.
 */
export async function openUserDatabase(userId: string): Promise<SqlDb> {
  return registry.open(userId);
}

/** Close the active database. getDatabase() refuses until the next activation. */
export async function closeUserDatabase(): Promise<void> {
  return registry.close();
}

/** Close the user's database if it is open, then delete the file. */
export async function deleteUserDatabase(userId: string): Promise<void> {
  return registry.remove(userId);
}

/** The user whose database is open and ready, or null. */
export function activeUserId(): string | null {
  return registry.activeUserId();
}

/**
 * The active user's database. Waits while it is being opened; rejects with
 * NoActiveUserDatabaseError once nobody is signed in. Never opens a database
 * by itself.
 */
export async function getDatabase(): Promise<SqlDb> {
  return registry.get();
}

type MutationListener = () => void;
const mutationListeners = new Set<MutationListener>();

/**
 * Subscribe to local writes originating from the user (not from sync).
 * Returns an unsubscribe function. Used by cloud-sync to schedule a debounced
 * push; kept as a callback so this module never imports the network layer.
 */
export function onLocalMutation(listener: MutationListener): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function notifyLocalMutation(): void {
  for (const listener of mutationListeners) {
    try {
      listener();
    } catch {
      // A subscriber must never be able to fail a local write.
    }
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Run a write against the active user's database, one at a time.
 *
 * Serialised because the multi-statement writes below use BEGIN/COMMIT on the
 * single connection, and two interleaved transactions on one connection fail
 * ("cannot start a transaction within a transaction"). The database handle is
 * taken when the write is *requested*: a write queued behind others while the
 * user switches runs against the old user's (closed) handle and fails, rather
 * than landing in the new user's ledger. Exported for the sync engine's store,
 * whose batch writes must queue behind the user's own. Not re-entrant: never
 * call another write function of this module from inside `fn` — it would wait
 * for `fn` itself.
 */
export async function withWriteLock<T>(
  fn: (db: SqlDb, userId: string) => Promise<T>,
): Promise<T> {
  const { db, userId } = await registry.active();
  const run = writeQueue.then(() => fn(db, userId));
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function inTransaction<T>(db: SqlDb, fn: () => Promise<T>): Promise<T> {
  await db.execAsync('BEGIN');
  try {
    const result = await fn();
    await db.execAsync('COMMIT');
    return result;
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      // Nothing to roll back, or the connection is already gone.
    }
    throw e;
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Record that a synced row was deleted here, so the deletion is pushed. */
async function writeTombstone(db: SqlDb, entity: SyncEntity, id: string, at: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES (?, ?, ?)
     ON CONFLICT(entity, id) DO UPDATE SET clientUpdatedAt = excluded.clientUpdatedAt`,
    [entity, id, at],
  );
}

/** Re-creating a deleted row is newer than its deletion: the row wins. */
async function clearTombstone(db: SqlDb, entity: SyncEntity, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM sync_tombstones WHERE entity = ? AND id = ?`, [entity, id]);
}

/**
 * Move an account's derived balance by one transaction's effect.
 *
 * Exact inside the same SQLite transaction as the row it accounts for, and
 * O(1): adding rows one at a time (an import, a drain) must not re-sum the
 * whole ledger per row. recomputeBalances / recomputeAccountBalances remain
 * the authority, and the sync engine runs the latter after applying a pull.
 */
async function adjustBalance(
  db: SqlDb,
  accountId: string | null,
  tx: { amount: number; type: string },
  direction: 1 | -1,
): Promise<void> {
  if (!accountId) return;
  const signed = (tx.type === 'Income' ? tx.amount : -tx.amount) * direction;
  await db.runAsync('UPDATE accounts SET balance = balance + ? WHERE id = ?', [signed, accountId]);
}

/** balance = openingBalance + the account's ledger, for the given accounts. */
async function recomputeBalances(db: SqlDb, accountIds: (string | null | undefined)[]): Promise<void> {
  for (const id of new Set(accountIds.filter((a): a is string => !!a))) {
    await db.runAsync(
      `UPDATE accounts SET balance = openingBalance + COALESCE((
         SELECT SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE -t.amount END)
         FROM transactions t WHERE t.accountId = accounts.id
       ), 0)
       WHERE id = ?`,
      [id],
    );
  }
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  type: 'cash' | 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other';
  /** Derived: openingBalance + net of all transactions on this account. */
  balance: number;
  /** The account's balance before any recorded transaction. */
  openingBalance: number;
  currency: string;
  color: string;
  icon: string;
  isDefault: number;
  createdAt: string;
}

export interface AccountInput {
  name: string;
  type: string;
  balance: number;
  currency: string;
  color: string;
  icon: string;
  isDefault?: boolean;
  /** Defaults to `balance` — a brand-new account has no transactions yet. */
  openingBalance?: number;
  createdAt?: string;
}

const ACCOUNT_COLUMNS =
  'id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt';

export async function createAccount(account: AccountInput): Promise<string> {
  const id = newId('acc');
  const at = nowISO();
  await withWriteLock(async (db) => {
    const opening = account.openingBalance ?? account.balance;
    await db.runAsync(
      `INSERT INTO accounts (${ACCOUNT_COLUMNS}, clientUpdatedAt, dirty, syncError)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      [
        id,
        account.name,
        account.type,
        opening,
        opening,
        account.currency,
        account.color,
        account.icon,
        account.isDefault ? 1 : 0,
        account.createdAt ?? at,
        at,
      ],
    );
  });
  notifyLocalMutation();
  return id;
}

export async function getAccounts(): Promise<Account[]> {
  const database = await getDatabase();
  return database.getAllAsync<Account>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY isDefault DESC, createdAt ASC`,
  );
}

export async function getAccountById(id: string): Promise<Account | null> {
  const database = await getDatabase();
  return database.getFirstAsync<Account>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`, [id]);
}

export async function updateAccount(id: string, account: Partial<Account>): Promise<void> {
  const changed = await withWriteLock(async (db) => {
    const current = await db.getFirstAsync<Account>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`,
      [id],
    );
    if (!current) return false;

    // A caller setting `balance` is asserting "this account is now worth X".
    // Rebase openingBalance off the existing ledger so the derived balance
    // reproduces X rather than reverting the edit. `balance` itself is never
    // stored as given: it is recomputed, here as everywhere.
    let nextOpening = account.openingBalance ?? current.openingBalance;
    if (account.balance !== undefined && account.openingBalance === undefined) {
      nextOpening = account.balance - (await ledgerNet(db, id));
    }

    await db.runAsync(
      `UPDATE accounts
       SET name = ?, type = ?, openingBalance = ?, currency = ?, color = ?, icon = ?,
           clientUpdatedAt = ?, dirty = 1, syncError = NULL
       WHERE id = ?`,
      [
        account.name ?? current.name,
        account.type ?? current.type,
        nextOpening,
        account.currency ?? current.currency,
        account.color ?? current.color,
        account.icon ?? current.icon,
        nowISO(),
        id,
      ],
    );
    await recomputeBalances(db, [id]);
    return true;
  });
  if (changed) notifyLocalMutation();
}

async function ledgerNet(db: SqlDb, accountId: string): Promise<number> {
  const row = await db.getFirstAsync<{ net: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0) AS net
     FROM transactions WHERE accountId = ?`,
    [accountId],
  );
  return row?.net ?? 0;
}

/** Net effect of every transaction booked to an account (income − expense). */
export async function getAccountLedgerNet(accountId: string): Promise<number> {
  return ledgerNet(await getDatabase(), accountId);
}

/**
 * Recompute every account balance from openingBalance + its ledger.
 *
 * Idempotent, so a sync that applies the same rows twice cannot double-count.
 * A derived value: it never marks anything dirty.
 */
export async function recomputeAccountBalances(): Promise<void> {
  await withWriteLock(async (db) => {
    await db.runAsync(`
      UPDATE accounts SET balance = openingBalance + COALESCE((
        SELECT SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE -t.amount END)
        FROM transactions t WHERE t.accountId = accounts.id
      ), 0)
    `);
  });
}

export async function deleteAccount(id: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const result = await db.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
      if (result.changes > 0) await writeTombstone(db, 'accounts', id, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

// ── Transactions ─────────────────────────────────────────────────────────────

export interface TransactionInput {
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  note?: string | null;
  dateISO: string;
  accountId?: string | null;
  currency?: string;
  createdAt?: string;
  /**
   * Where the row came from, when it was not typed by hand. An imported row's
   * id starts `imp_`, so every device — not only the one that imported it —
   * can tell the subscription detector it came from a statement.
   */
  origin?: 'import';
}

/** A transactions row as SQLite returns it. */
interface TransactionRow {
  id: string;
  amount: number;
  category: string;
  type: string;
  isImpulse: number;
  note: string | null;
  dateISO: string;
  createdAt: string;
  accountId: string | null;
  currency: string | null;
}

const TRANSACTION_COLUMNS =
  'id, amount, category, type, isImpulse, note, dateISO, createdAt, accountId, currency';

/** The SQLite boundary: 0/1 becomes a boolean, NULL stays null, never undefined. */
function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    amount: row.amount,
    category: row.category,
    type: row.type === 'Income' ? 'Income' : 'Expense',
    isImpulse: row.isImpulse === 1,
    note: row.note ?? null,
    dateISO: row.dateISO,
    createdAt: row.createdAt,
    accountId: row.accountId ?? null,
    currency: row.currency ?? 'USD',
  };
}

export async function addTransaction(transaction: TransactionInput): Promise<string> {
  const id = newId(transaction.origin === 'import' ? 'imp' : 'tx');
  const at = nowISO();
  await withWriteLock((db) =>
    inTransaction(db, async () => {
      let accountId = transaction.accountId ?? null;
      if (!accountId) {
        const fallback = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM accounts WHERE isDefault = 1 ORDER BY createdAt ASC LIMIT 1',
        );
        accountId = fallback?.id ?? null;
      }
      await db.runAsync(
        `INSERT INTO transactions (${TRANSACTION_COLUMNS}, clientUpdatedAt, dirty, syncError)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
        [
          id,
          transaction.amount,
          transaction.category,
          transaction.type,
          transaction.isImpulse ? 1 : 0,
          transaction.note || null,
          transaction.dateISO,
          transaction.createdAt ?? at,
          accountId,
          transaction.currency || 'USD',
          at,
        ],
      );
      await adjustBalance(db, accountId, transaction, 1);
    }),
  );
  notifyLocalMutation();
  return id;
}

/** Rows per transaction in addTransactions: big enough to be fast, small enough to let sync writes in between. */
const BATCH_CHUNK = 100;

/**
 * Many transactions at once — a statement import.
 *
 * One row at a time cost a transaction, a balance update and a change notice
 * each, about four rows a second: a year of statements took minutes. Rows are
 * written in chunks, each chunk one transaction under the write lock (so a
 * sync can still get in between chunks), and the change is announced once.
 * Every row is stamped and marked dirty exactly as addTransaction does it.
 *
 * `onProgress` hears how many rows are saved after each chunk. A failure
 * keeps the chunks already written (onProgress has reported them) and rethrows.
 */
export async function addTransactions(
  inputs: readonly TransactionInput[],
  onProgress?: (saved: number) => void,
): Promise<string[]> {
  const ids: string[] = [];
  try {
    for (let start = 0; start < inputs.length; start += BATCH_CHUNK) {
      const chunk = inputs.slice(start, start + BATCH_CHUNK);
      const chunkIds = await withWriteLock((db) =>
        inTransaction(db, async () => {
          const fallback = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM accounts WHERE isDefault = 1 ORDER BY createdAt ASC LIMIT 1',
          );
          const written: string[] = [];
          for (const transaction of chunk) {
            const id = newId(transaction.origin === 'import' ? 'imp' : 'tx');
            const at = nowISO();
            const accountId = transaction.accountId ?? fallback?.id ?? null;
            await db.runAsync(
              `INSERT INTO transactions (${TRANSACTION_COLUMNS}, clientUpdatedAt, dirty, syncError)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
              [
                id,
                transaction.amount,
                transaction.category,
                transaction.type,
                transaction.isImpulse ? 1 : 0,
                transaction.note || null,
                transaction.dateISO,
                transaction.createdAt ?? at,
                accountId,
                transaction.currency || 'USD',
                at,
              ],
            );
            await adjustBalance(db, accountId, transaction, 1);
            written.push(id);
          }
          return written;
        }),
      );
      ids.push(...chunkIds);
      onProgress?.(ids.length);
    }
  } finally {
    if (ids.length > 0) notifyLocalMutation();
  }
  return ids;
}

export async function getTransactions(): Promise<Transaction[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions ORDER BY dateISO DESC, createdAt DESC`,
  );
  return rows.map(toTransaction);
}

export async function getTransactionsByAccount(accountId: string): Promise<Transaction[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE accountId = ?
     ORDER BY dateISO DESC, createdAt DESC`,
    [accountId],
  );
  return rows.map(toTransaction);
}

export async function getTransactionsByDateRange(startDate: string, endDate: string): Promise<Transaction[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions
     WHERE dateISO >= ? AND dateISO <= ?
     ORDER BY dateISO DESC, createdAt DESC`,
    [startDate, endDate],
  );
  return rows.map(toTransaction);
}

export async function deleteTransaction(id: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const tx = await db.getFirstAsync<{ accountId: string | null; amount: number; type: string }>(
        'SELECT accountId, amount, type FROM transactions WHERE id = ?',
        [id],
      );
      if (!tx) return false;
      await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
      await writeTombstone(db, 'transactions', id, nowISO());
      await adjustBalance(db, tx.accountId, tx, -1);
      return true;
    }),
  );
  if (deleted) notifyLocalMutation();
}

export async function updateTransaction(
  id: string,
  transaction: Omit<TransactionInput, 'createdAt'>,
): Promise<void> {
  const updated = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const before = await db.getFirstAsync<{ accountId: string | null }>(
        'SELECT accountId FROM transactions WHERE id = ?',
        [id],
      );
      if (!before) return false;
      const accountId = transaction.accountId || null;
      await db.runAsync(
        `UPDATE transactions
         SET amount = ?, category = ?, type = ?, isImpulse = ?, note = ?, dateISO = ?, accountId = ?, currency = ?,
             clientUpdatedAt = ?, dirty = 1, syncError = NULL
         WHERE id = ?`,
        [
          transaction.amount,
          transaction.category,
          transaction.type,
          transaction.isImpulse ? 1 : 0,
          transaction.note || null,
          transaction.dateISO,
          accountId,
          transaction.currency || 'USD',
          nowISO(),
          id,
        ],
      );
      // An edit can move money between accounts; both sides change.
      await recomputeBalances(db, [before.accountId, accountId]);
      return true;
    }),
  );
  if (updated) notifyLocalMutation();
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
  id: number;
  monthlyBudget: number;
  startingBalance: number;
  hourlyValue: number;
  showTimeCost: number;
  currency: string;
  currencySymbol: string;
  monthlyIncome: number;
  savingsGoal: number;
  spendingStyle: string;
  primaryGoal: string;
  /** UI language: 'en' | 'fr' | 'ar' | 'zh'. */
  locale: string;
}

const SETTINGS_COLUMNS =
  'id, monthlyBudget, startingBalance, hourlyValue, showTimeCost, currency, currencySymbol, ' +
  'monthlyIncome, savingsGoal, spendingStyle, primaryGoal, locale';

/** The settings fields a write may set, in column order. */
const SETTINGS_FIELDS = [
  'monthlyBudget',
  'startingBalance',
  'hourlyValue',
  'showTimeCost',
  'currency',
  'currencySymbol',
  'monthlyIncome',
  'savingsGoal',
  'spendingStyle',
  'primaryGoal',
  'locale',
] as const;

export async function getSettings(): Promise<Settings> {
  const database = await getDatabase();
  const settings = (await database.getFirstAsync<Settings>(
    `SELECT ${SETTINGS_COLUMNS} FROM settings WHERE id = 1`,
  )) as Settings;
  // Keep app-wide currency formatting in sync with the user's choice, so every
  // formatCurrency call site follows without threading it through.
  //
  // The language is deliberately NOT applied here, though it used to be. Any
  // read of the settings row would re-apply the *stored* language, and
  // updateSettings() reads before it writes — so choosing French ran
  // setLocale('fr'), then this line put it straight back to 'en' from the row
  // that had not been written yet.
  //
  // Language transitions have their owners in i18n/bootstrap.ts: startup,
  // activation of a user, and chooseLocale() when the user picks.
  if (settings) {
    setActiveCurrency(settings.currency, settings.currencySymbol);
  }
  return settings;
}

/** Column values for a partial settings write; `showTimeCost` accepts a boolean too. */
function settingsAssignments(settings: Partial<Settings>): { sql: string[]; params: SqlBindValue[] } {
  const sql: string[] = [];
  const params: SqlBindValue[] = [];
  for (const field of SETTINGS_FIELDS) {
    const value = settings[field];
    if (value === undefined) continue;
    sql.push(`${field} = ?`);
    params.push(field === 'showTimeCost' ? (value ? 1 : 0) : (value as SqlBindValue));
  }
  return { sql, params };
}

/** A change the user made to their settings. */
export async function updateSettings(settings: Partial<Settings>): Promise<void> {
  const { sql, params } = settingsAssignments(settings);
  if (sql.length === 0) return;
  await withWriteLock(async (db) => {
    // The row is seeded when the file is created; this only guards a file
    // whose seed was lost, and seeds it the same way (epoch, dirty).
    await db.runAsync(`INSERT OR IGNORE INTO settings (id, clientUpdatedAt, dirty) VALUES (1, ?, 1)`, [
      EPOCH_ISO,
    ]);
    await db.runAsync(
      `UPDATE settings SET ${[...sql, 'clientUpdatedAt = ?', 'dirty = 1', 'syncError = NULL'].join(', ')}
       WHERE id = 1`,
      [...params, nowISO()],
    );
  });
  notifyLocalMutation();
}

/**
 * The user's currency: the settings and the default Cash account together,
 * as one edit.
 *
 * A new database seeds its Cash account in USD before anyone has said what
 * they use, and choosing a currency used to change only the settings, so the
 * Cash account stayed in dollars whatever was picked. Every amount the app
 * shows is in the settings currency (nothing is converted when it changes),
 * so the account the app books to by default follows it. Other accounts keep
 * theirs: a linked bank's is the bank's, and one the user made is their call.
 */
export async function setPersonalCurrency(code: string, symbol: string): Promise<void> {
  await withWriteLock((db, userId) =>
    inTransaction(db, async () => {
      const at = nowISO();
      await db.runAsync(`INSERT OR IGNORE INTO settings (id, clientUpdatedAt, dirty) VALUES (1, ?, 1)`, [
        EPOCH_ISO,
      ]);
      await db.runAsync(
        `UPDATE settings SET currency = ?, currencySymbol = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
         WHERE id = 1`,
        [code, symbol, at],
      );
      // Only when it changes: re-choosing the same currency is not an edit.
      await db.runAsync(
        `UPDATE accounts SET currency = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
         WHERE id = ? AND currency <> ?`,
        [code, at, defaultAccountId(userId), code],
      );
    }),
  );
  setActiveCurrency(code, symbol);
  notifyLocalMutation();
}

/**
 * Fill in settings the device chose by itself, without claiming the user did.
 *
 * Only touches a row nobody has edited yet (clientUpdatedAt still the epoch),
 * and leaves it at the epoch, so the server's real settings still win. Used for
 * the first-run language: writing it through updateSettings() would stamp the
 * whole row as a fresh edit and push a page of zeros over the user's budget.
 */
export async function applySettingsDefaults(settings: Partial<Settings>): Promise<boolean> {
  const { sql, params } = settingsAssignments(settings);
  if (sql.length === 0) return false;
  return withWriteLock(async (db) => {
    const result = await db.runAsync(
      `UPDATE settings SET ${sql.join(', ')} WHERE id = 1 AND clientUpdatedAt = ?`,
      [...params, EPOCH_ISO],
    );
    return result.changes > 0;
  });
}

/** True while the settings row is still the seeded default nobody has edited. */
export async function isSettingsDefault(): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ clientUpdatedAt: string }>(
    'SELECT clientUpdatedAt FROM settings WHERE id = 1',
  );
  return !row || row.clientUpdatedAt === EPOCH_ISO;
}

/**
 * "Reset all activity": delete every transaction and account, and zero the
 * numbers in settings — as changes the server receives, not just a local wipe.
 *
 * Each deleted row leaves a tombstone, so the next sync deletes it on the
 * server too; without them the reset would be undone by the next pull. The
 * user's default account is reset in place to the seeded Cash account rather
 * than deleted (a ledger always needs somewhere to book to), as an edit made
 * now so it beats the server's copy. Currency, language and preferences stay.
 */
export async function resetAllData(): Promise<void> {
  await withWriteLock((db, userId) =>
    inTransaction(db, async () => {
      const at = nowISO();
      const keep = defaultAccountId(userId);

      await db.runAsync(
        `INSERT INTO sync_tombstones (entity, id, clientUpdatedAt)
         SELECT 'transactions', id, ? FROM transactions WHERE 1
         ON CONFLICT(entity, id) DO UPDATE SET clientUpdatedAt = excluded.clientUpdatedAt`,
        [at],
      );
      await db.runAsync(`DELETE FROM transactions`);

      await db.runAsync(
        `INSERT INTO sync_tombstones (entity, id, clientUpdatedAt)
         SELECT 'accounts', id, ? FROM accounts WHERE id <> ?
         ON CONFLICT(entity, id) DO UPDATE SET clientUpdatedAt = excluded.clientUpdatedAt`,
        [at, keep],
      );
      await db.runAsync(`DELETE FROM accounts WHERE id <> ?`, [keep]);
      // Re-created in the user's currency, not the seed's USD (setPersonalCurrency).
      await db.runAsync(
        `INSERT INTO accounts
           (id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt, clientUpdatedAt, dirty, syncError)
         VALUES (?, ?, ?, 0, 0, COALESCE((SELECT currency FROM settings WHERE id = 1), ?), ?, ?, 1, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, type = excluded.type, balance = 0, openingBalance = 0,
           color = excluded.color, icon = excluded.icon, isDefault = 1,
           clientUpdatedAt = excluded.clientUpdatedAt, dirty = 1, syncError = NULL`,
        [
          keep,
          DEFAULT_ACCOUNT.name,
          DEFAULT_ACCOUNT.type,
          DEFAULT_ACCOUNT.currency,
          DEFAULT_ACCOUNT.color,
          DEFAULT_ACCOUNT.icon,
          at,
          at,
        ],
      );
      await clearTombstone(db, 'accounts', keep);

      await db.runAsync(`INSERT OR IGNORE INTO settings (id, clientUpdatedAt, dirty) VALUES (1, ?, 1)`, [
        EPOCH_ISO,
      ]);
      await db.runAsync(
        `UPDATE settings
         SET startingBalance = 0, monthlyBudget = 0, hourlyValue = 0, showTimeCost = 0,
             monthlyIncome = 0, savingsGoal = 0,
             clientUpdatedAt = ?, dirty = 1, syncError = NULL
         WHERE id = 1`,
        [at],
      );
    }),
  );
  notifyLocalMutation();
}

// ── Subscriptions ────────────────────────────────────────────────────────────
//
// A subscription carries the user's decision beside the engine's status, and
// the user's always wins (Phase 6 decision 3): the engine's write
// (upsertSubscription) never changes the decision or the cancellation date of
// an existing row, and keeps its status following the decision. The rules are
// SQL, in sync/subscription-rows.ts, shared with the end-to-end sync test.

export type { SubscriptionDecision, SubscriptionStatus } from './sync/subscription-rows';

/** Where a subscription was seen. `sources` lists every one, comma-separated. */
export type SubscriptionSource = 'transaction' | 'import' | 'bank' | 'email' | 'manual';
export type SubscriptionCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'unknown';
export type SubscriptionAlert = 'price_rise' | 'charged_after_cancel' | 'trial_ending';
/** Where it is billed, and so where it must be cancelled. */
export type BilledVia = 'apple' | 'google_play' | 'paypal';

export interface Subscription {
  id: string;
  merchantDisplay: string;
  merchantNormalized: string;
  cadence: SubscriptionCadence;
  typicalAmount: number;
  currency: string;
  confidenceScore: number;
  lastChargedAt: string | null;
  nextExpectedAt: string | null;
  /** The engine's reading while there is no decision; the decision's status once there is. */
  status: SubscriptionStatus;
  cancelUrl: string | null;
  cancelNotes: string | null;
  source: SubscriptionSource;
  createdAt: string;
  /** When the row last changed, on any device. */
  updatedAt: string;
  // Phase 6. Every read returns them; they are optional so that a caller
  // building a row the Phase 5 way still compiles, and on a write, a field it
  // leaves out keeps what is stored (upsertSubscription).
  /** The user's: keep, cancel or dismiss; null while they have not said. */
  decision?: SubscriptionDecision | null;
  /** YYYY-MM-DD the user cancelled it. */
  canceledAt?: string | null;
  /** YYYY-MM-DD a free trial converts to a paid plan. */
  trialEndsAt?: string | null;
  /** The price before the last rise, and the day it rose (YYYY-MM-DD). */
  previousAmount?: number | null;
  priceChangedAt?: string | null;
  alert?: SubscriptionAlert | null;
  /** Comma list of every SubscriptionSource that saw it. */
  sources?: string;
  billedVia?: BilledVia | null;
}

export interface SubscriptionOccurrence {
  id: string;
  subscriptionId: string;
  transactionId: string | null;
  chargedAt: string;
  amount: number;
}

const SUBSCRIPTION_SELECT =
  `SELECT id, merchantDisplay, merchantNormalized, cadence, typicalAmount, currency, confidenceScore, ` +
  `lastChargedAt, nextExpectedAt, status, cancelUrl, cancelNotes, source, createdAt, ` +
  `clientUpdatedAt AS updatedAt, decision, canceledAt, trialEndsAt, previousAmount, priceChangedAt, ` +
  `alert, sources, billedVia FROM subscriptions`;

export async function getSubscriptions(status?: string): Promise<Subscription[]> {
  const database = await getDatabase();
  if (status) {
    return database.getAllAsync<Subscription>(
      `${SUBSCRIPTION_SELECT} WHERE status = ? ORDER BY nextExpectedAt ASC, id ASC`,
      [status],
    );
  }
  return database.getAllAsync<Subscription>(`${SUBSCRIPTION_SELECT} ORDER BY nextExpectedAt ASC, id ASC`);
}

export async function getSubscriptionById(id: string): Promise<Subscription | null> {
  const database = await getDatabase();
  return database.getFirstAsync<Subscription>(`${SUBSCRIPTION_SELECT} WHERE id = ?`, [id]);
}

export type SubscriptionUpsert = Omit<Subscription, 'createdAt' | 'updatedAt'> & { createdAt?: string };

/**
 * The detection engine's write (and the email scan's): insert the
 * subscription, or update what was found about it.
 *
 * On an existing row it never changes `decision`, `canceledAt` or the user's
 * `cancelNotes`, and while there is a decision `status` stays the one that
 * follows it, whatever the engine proposes — enforced in the UPDATE itself
 * (sync/subscription-rows.ts). A Phase 6 field left undefined keeps what is
 * stored; null clears it. A new row takes a decision only if one is given.
 *
 * The row is stamped and marked dirty only when a value actually changed. A
 * re-scan re-derives every subscription from the same ledger, and stamping
 * them all would re-upload every one of them on every scan — and, worse, make
 * this device's unchanged copy "newer" than an edit made on another device.
 * Returns true when it wrote.
 */
export async function upsertSubscription(sub: SubscriptionUpsert): Promise<boolean> {
  const values: DetectedSubscriptionWrite['values'] = {
    merchantDisplay: sub.merchantDisplay,
    merchantNormalized: sub.merchantNormalized,
    cadence: sub.cadence,
    typicalAmount: sub.typicalAmount,
    currency: sub.currency || 'USD',
    confidenceScore: sub.confidenceScore,
    lastChargedAt: sub.lastChargedAt ?? null,
    nextExpectedAt: sub.nextExpectedAt ?? null,
    status: sub.status,
    cancelUrl: sub.cancelUrl,
    cancelNotes: sub.cancelNotes,
    source: sub.source || 'transaction',
    decision: sub.decision,
    canceledAt: sub.canceledAt,
    trialEndsAt: sub.trialEndsAt,
    previousAmount: sub.previousAmount,
    priceChangedAt: sub.priceChangedAt,
    alert: sub.alert,
    sources: sub.sources,
    billedVia: sub.billedVia,
  };
  const at = nowISO();
  const changed = await withWriteLock((db) =>
    inTransaction(db, () => writeDetectedSubscription(db, { id: sub.id, values, createdAt: sub.createdAt, at })),
  );
  if (changed) notifyLocalMutation();
  return changed;
}

/**
 * The user's decision about a subscription: keep → confirmed, cancel →
 * canceled (canceledAt `opts.canceledAt`, by default today's local date),
 * dismiss → dismissed, null → possible (back to the engine). A user write:
 * stamps clientUpdatedAt, marks the row for sync and tells the listeners.
 * Returns false, changing nothing, when the row is missing or already says this.
 */
export async function setSubscriptionDecision(
  id: string,
  decision: SubscriptionDecision | null,
  opts: { canceledAt?: string } = {},
): Promise<boolean> {
  if (decision !== null && !isSubscriptionDecision(decision)) {
    throw new Error(`Not a subscription decision: ${String(decision)}`);
  }
  const canceledAt = decision === 'cancel' ? (opts.canceledAt ?? todayISO()) : null;
  const changed = await withWriteLock((db) =>
    writeSubscriptionDecision(db, id, decision, { canceledAt, at: nowISO() }),
  );
  if (changed) notifyLocalMutation();
  return changed;
}

/**
 * The Phase 5 screens' write, kept for them until they move to
 * setSubscriptionDecision: a status that follows a decision sets it
 * (confirmed → keep, canceled → cancel, dismissed → dismiss); any other takes
 * the decision back.
 */
export async function updateSubscriptionStatus(id: string, status: SubscriptionStatus): Promise<void> {
  const decision: SubscriptionDecision | null =
    status === 'confirmed' ? 'keep' : status === 'canceled' ? 'cancel' : status === 'dismissed' ? 'dismiss' : null;
  await setSubscriptionDecision(id, decision);
}

export async function updateSubscriptionCancelInfo(
  id: string,
  cancelUrl: string | null,
  cancelNotes: string | null,
): Promise<void> {
  await withWriteLock((db) =>
    db.runAsync(
      `UPDATE subscriptions SET cancelUrl = ?, cancelNotes = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
       WHERE id = ?`,
      [cancelUrl, cancelNotes, nowISO(), id],
    ),
  );
  notifyLocalMutation();
}

/**
 * Delete a subscription outright, with a tombstone so the deletion syncs.
 * For the engine's merges only: in the app a user's "delete" is a dismissal
 * (setSubscriptionDecision(id, 'dismiss')), which a later import cannot undo.
 */
export async function deleteSubscription(id: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      await db.runAsync(`DELETE FROM subscription_occurrences WHERE subscriptionId = ?`, [id]);
      const result = await db.runAsync(`DELETE FROM subscriptions WHERE id = ?`, [id]);
      if (result.changes > 0) await writeTombstone(db, 'subscriptions', id, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

/**
 * Move a subscription's charge history onto another, when the engine merges
 * `fromId` into `toId`; a charge `toId` already holds is not doubled. Local
 * only (occurrences never sync), so it neither stamps nor notifies. Returns
 * how many moved.
 */
export async function moveSubscriptionOccurrences(fromId: string, toId: string): Promise<number> {
  return withWriteLock((db) => inTransaction(db, () => moveOccurrenceRows(db, fromId, toId)));
}

export async function getSubscriptionOccurrences(subscriptionId: string): Promise<SubscriptionOccurrence[]> {
  const database = await getDatabase();
  return database.getAllAsync<SubscriptionOccurrence>(
    `SELECT id, subscriptionId, transactionId, chargedAt, amount FROM subscription_occurrences
     WHERE subscriptionId = ? ORDER BY chargedAt DESC, id ASC`,
    [subscriptionId],
  );
}

/**
 * Record one charge against a subscription. Local only: occurrences are
 * re-derived from the ledger on every device, so they are never synced.
 *
 * `id` must be deterministic (see occurrenceId in lib/subscriptions/engine).
 * It used to be generated randomly here and then guarded with INSERT OR
 * IGNORE — which had nothing to collide with, so every scan re-appended the
 * same occurrences and the charge history grew without bound. A charge moved
 * here from a merged subscription keeps its old id, so the same transaction
 * under the same subscription is not recorded twice either.
 */
export async function addSubscriptionOccurrence(occ: SubscriptionOccurrence): Promise<void> {
  await withWriteLock((db) => insertOccurrenceRow(db, occ));
}

/** Delete every subscription, as deletions the server receives. */
export async function clearSubscriptions(): Promise<void> {
  await withWriteLock((db) =>
    inTransaction(db, async () => {
      await db.runAsync(
        `INSERT INTO sync_tombstones (entity, id, clientUpdatedAt)
         SELECT 'subscriptions', id, ? FROM subscriptions WHERE 1
         ON CONFLICT(entity, id) DO UPDATE SET clientUpdatedAt = excluded.clientUpdatedAt`,
        [nowISO()],
      );
      await db.runAsync(`DELETE FROM subscription_occurrences`);
      await db.runAsync(`DELETE FROM subscriptions`);
    }),
  );
  notifyLocalMutation();
}

// ── Email findings (a local cache, never synced) ─────────────────────────────
//
// What the server read from the user's mailboxes, as pulled from
// GET /email/findings (EmailFindingDTO, I-EMAIL-API). The detection engine
// reads them beside the ledger. Not a synced table: no dirty flag, no
// clientUpdatedAt, nothing pushed and no listener told — the server has them
// and can send them again. Deleted with the user's file on sign-out.

export type EmailFindingKind = 'renewal' | 'receipt' | 'trial_ending' | 'price_change' | 'cancellation' | 'other';
export type EmailFindingSource = 'gmail' | 'outlook' | 'forwarding';

/** One finding as the server sends it (EmailFindingDTO); `id` is the server's. */
export interface LocalEmailFinding {
  id: string;
  connectionId: string | null;
  source: EmailFindingSource;
  kind: EmailFindingKind;
  merchant: string | null;
  senderDomain: string | null;
  billedVia: BilledVia | null;
  amount: number | null;
  currency: string | null;
  cadence: SubscriptionCadence;
  chargedISO: string | null;
  emailDateISO: string | null;
  nextChargeISO: string | null;
  trialEndsISO: string | null;
  previousAmount: number | null;
  confidence: number;
  /** ISO time the server stored it: the findings cursor. */
  receivedAt: string;
}

const EMAIL_FINDING_COLUMNS = [
  'id',
  'connectionId',
  'source',
  'kind',
  'merchant',
  'senderDomain',
  'billedVia',
  'amount',
  'currency',
  'cadence',
  'chargedISO',
  'emailDateISO',
  'nextChargeISO',
  'trialEndsISO',
  'previousAmount',
  'confidence',
  'receivedAt',
] as const satisfies readonly (keyof LocalEmailFinding)[];

const FINDING_KINDS: readonly string[] = ['renewal', 'receipt', 'trial_ending', 'price_change', 'cancellation', 'other'];
const FINDING_SOURCES: readonly string[] = ['gmail', 'outlook', 'forwarding'];
const FINDING_CADENCES: readonly string[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'unknown'];
const BILLED_VIA: readonly string[] = ['apple', 'google_play', 'paypal'];

const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const oneOf = (v: unknown, allowed: readonly string[], fallback: string | null): string | null =>
  typeof v === 'string' && allowed.includes(v) ? v : fallback;

/**
 * A finding as it is stored, or null for one that cannot be (no id, no time).
 * The server's values pass through; anything outside the DTO's types becomes
 * its "unknown" (null, 'other', 'unknown', confidence 0) rather than garbage.
 */
function toFindingRow(raw: LocalEmailFinding): SqlBindValue[] | null {
  const id = textOrNull(raw?.id);
  const receivedAt = textOrNull(raw?.receivedAt);
  if (!id || !receivedAt) return null;
  const row: Record<(typeof EMAIL_FINDING_COLUMNS)[number], SqlBindValue> = {
    id,
    connectionId: textOrNull(raw.connectionId),
    source: oneOf(raw.source, FINDING_SOURCES, 'forwarding'),
    kind: oneOf(raw.kind, FINDING_KINDS, 'other'),
    merchant: textOrNull(raw.merchant),
    senderDomain: textOrNull(raw.senderDomain),
    billedVia: oneOf(raw.billedVia, BILLED_VIA, null),
    amount: numberOrNull(raw.amount),
    currency: textOrNull(raw.currency),
    cadence: oneOf(raw.cadence, FINDING_CADENCES, 'unknown'),
    chargedISO: textOrNull(raw.chargedISO),
    emailDateISO: textOrNull(raw.emailDateISO),
    nextChargeISO: textOrNull(raw.nextChargeISO),
    trialEndsISO: textOrNull(raw.trialEndsISO),
    previousAmount: numberOrNull(raw.previousAmount),
    confidence: numberOrNull(raw.confidence) ?? 0,
    receivedAt,
  };
  return EMAIL_FINDING_COLUMNS.map((c) => row[c]);
}

/**
 * Store findings pulled from the server, replacing any held under the same id.
 * One that has no id or no receivedAt is skipped. Returns how many were not
 * held before.
 */
export async function upsertEmailFindings(rows: readonly LocalEmailFinding[]): Promise<number> {
  const prepared = rows.map(toFindingRow).filter((r): r is SqlBindValue[] => r !== null);
  if (prepared.length === 0) return 0;
  const assignments = EMAIL_FINDING_COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  const ids = [...new Set(prepared.map((values) => values[0] as string))];
  return withWriteLock((db) =>
    inTransaction(db, async () => {
      const held = new Set<string>();
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400);
        const rows = await db.getAllAsync<{ id: string }>(
          `SELECT id FROM email_findings WHERE id IN (${part.map(() => '?').join(', ')})`,
          part,
        );
        for (const r of rows) held.add(r.id);
      }
      for (const values of prepared) {
        await db.runAsync(
          `INSERT INTO email_findings (${EMAIL_FINDING_COLUMNS.join(', ')})
           VALUES (${EMAIL_FINDING_COLUMNS.map(() => '?').join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${assignments.join(', ')}`,
          values,
        );
      }
      return ids.filter((id) => !held.has(id)).length;
    }),
  );
}

/** Every cached finding, oldest first by when the server stored it. */
export async function getEmailFindings(): Promise<LocalEmailFinding[]> {
  const database = await getDatabase();
  return database.getAllAsync<LocalEmailFinding>(
    `SELECT ${EMAIL_FINDING_COLUMNS.join(', ')} FROM email_findings ORDER BY receivedAt ASC, id ASC`,
  );
}

/**
 * Forget findings: those with the given ids, or every one when no list is
 * given. An empty list deletes nothing. Returns how many went.
 */
export async function deleteEmailFindings(ids?: readonly string[]): Promise<number> {
  if (ids !== undefined && ids.length === 0) return 0;
  return withWriteLock((db) =>
    inTransaction(db, async () => {
      if (ids === undefined) return (await db.runAsync(`DELETE FROM email_findings`)).changes;
      let deleted = 0;
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400);
        const result = await db.runAsync(
          `DELETE FROM email_findings WHERE id IN (${part.map(() => '?').join(', ')})`,
          [...part],
        );
        deleted += result.changes;
      }
      return deleted;
    }),
  );
}

// ── Custom (user-created) categories ─────────────────────────────────────────

export interface CustomCategory {
  name: string;
  icon: string;
  color: string;
  createdAt: string;
}

export async function getCustomCategories(): Promise<CustomCategory[]> {
  const database = await getDatabase();
  return database.getAllAsync<CustomCategory>(
    `SELECT name, icon, color, createdAt FROM custom_categories ORDER BY createdAt ASC`,
  );
}

/** Create a category, or restyle one of the same name. Its sync id is the name. */
export async function addCustomCategory(cat: { name: string; icon: string; color: string }): Promise<void> {
  const name = cat.name.trim();
  await withWriteLock((db) =>
    inTransaction(db, async () => {
      const at = nowISO();
      await db.runAsync(
        `INSERT INTO custom_categories (name, icon, color, createdAt, clientUpdatedAt, dirty, syncError)
         VALUES (?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(name) DO UPDATE SET
           icon = excluded.icon, color = excluded.color,
           clientUpdatedAt = excluded.clientUpdatedAt, dirty = 1, syncError = NULL`,
        [name, cat.icon, cat.color, at, at],
      );
      await clearTombstone(db, 'categories', name);
    }),
  );
  notifyLocalMutation();
}

export async function deleteCustomCategory(name: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const result = await db.runAsync(`DELETE FROM custom_categories WHERE name = ?`, [name]);
      if (result.changes > 0) await writeTombstone(db, 'categories', name, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

// ── Recurring series ─────────────────────────────────────────────────────────
//
// Synced since Phase 4 (entity `recurring`). The server books their
// occurrences — the recurring job, and run-now (POST /recurring/:id/run) —
// and moves nextDate and lastCreated as it does; those come back by pull. A
// write here sends the series as this phone has it, and the server keeps its
// own booking state over an older one (I-WIRE-4), so nothing here moves them.

export interface RecurringSeries {
  id: string;
  /** Where occurrences are booked; null, or an account since deleted, means the default account. */
  accountId: string | null;
  name: string;
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  frequency: RecurringFrequency;
  startDate: string;
  nextDate: string;
  lastCreated: string | null;
  isActive: boolean;
  currency: string;
  createdAt: string;
}

export interface RecurringInput {
  accountId: string | null;
  name: string;
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  frequency: RecurringFrequency;
  startDate: string;
  nextDate: string;
  currency: string;
}

interface RecurringRow extends Omit<RecurringSeries, 'isImpulse' | 'isActive'> {
  isImpulse: number;
  isActive: number;
}

const RECURRING_COLUMNS =
  'id, accountId, name, amount, category, type, isImpulse, frequency, startDate, nextDate, lastCreated, isActive, currency, createdAt';

function toRecurring(row: RecurringRow): RecurringSeries {
  return {
    ...row,
    accountId: row.accountId ?? null,
    type: row.type === 'Income' ? 'Income' : 'Expense',
    isImpulse: row.isImpulse === 1,
    lastCreated: row.lastCreated ?? null,
    isActive: row.isActive === 1,
  };
}

export async function getRecurring(): Promise<RecurringSeries[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<RecurringRow>(
    `SELECT ${RECURRING_COLUMNS} FROM recurring_transactions ORDER BY nextDate ASC, id ASC`,
  );
  return rows.map(toRecurring);
}

/** A new series, active and never booked. Its id is minted here, rec_…, as the server's are. */
export async function addRecurring(input: RecurringInput): Promise<string> {
  const id = newId('rec');
  const at = nowISO();
  await withWriteLock((db) =>
    db.runAsync(
      `INSERT INTO recurring_transactions (${RECURRING_COLUMNS}, clientUpdatedAt, dirty, syncError)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, 1, NULL)`,
      [
        id,
        input.accountId || null,
        input.name,
        input.amount,
        input.category,
        input.type,
        input.isImpulse ? 1 : 0,
        input.frequency,
        input.startDate,
        input.nextDate,
        input.currency || 'USD',
        at,
        at,
      ],
    ),
  );
  notifyLocalMutation();
  return id;
}

/**
 * Pause or resume a series. A no-op when it already is: the row a tap acted
 * on may be older than the one a pull has since written.
 */
export async function setRecurringActive(id: string, active: boolean): Promise<void> {
  const changed = await withWriteLock(async (db) => {
    const result = await db.runAsync(
      `UPDATE recurring_transactions SET isActive = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
       WHERE id = ? AND isActive <> ?`,
      [active ? 1 : 0, nowISO(), id, active ? 1 : 0],
    );
    return result.changes > 0;
  });
  if (changed) notifyLocalMutation();
}

/** Delete a series. The occurrences it already booked stay: they are transactions. */
export async function deleteRecurring(id: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const result = await db.runAsync(`DELETE FROM recurring_transactions WHERE id = ?`, [id]);
      if (result.changes > 0) await writeTombstone(db, 'recurring', id, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

// ── Bill reminders ───────────────────────────────────────────────────────────
//
// Synced since Phase 4 (entity `billReminders`). The server's notifier moves
// a recurring bill on when it fires, as a server write that wins over an
// older copy here; when it last fired is the server's own and never synced.

export interface BillReminder {
  id: string;
  name: string;
  amount: number;
  /** Day of the month it falls due, 1–31. */
  dueDay: number;
  category: string;
  isRecurring: boolean;
  isPaid: boolean;
  /** When it was marked paid (ISO), or null. */
  paidAt: string | null;
  nextDueDate: string;
  createdAt: string;
}

export interface BillReminderInput {
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  isRecurring: boolean;
  nextDueDate: string;
}

interface BillReminderRow extends Omit<BillReminder, 'isRecurring' | 'isPaid'> {
  isRecurring: number;
  isPaid: number;
}

const BILL_COLUMNS = 'id, name, amount, dueDay, category, isRecurring, isPaid, paidAt, nextDueDate, createdAt';

function toBillReminder(row: BillReminderRow): BillReminder {
  return { ...row, isRecurring: row.isRecurring === 1, isPaid: row.isPaid === 1, paidAt: row.paidAt ?? null };
}

export async function getBillReminders(): Promise<BillReminder[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<BillReminderRow>(
    `SELECT ${BILL_COLUMNS} FROM bill_reminders ORDER BY isPaid ASC, nextDueDate ASC, id ASC`,
  );
  return rows.map(toBillReminder);
}

/** A new bill, unpaid. Its id is minted here, bill_…, as the server's are. */
export async function addBillReminder(input: BillReminderInput): Promise<string> {
  const id = newId('bill');
  const at = nowISO();
  await withWriteLock((db) =>
    db.runAsync(
      `INSERT INTO bill_reminders (${BILL_COLUMNS}, clientUpdatedAt, dirty, syncError)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 1, NULL)`,
      [id, input.name, input.amount, input.dueDay, input.category, input.isRecurring ? 1 : 0, input.nextDueDate, at, at],
    ),
  );
  notifyLocalMutation();
  return id;
}

/**
 * Mark a bill paid or unpaid (billPaidChange: a recurring bill moves on a
 * month when paid, and back when un-paid). Decided from the row as it is now,
 * inside the write lock, not from the copy the screen drew: asking for what
 * the bill already is changes nothing. True when it changed.
 */
export async function setBillPaid(id: string, paid: boolean): Promise<boolean> {
  const changed = await withWriteLock(async (db) => {
    const row = await db.getFirstAsync<BillReminderRow>(`SELECT ${BILL_COLUMNS} FROM bill_reminders WHERE id = ?`, [id]);
    if (!row) return false;
    const at = nowISO();
    const next = billPaidChange(toBillReminder(row), paid, at);
    if (!next) return false;
    await db.runAsync(
      `UPDATE bill_reminders SET isPaid = ?, paidAt = ?, nextDueDate = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
       WHERE id = ?`,
      [next.isPaid ? 1 : 0, next.paidAt, next.nextDueDate, at, id],
    );
    return true;
  });
  if (changed) notifyLocalMutation();
  return changed;
}

export async function deleteBillReminder(id: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const result = await db.runAsync(`DELETE FROM bill_reminders WHERE id = ?`, [id]);
      if (result.changes > 0) await writeTombstone(db, 'billReminders', id, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

// ── Category budgets ─────────────────────────────────────────────────────────
//
// Synced since Phase 4 (entity `categoryBudgets`), keyed by category on the
// wire and here: one budget per category. The server's own row id for a
// budget never leaves the server.

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

export interface CategoryBudget {
  category: string;
  amount: number;
  period: BudgetPeriod;
  createdAt: string;
}

export async function getCategoryBudgets(): Promise<CategoryBudget[]> {
  const database = await getDatabase();
  return database.getAllAsync<CategoryBudget>(
    `SELECT category, amount, period, createdAt FROM category_budgets ORDER BY createdAt ASC, category ASC`,
  );
}

/** Set a category's limit: creates its budget, or replaces the limit of the one it has. */
export async function setCategoryBudget(category: string, amount: number, period: BudgetPeriod = 'monthly'): Promise<void> {
  await withWriteLock((db) =>
    inTransaction(db, async () => {
      const at = nowISO();
      await db.runAsync(
        `INSERT INTO category_budgets (category, amount, period, createdAt, clientUpdatedAt, dirty, syncError)
         VALUES (?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(category) DO UPDATE SET
           amount = excluded.amount, period = excluded.period,
           clientUpdatedAt = excluded.clientUpdatedAt, dirty = 1, syncError = NULL`,
        [category, amount, period, at, at],
      );
      await clearTombstone(db, 'categoryBudgets', category);
    }),
  );
  notifyLocalMutation();
}

export async function deleteCategoryBudget(category: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const result = await db.runAsync(`DELETE FROM category_budgets WHERE category = ?`, [category]);
      if (result.changes > 0) await writeTombstone(db, 'categoryBudgets', category, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

// ── Net-worth snapshots ──────────────────────────────────────────────────────
//
// Synced since Phase 4 (entity `netWorth`). The breakdown is stored and sent
// as JSON text (I-WIRE-4) and is an object everywhere outside this file.

export interface NetWorthEntry {
  id: string;
  /** The local calendar date it was taken. */
  date: string;
  assets: number;
  liabilities: number;
  /** Always assets − liabilities. */
  netWorth: number;
  breakdown: Breakdown | null;
  createdAt: string;
}

export interface NetWorthInput {
  date: string;
  assets: number;
  liabilities: number;
  breakdown?: Breakdown | null;
}

export async function getNetWorthEntries(): Promise<NetWorthEntry[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Omit<NetWorthEntry, 'breakdown'> & { breakdown: string | null }>(
    `SELECT id, date, assets, liabilities, netWorth, breakdown, createdAt FROM net_worth_entries
     ORDER BY date DESC, createdAt DESC, id ASC`,
  );
  return rows.map((row) => ({ ...row, breakdown: parseBreakdown(row.breakdown) }));
}

/** A new snapshot. Its id is minted here, nw_…; netWorth is derived, as the server stores it. */
export async function addNetWorthEntry(input: NetWorthInput): Promise<string> {
  const id = newId('nw');
  const at = nowISO();
  await withWriteLock((db) =>
    db.runAsync(
      `INSERT INTO net_worth_entries (id, date, assets, liabilities, netWorth, breakdown, createdAt, clientUpdatedAt, dirty, syncError)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      [
        id,
        input.date,
        input.assets,
        input.liabilities,
        input.assets - input.liabilities,
        serializeBreakdown(input.breakdown),
        at,
        at,
      ],
    ),
  );
  notifyLocalMutation();
  return id;
}

/** Delete a snapshot taken by mistake; the deletion syncs like any other. */
export async function deleteNetWorthEntry(id: string): Promise<void> {
  const deleted = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const result = await db.runAsync(`DELETE FROM net_worth_entries WHERE id = ?`, [id]);
      if (result.changes > 0) await writeTombstone(db, 'netWorth', id, nowISO());
      return result.changes > 0;
    }),
  );
  if (deleted) notifyLocalMutation();
}

// ── Sync bookkeeping ─────────────────────────────────────────────────────────

/**
 * Where one synced row stands with the server (offline/recurring.ts
 * LocalSyncState). `id` is the sync id; the settings row is 'settings'.
 */
export async function getLocalSyncState(entity: SyncEntity, id: string): Promise<LocalSyncState> {
  const database = await getDatabase();
  const { table, idColumn } = LOCAL_SYNC_TABLES[entity];
  const row = await database.getFirstAsync<{ dirty: number; syncError: string | null }>(
    `SELECT dirty, syncError FROM ${table} WHERE ${idColumn} = ?`,
    [entity === 'settings' ? 1 : id],
  );
  if (!row) return 'missing';
  if (row.syncError !== null) return 'refused';
  return row.dirty === 1 ? 'pending' : 'synced';
}

export interface UnsyncedChanges {
  /** Edited rows not yet accepted by the server, per entity. */
  byEntity: Record<SyncEntity, number>;
  /** Deletions not yet sent. */
  deletions: number;
  total: number;
}

/**
 * What would be lost if this user's database were deleted now.
 *
 * Seeded defaults are dirty too (decision 6), but they are not anyone's work —
 * they are recreated by the next device to open the account — so rows still at
 * the epoch do not count.
 */
export async function countUnsyncedChanges(): Promise<UnsyncedChanges> {
  const database = await getDatabase();
  const byEntity = {} as Record<SyncEntity, number>;
  let total = 0;
  for (const entity of SYNC_ENTITIES) {
    const { table } = LOCAL_SYNC_TABLES[entity];
    const row = await database.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE dirty = 1 AND clientUpdatedAt <> ?`,
      [EPOCH_ISO],
    );
    byEntity[entity] = row?.n ?? 0;
    total += byEntity[entity];
  }
  const tombstones = await database.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_tombstones`);
  const deletions = tombstones?.n ?? 0;
  return { byEntity, deletions, total: total + deletions };
}

