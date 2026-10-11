/**
 * The phone's local database: one SQLite file per signed-in user.
 *
 * This is the complete DDL of a fresh per-user file. db.ts runs it when it
 * opens a user's database (every statement is IF NOT EXISTS, so re-running it
 * is harmless), and the tests run it against an in-memory SQLite. It imports
 * nothing, on purpose: it has to load under `bun test`.
 *
 * Why there are no in-place migrations here. The old shared `real_budget.db`
 * grew its schema through v2-v6 ALTERs. Per-user files are new, so each one
 * starts at this schema directly; the `migrations` table is kept so that a
 * future LOCAL_SCHEMA_VERSION can migrate the files that exist by then.
 *
 * Sync bookkeeping (I-LOCAL-SCHEMA in .unlazy/phase3/PLAN.md). Each synced
 * table carries three columns:
 *   clientUpdatedAt  when the row was last changed on a client. Last writer
 *                    wins by this value, so it is stamped with "now" by every
 *                    user-originated write. Rows the device invents for itself
 *                    (the settings row, the default Cash account) carry the
 *                    epoch, so the server's real version always beats them.
 *   dirty            1 = changed here and not yet accepted by the server.
 *   syncError        why the server refused the row; cleared by the next edit.
 * A delete of a synced row leaves a row in `sync_tombstones`, which is how the
 * deletion reaches the server. `sync_meta` is the sync engine's own key/value
 * store (its cursor, for instance). `local_meta` is this module's: it records
 * which user the file belongs to, so a file can never be opened for anyone
 * else.
 *
 * Not synced, by design: `health_profile` (device-only health data, see
 * sync-redaction.ts) and `subscription_occurrences` (derived by the detection
 * engine from the ledger, so each device re-derives them).
 *
 * Phase 4 added four synced tables (recurring series, bill reminders, category
 * budgets, net-worth snapshots; I-WIRE-4 in .unlazy/phase4/PLAN.md). They are
 * new tables, not changes to existing ones, so a file created by an earlier
 * build gains them the next time it is opened — every statement here is
 * IF NOT EXISTS — and LOCAL_SCHEMA_VERSION stays 1: bumping it would re-run
 * the seed on every existing file and bring back a default account its user
 * had deleted. What such a file lacks is their rows, which the sync store
 * fetches with one full pull when it sees the synced entity set has grown
 * (SYNC_ENTITY_SIGNATURE in sync/sqlite-store.ts).
 *
 * Journal mode stays SQLite's default (DELETE), not WAL. Signing out deletes
 * the user's file with expo-sqlite's deleteDatabaseAsync, which removes the
 * main file only; in WAL mode the -wal and -shm files beside it would survive
 * holding the user's most recent writes.
 */

/** Bump with a migration step in db.ts's initializer when this DDL changes. */
export const LOCAL_SCHEMA_VERSION = 1;

/** The `migrations` key that marks a file as created at LOCAL_SCHEMA_VERSION. */
export const LOCAL_SCHEMA_KEY = `schema_v${LOCAL_SCHEMA_VERSION}`;

/** clientUpdatedAt of a row nobody has edited: the server's version always wins. */
export const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/**
 * The synced entities, in the order the server applies them (I-WIRE, and
 * I-WIRE-4 for the last four): accounts before the transactions and recurring
 * series that name them.
 */
