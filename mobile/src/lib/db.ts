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
 * This file is also the one place SQLite's representations are translated:
 * 0/1 into booleans and NULL into null, on the way out.
 */
import * as SQLite from 'expo-sqlite';
import { setActiveCurrency } from './calculations';
import {
  DEFAULT_ACCOUNT,
  EPOCH_ISO,
  LOCAL_SYNC_TABLES,
  SYNC_ENTITIES,
  defaultAccountId,
  type SyncEntity,
} from './local-schema';
import type { Transaction } from './transaction';
import { createUserDatabaseRegistry, type UserDatabaseDriver } from './user-db';

/**
 * The slice of expo-sqlite's database the app and the sync engine use.
 * Structural, so code written against it (leaf-1.2.2's sync store, the tests)
 * does not depend on expo-sqlite itself.
 */
export type SqlBindValue = string | number | null | boolean | Uint8Array;
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

/** The shared file every user used to read and write. Test data; deleted, not migrated. */
const LEGACY_SHARED_DATABASE = 'real_budget.db';

const expoDriver: UserDatabaseDriver<SQLite.SQLiteDatabase> = {
  open: (fileName) => SQLite.openDatabaseAsync(fileName),
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
  type: 'cash' | 'checking' | 'savings' | 'credit' | 'investment' | 'other';
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
  const id = newId('tx');
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
      await db.runAsync(
        `INSERT INTO accounts
           (id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt, clientUpdatedAt, dirty, syncError)
         VALUES (?, ?, ?, 0, 0, ?, ?, ?, 1, ?, ?, 1, NULL)
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

export interface Subscription {
  id: string;
  merchantDisplay: string;
  merchantNormalized: string;
  cadence: 'weekly' | 'monthly' | 'yearly' | 'unknown';
  typicalAmount: number;
  currency: string;
  confidenceScore: number;
  lastChargedAt: string | null;
  nextExpectedAt: string | null;
  status: 'confirmed' | 'possible' | 'canceled';
  cancelUrl: string | null;
  cancelNotes: string | null;
  source: 'transaction' | 'email';
  createdAt: string;
  /** When the row last changed, on any device. */
  updatedAt: string;
}

export interface SubscriptionOccurrence {
  id: string;
  subscriptionId: string;
  transactionId: string | null;
  chargedAt: string;
  amount: number;
}

/** The fields that travel with a subscription and that a re-scan may change. */
const SUBSCRIPTION_FIELDS = [
  'merchantDisplay',
  'merchantNormalized',
  'cadence',
  'typicalAmount',
  'currency',
  'confidenceScore',
  'lastChargedAt',
  'nextExpectedAt',
  'status',
  'cancelUrl',
  'cancelNotes',
  'source',
] as const;

const SUBSCRIPTION_SELECT =
  `SELECT id, ${SUBSCRIPTION_FIELDS.join(', ')}, createdAt, clientUpdatedAt AS updatedAt FROM subscriptions`;

export async function getSubscriptions(status?: string): Promise<Subscription[]> {
  const database = await getDatabase();
  if (status) {
    return database.getAllAsync<Subscription>(
      `${SUBSCRIPTION_SELECT} WHERE status = ? ORDER BY nextExpectedAt ASC`,
      [status],
    );
  }
  return database.getAllAsync<Subscription>(`${SUBSCRIPTION_SELECT} ORDER BY nextExpectedAt ASC`);
}

export async function getSubscriptionById(id: string): Promise<Subscription | null> {
  const database = await getDatabase();
  return database.getFirstAsync<Subscription>(`${SUBSCRIPTION_SELECT} WHERE id = ?`, [id]);
}

type SubscriptionUpsert = Omit<Subscription, 'createdAt' | 'updatedAt'> & { createdAt?: string };

/**
 * Write what the detection engine (or the email scan) found.
 *
 * The row is stamped and marked dirty only when a value actually changed. A
 * re-scan re-derives every subscription from the same ledger, and stamping
 * them all would re-upload every one of them on every scan — and, worse, make
 * this device's unchanged copy "newer" than an edit made on another device.
 */
export async function upsertSubscription(sub: SubscriptionUpsert): Promise<void> {
  const next: Record<(typeof SUBSCRIPTION_FIELDS)[number], SqlBindValue> = {
    merchantDisplay: sub.merchantDisplay,
    merchantNormalized: sub.merchantNormalized,
    cadence: sub.cadence,
    typicalAmount: sub.typicalAmount,
    currency: sub.currency || 'USD',
    confidenceScore: sub.confidenceScore,
    lastChargedAt: sub.lastChargedAt ?? null,
    nextExpectedAt: sub.nextExpectedAt ?? null,
    status: sub.status,
    cancelUrl: sub.cancelUrl ?? null,
    cancelNotes: sub.cancelNotes ?? null,
    source: sub.source ?? 'transaction',
  };

  const changed = await withWriteLock((db) =>
    inTransaction(db, async () => {
      const existing = await db.getFirstAsync<Record<string, SqlBindValue>>(
        `SELECT ${SUBSCRIPTION_FIELDS.join(', ')} FROM subscriptions WHERE id = ?`,
        [sub.id],
      );
      const at = nowISO();

      if (!existing) {
        await db.runAsync(
          `INSERT INTO subscriptions (id, ${SUBSCRIPTION_FIELDS.join(', ')}, createdAt, clientUpdatedAt, dirty, syncError)
           VALUES (?, ${SUBSCRIPTION_FIELDS.map(() => '?').join(', ')}, ?, ?, 1, NULL)`,
          [sub.id, ...SUBSCRIPTION_FIELDS.map((f) => next[f]), sub.createdAt ?? at, at],
        );
        await clearTombstone(db, 'subscriptions', sub.id);
        return true;
      }

      if (SUBSCRIPTION_FIELDS.every((f) => (existing[f] ?? null) === next[f])) return false;

      await db.runAsync(
        `UPDATE subscriptions
         SET ${SUBSCRIPTION_FIELDS.map((f) => `${f} = ?`).join(', ')},
             clientUpdatedAt = ?, dirty = 1, syncError = NULL
         WHERE id = ?`,
        [...SUBSCRIPTION_FIELDS.map((f) => next[f]), at, sub.id],
      );
      return true;
    }),
  );
  if (changed) notifyLocalMutation();
}

export async function updateSubscriptionStatus(
  id: string,
  status: 'confirmed' | 'possible' | 'canceled',
): Promise<void> {
  await withWriteLock((db) =>
    db.runAsync(
      `UPDATE subscriptions SET status = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL WHERE id = ?`,
      [status, nowISO(), id],
    ),
  );
  notifyLocalMutation();
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

export async function deleteSubscription(id: string): Promise<void> {
  await withWriteLock((db) =>
    inTransaction(db, async () => {
      await db.runAsync(`DELETE FROM subscription_occurrences WHERE subscriptionId = ?`, [id]);
      const result = await db.runAsync(`DELETE FROM subscriptions WHERE id = ?`, [id]);
      if (result.changes > 0) await writeTombstone(db, 'subscriptions', id, nowISO());
    }),
  );
  notifyLocalMutation();
}

export async function getSubscriptionOccurrences(subscriptionId: string): Promise<SubscriptionOccurrence[]> {
  const database = await getDatabase();
  return database.getAllAsync<SubscriptionOccurrence>(
    `SELECT id, subscriptionId, transactionId, chargedAt, amount FROM subscription_occurrences
     WHERE subscriptionId = ? ORDER BY chargedAt DESC`,
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
 * same occurrences and the charge history grew without bound.
 */
export async function addSubscriptionOccurrence(occ: SubscriptionOccurrence): Promise<void> {
  await withWriteLock((db) =>
    db.runAsync(
      `INSERT OR IGNORE INTO subscription_occurrences (id, subscriptionId, transactionId, chargedAt, amount)
       VALUES (?, ?, ?, ?, ?)`,
      [occ.id, occ.subscriptionId, occ.transactionId, occ.chargedAt, occ.amount],
    ),
  );
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

// ── Sync bookkeeping ─────────────────────────────────────────────────────────

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

