import * as SQLite from 'expo-sqlite';
import { setActiveCurrency } from './calculations';

const DB_NAME = 'real_budget.db';

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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

export async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = performInit();
  try {
    return await initPromise;
  } catch (e) {
    initPromise = null; // allow retry on failure
    throw e;
  }
}

async function performInit(): Promise<SQLite.SQLiteDatabase> {
  db = await SQLite.openDatabaseAsync(DB_NAME);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      isImpulse INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      dateISO TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      accountId TEXT,
      currency TEXT DEFAULT 'USD'
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      monthlyBudget REAL DEFAULT 0,
      startingBalance REAL DEFAULT 0,
      hourlyValue REAL DEFAULT 0,
      showTimeCost INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      currencySymbol TEXT DEFAULT '$',
      monthlyIncome REAL DEFAULT 0,
      savingsGoal REAL DEFAULT 0,
      spendingStyle TEXT DEFAULT 'moderate',
      primaryGoal TEXT DEFAULT 'track'
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL DEFAULT 0,
      openingBalance REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      color TEXT DEFAULT '#a855f7',
      icon TEXT DEFAULT 'wallet',
      isDefault INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(dateISO);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      merchantDisplay TEXT NOT NULL,
      merchantNormalized TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'monthly',
      typicalAmount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      confidenceScore REAL DEFAULT 0,
      lastChargedAt TEXT,
      nextExpectedAt TEXT,
      status TEXT NOT NULL DEFAULT 'possible',
      cancelUrl TEXT,
      cancelNotes TEXT,
      source TEXT DEFAULT 'transaction',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscription_occurrences (
      id TEXT PRIMARY KEY,
      subscriptionId TEXT NOT NULL,
      transactionId TEXT,
      chargedAt TEXT NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (subscriptionId) REFERENCES subscriptions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_sub_occurrences_sub ON subscription_occurrences(subscriptionId);

    CREATE TABLE IF NOT EXISTS custom_categories (
      name TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT '🏷️',
      color TEXT NOT NULL DEFAULT '#94a3b8',
      createdAt TEXT NOT NULL
    );
  `);

  // Migration: Add accountId column if it doesn't exist (for older databases)
  try {
    const tableInfo = await db.getAllAsync('PRAGMA table_info(transactions)');
    const hasAccountId = (tableInfo as { name: string }[]).some(col => col.name === 'accountId');
    if (!hasAccountId) {
      await db.execAsync('ALTER TABLE transactions ADD COLUMN accountId TEXT');
    }
    const hasCurrency = (tableInfo as { name: string }[]).some(col => col.name === 'currency');
    if (!hasCurrency) {
      await db.execAsync("ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'USD'");
    }
  } catch (e) {
    // Column may already exist, ignore error
    console.log('Migration check:', e);
  }

  // Migration: add `source` column to subscriptions ('transaction' | 'email')
  // so email-detected subscriptions can be distinguished from transaction ones.
  try {
    const subInfo = await db.getAllAsync('PRAGMA table_info(subscriptions)');
    const hasSource = (subInfo as { name: string }[]).some(col => col.name === 'source');
    if (!hasSource) {
      await db.execAsync("ALTER TABLE subscriptions ADD COLUMN source TEXT DEFAULT 'transaction'");
    }
  } catch (e) {
    console.log('Subscriptions source migration:', e);
  }

  // Create index for accountId after ensuring column exists
  try {
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(accountId)');
  } catch {
    // Ignore if index creation fails
  }

  // Initialize settings if not exists
  const result = await db.getFirstAsync('SELECT id FROM settings WHERE id = 1');
  if (!result) {
    await db.runAsync(
      `INSERT INTO settings (id, monthlyBudget, startingBalance, hourlyValue, showTimeCost, currency, currencySymbol, monthlyIncome, savingsGoal, spendingStyle, primaryGoal)
       VALUES (1, 0, 0, 0, 0, 'USD', '$', 0, 0, 'moderate', 'track')`
    );
  }

  // Migration v2: wipe all demo/seeded data so every new user starts at zero.
  // Uses a migrations table to ensure this only runs once per device.
  await db.execAsync(`CREATE TABLE IF NOT EXISTS migrations (key TEXT PRIMARY KEY)`);
  const alreadyRan = await db.getFirstAsync(`SELECT key FROM migrations WHERE key = 'v2_clear_seed'`);
  if (!alreadyRan) {
    await db.runAsync(`DELETE FROM transactions`);
    await db.runAsync(`UPDATE settings SET startingBalance = 0, monthlyBudget = 0, hourlyValue = 0, showTimeCost = 0 WHERE id = 1`);
    await db.runAsync(`INSERT INTO migrations (key) VALUES ('v2_clear_seed')`);
  }

  // Migration v4: `balance` becomes a derived value — openingBalance plus the
  // net of every transaction on the account. Previously balance was only ever
  // mutated incrementally, so any missed or double-applied adjustment (notably
  // the cloud-sync duplicate bug) drifted permanently with no way to recover.
  // Back-derive openingBalance from the current balance so existing users see
  // no change, then recompute from the ledger on every bulk write.
  try {
    const accInfo = await db.getAllAsync('PRAGMA table_info(accounts)');
    const hasOpening = (accInfo as { name: string }[]).some(col => col.name === 'openingBalance');
    if (!hasOpening) {
      await db.execAsync('ALTER TABLE accounts ADD COLUMN openingBalance REAL DEFAULT 0');
      await db.runAsync(`
        UPDATE accounts SET openingBalance = balance - COALESCE((
          SELECT SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE -t.amount END)
          FROM transactions t WHERE t.accountId = accounts.id
        ), 0)
      `);
    }
  } catch (e) {
    console.log('Opening balance migration:', e);
  }

  // Migration v5: subscription ids no longer embed the amount, so a price
  // change updates a subscription instead of minting a second one. Existing
  // rows carry the old `sub_<merchant>_<amount>` form; fold each into its
  // merchant-only id, keeping whichever row the user had already acted on.
  // Occurrences move with their subscription, and duplicates collapse because
  // their ids are deterministic now too.
  try {
    const already = await db.getFirstAsync(
      `SELECT key FROM migrations WHERE key = 'v5_subscription_ids'`
    );
    if (!already) {
      const rows = (await db.getAllAsync(
        `SELECT id, status FROM subscriptions`
      )) as { id: string; status: string }[];

      for (const row of rows) {
        const match = row.id.match(/^(sub_.+)_\d+$/);
        if (!match) continue;
        const newId = match[1]!;

        const existing = await db.getFirstAsync(
          `SELECT id, status FROM subscriptions WHERE id = ?`,
          [newId]
        ) as { id: string; status: string } | null;

        if (!existing) {
          await db.runAsync(`UPDATE subscriptions SET id = ? WHERE id = ?`, [newId, row.id]);
          await db.runAsync(
            `UPDATE subscription_occurrences SET subscriptionId = ? WHERE subscriptionId = ?`,
            [newId, row.id]
          );
          continue;
        }

        // Both forms present. Keep the one the user acted on; otherwise keep
        // the new-format row and discard the stale duplicate.
        const userActed = (s: string) => s === 'confirmed' || s === 'canceled';
        if (userActed(row.status) && !userActed(existing.status)) {
          await db.runAsync(`DELETE FROM subscriptions WHERE id = ?`, [newId]);
          await db.runAsync(`UPDATE subscriptions SET id = ? WHERE id = ?`, [newId, row.id]);
        } else {
          await db.runAsync(`DELETE FROM subscriptions WHERE id = ?`, [row.id]);
        }
        await db.runAsync(
          `UPDATE OR IGNORE subscription_occurrences SET subscriptionId = ? WHERE subscriptionId = ?`,
          [newId, row.id]
        );
        await db.runAsync(`DELETE FROM subscription_occurrences WHERE subscriptionId = ?`, [row.id]);
      }

      await db.runAsync(`INSERT INTO migrations (key) VALUES ('v5_subscription_ids')`);
    }
  } catch (e) {
    console.log('Subscription id migration:', e);
  }

  // Migration v3: add subscriptions tables
  try {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      merchantDisplay TEXT NOT NULL,
      merchantNormalized TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'monthly',
      typicalAmount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      confidenceScore REAL DEFAULT 0,
      lastChargedAt TEXT,
      nextExpectedAt TEXT,
      status TEXT NOT NULL DEFAULT 'possible',
      cancelUrl TEXT,
      cancelNotes TEXT,
      source TEXT DEFAULT 'transaction',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscription_occurrences (
      id TEXT PRIMARY KEY,
      subscriptionId TEXT NOT NULL,
      transactionId TEXT,
      chargedAt TEXT NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (subscriptionId) REFERENCES subscriptions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_sub_occurrences_sub ON subscription_occurrences(subscriptionId);`);
  } catch (e) {
    console.log('Subscriptions migration:', e);
  }

  // Check if accounts table has data, if not create default account
  const accountCount = await db.getFirstAsync('SELECT COUNT(*) as count FROM accounts');
  if ((accountCount as { count: number } | undefined)?.count === 0) {
    await createAccount({
      name: 'Cash',
      type: 'cash',
      balance: 0,
      currency: 'USD',
      color: '#22c55e',
      icon: 'wallet',
      isDefault: true,
    });
  }

  return db;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    await initializeDatabase();
  }
  return db!;
}

