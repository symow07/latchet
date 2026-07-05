import * as SQLite from 'expo-sqlite';
import { setActiveCurrency } from './calculations';

const DB_NAME = 'real_budget.db';

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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
  balance: number;
  currency: string;
  color: string;
  icon: string;
  isDefault: number;
  createdAt: string;
}

export async function createAccount(account: {
  name: string;
  type: string;
  balance: number;
  currency: string;
  color: string;
  icon: string;
  isDefault?: boolean;
}): Promise<string> {
  const database = await getDatabase();
  const id = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  await database.runAsync(
    `INSERT INTO accounts (id, name, type, balance, currency, color, icon, isDefault, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      account.name,
      account.type,
      account.balance,
      account.currency,
      account.color,
      account.icon,
      account.isDefault ? 1 : 0,
      new Date().toISOString(),
    ]
  );

  return id;
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

  await database.runAsync(
    `UPDATE accounts SET name = ?, type = ?, balance = ?, currency = ?, color = ?, icon = ?
     WHERE id = ?`,
    [
      account.name ?? current.name,
      account.type ?? current.type,
      account.balance ?? current.balance,
      account.currency ?? current.currency,
      account.color ?? current.color,
      account.icon ?? current.icon,
      id,
    ]
  );
}

export async function deleteAccount(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
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
export async function addTransaction(transaction: {
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  note?: string;
  dateISO: string;
  accountId?: string;
  currency?: string;
}) {
  const database = await getDatabase();
  const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Get default account if none specified
  let accountId = transaction.accountId;
  if (!accountId) {
    const defaultAccount = await database.getFirstAsync(
      'SELECT id FROM accounts WHERE isDefault = 1'
    ) as { id: string } | null;
    accountId = defaultAccount?.id;
  }

  await database.runAsync(
    `INSERT INTO transactions (id, amount, category, type, isImpulse, note, dateISO, createdAt, accountId, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      transaction.amount,
      transaction.category,
      transaction.type,
      transaction.isImpulse ? 1 : 0,
      transaction.note || null,
      transaction.dateISO,
      new Date().toISOString(),
      accountId || null,
      transaction.currency || 'USD',
    ]
  );

  // Update account balance
  if (accountId) {
    await updateAccountBalance(
      accountId,
      transaction.amount,
      transaction.type === 'Income' ? 'add' : 'subtract'
    );
  }

  return id;
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

export async function addSubscriptionOccurrence(occ: Omit<SubscriptionOccurrence, 'id'>): Promise<void> {
  const database = await getDatabase();
  const id = `socc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await database.runAsync(
    `INSERT OR IGNORE INTO subscription_occurrences (id, subscriptionId, transactionId, chargedAt, amount) VALUES (?, ?, ?, ?, ?)`,
    [id, occ.subscriptionId, occ.transactionId, occ.chargedAt, occ.amount]
  );
}

export async function clearSubscriptions(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM subscription_occurrences`);
  await database.runAsync(`DELETE FROM subscriptions`);
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