export const SYNC_ENTITIES = [
  'settings',
  'categories',
  'accounts',
  'transactions',
  'subscriptions',
  'recurring',
  'billReminders',
  'categoryBudgets',
  'netWorth',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/**
 * Where each synced entity lives on the phone, and which column is its sync id.
 *
 * The settings row is `id = 1` locally and `'settings'` on the wire; a custom
 * category is identified by its name, and a category budget by its category
 * (the server's own row id for a budget never leaves the server); everything
 * else by `id`.
 */
export const LOCAL_SYNC_TABLES: Readonly<Record<SyncEntity, { table: string; idColumn: string }>> = {
  settings: { table: 'settings', idColumn: 'id' },
  categories: { table: 'custom_categories', idColumn: 'name' },
  accounts: { table: 'accounts', idColumn: 'id' },
  transactions: { table: 'transactions', idColumn: 'id' },
  subscriptions: { table: 'subscriptions', idColumn: 'id' },
  recurring: { table: 'recurring_transactions', idColumn: 'id' },
  billReminders: { table: 'bill_reminders', idColumn: 'id' },
  categoryBudgets: { table: 'category_budgets', idColumn: 'category' },
  netWorth: { table: 'net_worth_entries', idColumn: 'id' },
};

/** The settings row's id on the wire. Locally it is always row 1. */
export const SETTINGS_SYNC_ID = 'settings';

/**
 * The default Cash account's id. Deterministic per user, so the account a
 * second device seeds is the same row the first device already uploaded, and
 * the server's copy replaces the seed instead of sitting beside it.
 */
export function defaultAccountId(userId: string): string {
  return `acc_default_${userId}`;
}

/** The seeded default account, shared by the seed and "reset all activity". */
export const DEFAULT_ACCOUNT = {
  name: 'Cash',
  type: 'cash',
  currency: 'USD',
  color: '#22c55e',
  icon: 'wallet',
} as const;

export const LOCAL_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS migrations (
      key TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

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
      currency TEXT NOT NULL DEFAULT 'USD',
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(dateISO);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(accountId);
    CREATE INDEX IF NOT EXISTS idx_transactions_dirty ON transactions(dirty) WHERE dirty = 1;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      monthlyBudget REAL NOT NULL DEFAULT 0,
      startingBalance REAL NOT NULL DEFAULT 0,
      hourlyValue REAL NOT NULL DEFAULT 0,
      showTimeCost INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      currencySymbol TEXT NOT NULL DEFAULT '$',
      monthlyIncome REAL NOT NULL DEFAULT 0,
      savingsGoal REAL NOT NULL DEFAULT 0,
      spendingStyle TEXT NOT NULL DEFAULT 'moderate',
      primaryGoal TEXT NOT NULL DEFAULT 'track',
      locale TEXT NOT NULL DEFAULT 'en',
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      openingBalance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      color TEXT NOT NULL DEFAULT '#a855f7',
      icon TEXT NOT NULL DEFAULT 'wallet',
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE TABLE IF NOT EXISTS custom_categories (
      name TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#94a3b8',
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      merchantDisplay TEXT NOT NULL,
      merchantNormalized TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'monthly',
      typicalAmount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      confidenceScore REAL NOT NULL DEFAULT 0,
      lastChargedAt TEXT,
      nextExpectedAt TEXT,
      status TEXT NOT NULL DEFAULT 'possible',
      cancelUrl TEXT,
      cancelNotes TEXT,
      source TEXT NOT NULL DEFAULT 'transaction',
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

    CREATE TABLE IF NOT EXISTS subscription_occurrences (
      id TEXT PRIMARY KEY,
      subscriptionId TEXT NOT NULL,
      transactionId TEXT,
      chargedAt TEXT NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (subscriptionId) REFERENCES subscriptions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sub_occurrences_sub ON subscription_occurrences(subscriptionId);

    -- A recurring series. accountId is where the server books its occurrences
    -- (null: the default account). No foreign key, on purpose: the account
    -- can be deleted here or on another device before the series is told,
    -- and the server unlinks it (ON DELETE SET NULL) on its own schedule.
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id TEXT PRIMARY KEY,
      accountId TEXT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      isImpulse INTEGER NOT NULL DEFAULT 0,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      startDate TEXT NOT NULL,
      nextDate TEXT NOT NULL,
      lastCreated TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'USD',
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_recurring_account ON recurring_transactions(accountId);

    CREATE TABLE IF NOT EXISTS bill_reminders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      dueDay INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      isRecurring INTEGER NOT NULL DEFAULT 1,
      isPaid INTEGER NOT NULL DEFAULT 0,
      paidAt TEXT,
      nextDueDate TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    -- One budget per category: the category is the sync id.
    CREATE TABLE IF NOT EXISTS category_budgets (
      category TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly',
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    -- breakdown is the JSON text of an object of amounts, as on the wire;
    -- db.ts parses it on the way out.
    CREATE TABLE IF NOT EXISTS net_worth_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      assets REAL NOT NULL DEFAULT 0,
      liabilities REAL NOT NULL DEFAULT 0,
      netWorth REAL NOT NULL DEFAULT 0,
      breakdown TEXT,
      createdAt TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      dirty INTEGER NOT NULL DEFAULT 0,
      syncError TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity TEXT NOT NULL,
      id TEXT NOT NULL,
      clientUpdatedAt TEXT NOT NULL,
      PRIMARY KEY (entity, id)
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS health_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      householdSize INTEGER,
      city TEXT,
      cookingHabits TEXT,
      goals TEXT,
      activityInterests TEXT,
      dietaryPreferences TEXT,
      allergies TEXT,
      healthConsiderations TEXT,
      standardConsentAt TEXT,
      sensitiveConsentAt TEXT,
      updatedAt TEXT
    );
`;

export interface SeedStatement {
  sql: string;
  params: (string | number)[];
}

/**
 * The rows a fresh file starts with, run once, when the file is created.
 *
 * Both carry the epoch and dirty = 1 (decision 6): they are offered to the
 * server like any other change, and lose to any real version it holds. Only
 * on creation, never on a later open — re-seeding on open would resurrect a
 * default account the user had deleted.
 */
export function localSeedStatements(userId: string, nowISO: string): SeedStatement[] {
  return [
    {
      sql: `INSERT OR IGNORE INTO settings (id, clientUpdatedAt, dirty) VALUES (1, ?, 1)`,
      params: [EPOCH_ISO],
    },
    {
      sql: `INSERT OR IGNORE INTO accounts
              (id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt, clientUpdatedAt, dirty)
            VALUES (?, ?, ?, 0, 0, ?, ?, ?, 1, ?, ?, 1)`,
      params: [
        defaultAccountId(userId),
        DEFAULT_ACCOUNT.name,
        DEFAULT_ACCOUNT.type,
        DEFAULT_ACCOUNT.currency,
        DEFAULT_ACCOUNT.color,
        DEFAULT_ACCOUNT.icon,
        nowISO,
        EPOCH_ISO,
      ],
    },
  ];
}