// Account operations
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

export async function createAccount(account: AccountInput): Promise<string> {
  const id = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await createAccountWithId(id, account);
  notifyLocalMutation();
  return id;
}

/**
 * Create an account under a caller-supplied id.
 *
 * Cloud sync must preserve the server's id: `createAccount` mints its own,
 * which meant a pulled account was never recognised as already-present and was
 * re-created on every single login.
 */
export async function createAccountWithId(
  id: string,
  account: AccountInput
): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(
    `INSERT OR REPLACE INTO accounts (id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      account.name,
      account.type,
      account.balance,
      account.openingBalance ?? account.balance,
      account.currency,
      account.color,
      account.icon,
      account.isDefault ? 1 : 0,
      account.createdAt ?? new Date().toISOString(),
    ]
  );
}

export async function getAccounts(): Promise<Account[]> {
  const database = await getDatabase();
  const accounts = await database.getAllAsync(
    'SELECT * FROM accounts ORDER BY isDefault DESC, createdAt ASC'
  );
  return accounts as Account[];
}

export async function getAccountById(id: string): Promise<Account | null> {
  const database = await getDatabase();
  const account = await database.getFirstAsync(
    'SELECT * FROM accounts WHERE id = ?',
    [id]
  );
  return account as Account | null;
}

export async function updateAccount(id: string, account: Partial<Account>): Promise<void> {
  const database = await getDatabase();
  const current = await getAccountById(id);
  if (!current) return;

  const nextBalance = account.balance ?? current.balance;

  // A caller setting `balance` is asserting "this account is now worth X".
  // Rebase openingBalance off the existing ledger so the next recompute
  // reproduces X rather than reverting the edit.
  let nextOpening = account.openingBalance ?? current.openingBalance;
  if (account.balance !== undefined && account.openingBalance === undefined) {
    nextOpening = nextBalance - (await getAccountLedgerNet(id));
  }

  await database.runAsync(
    `UPDATE accounts SET name = ?, type = ?, balance = ?, openingBalance = ?, currency = ?, color = ?, icon = ?
     WHERE id = ?`,
    [
      account.name ?? current.name,
      account.type ?? current.type,
      nextBalance,
      nextOpening,
      account.currency ?? current.currency,
      account.color ?? current.color,
      account.icon ?? current.icon,
      id,
    ]
  );
  notifyLocalMutation();
}

/** Net effect of every transaction booked to an account (income − expense). */
export async function getAccountLedgerNet(accountId: string): Promise<number> {
  const database = await getDatabase();
  const row = (await database.getFirstAsync(
    `SELECT COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0) AS net
     FROM transactions WHERE accountId = ?`,
    [accountId]
  )) as { net: number } | null;
  return row?.net ?? 0;
}

/**
 * Recompute every account balance from openingBalance + its ledger.
 *
 * Cheaper and far safer than incremental adjustment after a bulk write: it is
 * idempotent, so a sync that runs twice cannot double-count.
 */
export async function recomputeAccountBalances(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`
    UPDATE accounts SET balance = openingBalance + COALESCE((
      SELECT SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE -t.amount END)
      FROM transactions t WHERE t.accountId = accounts.id
    ), 0)
  `);
}

export async function deleteAccount(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
  notifyLocalMutation();
}

export async function updateAccountBalance(id: string, amount: number, type: 'add' | 'subtract'): Promise<void> {
  const database = await getDatabase();
  const operator = type === 'add' ? '+' : '-';
  await database.runAsync(
    `UPDATE accounts SET balance = balance ${operator} ? WHERE id = ?`,
    [amount, id]
  );
}

// Transaction operations
export interface TransactionInput {
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  note?: string;
  dateISO: string;
  accountId?: string;
  currency?: string;
  createdAt?: string;
}

async function insertTransactionRow(
  id: string,
  transaction: TransactionInput,
  opts: { adjustBalance: boolean; replace?: boolean }
): Promise<void> {
  const database = await getDatabase();

  // Get default account if none specified
  let accountId = transaction.accountId;
  if (!accountId) {
    const defaultAccount = await database.getFirstAsync(
      'SELECT id FROM accounts WHERE isDefault = 1'
    ) as { id: string } | null;
    accountId = defaultAccount?.id;
  }

  await database.runAsync(
    `INSERT ${opts.replace ? 'OR REPLACE ' : ''}INTO transactions (id, amount, category, type, isImpulse, note, dateISO, createdAt, accountId, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      transaction.amount,
      transaction.category,
      transaction.type,
      transaction.isImpulse ? 1 : 0,
      transaction.note || null,
      transaction.dateISO,
      transaction.createdAt ?? new Date().toISOString(),
      accountId || null,
      transaction.currency || 'USD',
    ]
  );

  if (opts.adjustBalance && accountId) {
    await updateAccountBalance(
      accountId,
      transaction.amount,
      transaction.type === 'Income' ? 'add' : 'subtract'
    );
  }
}

export async function addTransaction(transaction: TransactionInput) {
  const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await insertTransactionRow(id, transaction, { adjustBalance: true });
  notifyLocalMutation();
  return id;
}

/**
 * Insert a transaction under a caller-supplied id, without touching any
 * balance.
 *
 * Used by cloud sync, which must preserve the server's id (otherwise every
 * pull re-inserts the same rows) and must not re-apply balance deltas — the
 * caller runs `recomputeAccountBalances()` once when the pull completes.
 */
export async function addTransactionWithId(
  id: string,
  transaction: TransactionInput
): Promise<void> {
  await insertTransactionRow(id, transaction, {
    adjustBalance: false,
    replace: true,
  });
}

export async function getTransactions() {
  const database = await getDatabase();
  const transactions = await database.getAllAsync(
    'SELECT * FROM transactions ORDER BY dateISO DESC, createdAt DESC'
  );
  return transactions as {
    id: string;
    amount: number;
    category: string;
    type: string;
    isImpulse: number;
    note?: string;
    dateISO: string;
    createdAt: string;
    accountId?: string;
    currency?: string;
  }[];
}

export async function getTransactionsByAccount(accountId: string) {
  const database = await getDatabase();
  const transactions = await database.getAllAsync(
    'SELECT * FROM transactions WHERE accountId = ? ORDER BY dateISO DESC, createdAt DESC',
    [accountId]
  );
  return transactions as {
    id: string;
    amount: number;
    category: string;
    type: string;
    isImpulse: number;
    note?: string;
    dateISO: string;
    createdAt: string;
    accountId?: string;
    currency?: string;
  }[];
}

export async function getTransactionsByDateRange(startDate: string, endDate: string) {
  const database = await getDatabase();
  const transactions = await database.getAllAsync(
    `SELECT * FROM transactions
     WHERE dateISO >= ? AND dateISO <= ?
     ORDER BY dateISO DESC, createdAt DESC`,
    [startDate, endDate]
  );
  return transactions as {
    id: string;
    amount: number;
    category: string;
    type: string;
    isImpulse: number;
    note?: string;
    dateISO: string;
    createdAt: string;
    accountId?: string;
    currency?: string;
  }[];
}

export async function deleteTransaction(id: string) {
  const database = await getDatabase();

  // Get transaction to reverse account balance
  const tx = await database.getFirstAsync(
    'SELECT * FROM transactions WHERE id = ?',
    [id]
  ) as { amount: number; type: string; accountId?: string } | null;

  if (tx?.accountId) {
    await updateAccountBalance(
      tx.accountId,
      tx.amount,
      tx.type === 'Income' ? 'subtract' : 'add'
    );
  }

  await database.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
  notifyLocalMutation();
}

export async function updateTransaction(
  id: string,
  transaction: {
    amount: number;
    category: string;
    type: 'Expense' | 'Income';
    isImpulse: boolean;
    note?: string;
    dateISO: string;
    accountId?: string;
    currency?: string;
  }
) {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE transactions
     SET amount = ?, category = ?, type = ?, isImpulse = ?, note = ?, dateISO = ?, accountId = ?, currency = ?
     WHERE id = ?`,
    [
      transaction.amount,
      transaction.category,
      transaction.type,
      transaction.isImpulse ? 1 : 0,
      transaction.note || null,
      transaction.dateISO,
      transaction.accountId || null,
      transaction.currency || 'USD',
      id,
    ]
  );

  // Editing an amount, type or account changes what the ledger implies; the
  // incremental path never accounted for this, so recompute instead.
  await recomputeAccountBalances();
  notifyLocalMutation();
}

// Settings operations
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
}

export async function getSettings(): Promise<Settings> {
  const database = await getDatabase();
  const settings = await database.getFirstAsync(
    'SELECT * FROM settings WHERE id = 1'
  ) as Settings;
  // Keep app-wide currency formatting in sync with the user's choice.
  if (settings) setActiveCurrency(settings.currency, settings.currencySymbol);
  return settings;
}

export async function updateSettings(settings: Partial<Settings>) {
  const database = await getDatabase();
  const current = await getSettings();

  // If no settings row exists yet, insert one first
  if (!current) {
    await database.runAsync(
      `INSERT INTO settings (id, monthlyBudget, startingBalance, hourlyValue, showTimeCost, currency, currencySymbol, monthlyIncome, savingsGoal, spendingStyle, primaryGoal)
       VALUES (1, 0, 0, 0, 0, 'USD', '$', 0, 0, 'moderate', 'track')`
    );
  }

  await database.runAsync(
    `UPDATE settings
     SET monthlyBudget = ?, startingBalance = ?, hourlyValue = ?, showTimeCost = ?,
         currency = ?, currencySymbol = ?, monthlyIncome = ?, savingsGoal = ?,
         spendingStyle = ?, primaryGoal = ?
     WHERE id = 1`,
    [
      settings.monthlyBudget ?? current?.monthlyBudget ?? 0,
      settings.startingBalance ?? current?.startingBalance ?? 0,
      settings.hourlyValue ?? current?.hourlyValue ?? 0,
      settings.showTimeCost !== undefined ? (settings.showTimeCost ? 1 : 0) : (current?.showTimeCost ?? 0),
      settings.currency ?? current?.currency ?? 'USD',
      settings.currencySymbol ?? current?.currencySymbol ?? '$',
      settings.monthlyIncome ?? current?.monthlyIncome ?? 0,
      settings.savingsGoal ?? current?.savingsGoal ?? 0,
      settings.spendingStyle ?? current?.spendingStyle ?? 'moderate',
      settings.primaryGoal ?? current?.primaryGoal ?? 'track',
    ]
  );
  notifyLocalMutation();
}

// Reset all user data — wipes transactions, accounts, and resets settings to zero
export async function resetAllData(): Promise<void> {
  try {
    const database = await getDatabase();
    if (!database) throw new Error('Database not available');
    await database.runAsync(`DELETE FROM transactions`);
    await database.runAsync(`DELETE FROM accounts`);
    // Only reset columns guaranteed to exist across all schema versions
    await database.runAsync(
      `UPDATE settings SET startingBalance = 0, monthlyBudget = 0, hourlyValue = 0, showTimeCost = 0 WHERE id = 1`
    );
    // Reset optional columns only if they exist in this device's schema
    const cols = (await database.getAllAsync('PRAGMA table_info(settings)') as { name: string }[]).map(c => c.name);
    if (cols.includes('monthlyIncome')) await database.runAsync(`UPDATE settings SET monthlyIncome = 0 WHERE id = 1`);
    if (cols.includes('savingsGoal')) await database.runAsync(`UPDATE settings SET savingsGoal = 0 WHERE id = 1`);
    await database.runAsync(`DELETE FROM migrations WHERE key = 'v2_clear_seed'`);
  } catch (e) {
    console.error('[resetAllData] failed:', e);
    throw e;
  }
}

// Subscription operations
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
  updatedAt: string;
}

export interface SubscriptionOccurrence {
  id: string;
  subscriptionId: string;
  transactionId: string | null;
  chargedAt: string;
  amount: number;
}

export async function getSubscriptions(status?: string): Promise<Subscription[]> {
  const database = await getDatabase();
  if (status) {
    return (await database.getAllAsync(`SELECT * FROM subscriptions WHERE status = ? ORDER BY nextExpectedAt ASC`, [status])) as Subscription[];
  }
  return (await database.getAllAsync(`SELECT * FROM subscriptions ORDER BY nextExpectedAt ASC`)) as Subscription[];
}

export async function getSubscriptionById(id: string): Promise<Subscription | null> {
  const database = await getDatabase();
  return (await database.getFirstAsync(`SELECT * FROM subscriptions WHERE id = ?`, [id])) as Subscription | null;
}

export async function upsertSubscription(sub: Omit<Subscription, 'createdAt' | 'updatedAt'> & { createdAt?: string }): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO subscriptions (id, merchantDisplay, merchantNormalized, cadence, typicalAmount, currency, confidenceScore, lastChargedAt, nextExpectedAt, status, cancelUrl, cancelNotes, source, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       merchantDisplay = excluded.merchantDisplay,
       merchantNormalized = excluded.merchantNormalized,
       cadence = excluded.cadence,
       typicalAmount = excluded.typicalAmount,
       confidenceScore = excluded.confidenceScore,
       lastChargedAt = excluded.lastChargedAt,
       nextExpectedAt = excluded.nextExpectedAt,
       status = excluded.status,
       cancelUrl = excluded.cancelUrl,
       cancelNotes = excluded.cancelNotes,
       source = excluded.source,
       updatedAt = excluded.updatedAt`,
    [sub.id, sub.merchantDisplay, sub.merchantNormalized, sub.cadence, sub.typicalAmount, sub.currency,
     sub.confidenceScore, sub.lastChargedAt, sub.nextExpectedAt, sub.status,
     sub.cancelUrl, sub.cancelNotes, sub.source ?? 'transaction', sub.createdAt ?? now, now]
  );
}

export async function updateSubscriptionStatus(id: string, status: 'confirmed' | 'possible' | 'canceled'): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE subscriptions SET status = ?, updatedAt = ? WHERE id = ?`, [status, new Date().toISOString(), id]);
}

export async function updateSubscriptionCancelInfo(id: string, cancelUrl: string | null, cancelNotes: string | null): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE subscriptions SET cancelUrl = ?, cancelNotes = ?, updatedAt = ? WHERE id = ?`, [cancelUrl, cancelNotes, new Date().toISOString(), id]);
}

export async function deleteSubscription(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM subscription_occurrences WHERE subscriptionId = ?`, [id]);
  await database.runAsync(`DELETE FROM subscriptions WHERE id = ?`, [id]);
}

export async function getSubscriptionOccurrences(subscriptionId: string): Promise<SubscriptionOccurrence[]> {
  const database = await getDatabase();
  return (await database.getAllAsync(`SELECT * FROM subscription_occurrences WHERE subscriptionId = ? ORDER BY chargedAt DESC`, [subscriptionId])) as SubscriptionOccurrence[];
}

/**
 * Record one charge against a subscription.
 *
 * `id` must be deterministic (see occurrenceId in lib/subscriptions/engine).
 * It used to be generated randomly here and then guarded with INSERT OR
 * IGNORE — which had nothing to collide with, so every scan re-appended the
 * same occurrences and the charge history grew without bound.
 */
export async function addSubscriptionOccurrence(
  occ: SubscriptionOccurrence
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR IGNORE INTO subscription_occurrences (id, subscriptionId, transactionId, chargedAt, amount) VALUES (?, ?, ?, ?, ?)`,
    [occ.id, occ.subscriptionId, occ.transactionId, occ.chargedAt, occ.amount]
  );
}

export async function clearSubscriptions(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM subscription_occurrences`);
  await database.runAsync(`DELETE FROM subscriptions`);
}

// Custom (user-created) categories
export interface CustomCategory {
  name: string;
  icon: string;
  color: string;
  createdAt: string;
}

export async function getCustomCategories(): Promise<CustomCategory[]> {
  const database = await getDatabase();
  return (await database.getAllAsync(
    `SELECT * FROM custom_categories ORDER BY createdAt ASC`
  )) as CustomCategory[];
}

export async function addCustomCategory(cat: { name: string; icon: string; color: string }): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO custom_categories (name, icon, color, createdAt) VALUES (?, ?, ?, ?)`,
    [cat.name.trim(), cat.icon, cat.color, new Date().toISOString()]
  );
}

export async function deleteCustomCategory(name: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM custom_categories WHERE name = ?`, [name]);
}

// Seeding function for demo data
export async function seedDemoData() {
  const database = await getDatabase();
  const existing = await database.getFirstAsync('SELECT COUNT(*) as count FROM transactions') as { count: number } | undefined;

  if (existing && existing.count > 0) return; // Already has data

  const today = new Date();
  const transactions = [
    // Last 14 days of data
    { amount: 45.99, category: 'Food', type: 'Expense', isImpulse: true, note: 'Coffee & pastry', daysAgo: 0 },
    { amount: 12.5, category: 'Transport', type: 'Expense', isImpulse: false, note: 'Bus fare', daysAgo: 0 },
    { amount: 2500, category: 'Other', type: 'Income', isImpulse: false, note: 'Salary', daysAgo: 0 },

    { amount: 85.0, category: 'Shopping', type: 'Expense', isImpulse: true, note: 'New shirt', daysAgo: 1 },
    { amount: 25.0, category: 'Food', type: 'Expense', isImpulse: false, note: 'Groceries', daysAgo: 1 },

    { amount: 50.0, category: 'Gym', type: 'Expense', isImpulse: false, note: 'Monthly membership', daysAgo: 2 },
    { amount: 15.99, category: 'Subscriptions', type: 'Expense', isImpulse: false, note: 'Spotify', daysAgo: 2 },

    { amount: 38.0, category: 'Food', type: 'Expense', isImpulse: true, note: 'Restaurant', daysAgo: 3 },
    { amount: 10.0, category: 'Transport', type: 'Expense', isImpulse: false, note: 'Uber', daysAgo: 3 },

    { amount: 120.0, category: 'Shopping', type: 'Expense', isImpulse: true, note: 'Shoes', daysAgo: 4 },

    { amount: 22.5, category: 'Food', type: 'Expense', isImpulse: false, note: 'Lunch', daysAgo: 5 },

    { amount: 65.0, category: 'Food', type: 'Expense', isImpulse: true, note: 'Weekend brunch', daysAgo: 6 },

    { amount: 18.0, category: 'Transport', type: 'Expense', isImpulse: false, note: 'Gas', daysAgo: 7 },
    { amount: 30.0, category: 'Gym', type: 'Expense', isImpulse: false, note: 'Personal training', daysAgo: 7 },

    { amount: 55.5, category: 'Food', type: 'Expense', isImpulse: true, note: 'Delivery', daysAgo: 8 },

    { amount: 95.0, category: 'Shopping', type: 'Expense', isImpulse: true, note: 'Impulse buy', daysAgo: 9 },

    { amount: 12.0, category: 'Transport', type: 'Expense', isImpulse: false, note: 'Parking', daysAgo: 10 },

    { amount: 42.0, category: 'Food', type: 'Expense', isImpulse: false, note: 'Meal prep', daysAgo: 11 },

    { amount: 75.99, category: 'Subscriptions', type: 'Expense', isImpulse: false, note: 'Netflix + HBO', daysAgo: 12 },

    { amount: 28.5, category: 'Food', type: 'Expense', isImpulse: true, note: 'Coffee shop', daysAgo: 13 },
  ];

  for (const tx of transactions) {
    const dateISO = new Date(today.getTime() - tx.daysAgo * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    await addTransaction({
      amount: tx.amount,
      category: tx.category as string,
      type: tx.type as 'Expense' | 'Income',
      isImpulse: tx.isImpulse,
      note: tx.note,
      dateISO,
    });
  }

  // Set initial settings
  await updateSettings({
    monthlyBudget: 0,
    startingBalance: 0,
    hourlyValue: 0,
    showTimeCost: 0,
  });
}
