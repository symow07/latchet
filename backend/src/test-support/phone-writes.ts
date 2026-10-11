/**
 * The phone's user-originated writes, for the end-to-end sync test.
 *
 * MIRRORED, NOT IMPORTED: these are mobile/src/lib/db.ts's write functions,
 * statement for statement. db.ts cannot be loaded here — it imports
 * expo-sqlite, and through calculations.ts the i18n stack (i18n-js, the locale
 * files, date-fns) — and its functions are bound to its module-level registry
 * of one active user database, where this test needs several devices open at
 * once. What is mirrored is exactly the bookkeeping the sync relies on
 * (I-LOCAL-SCHEMA): every write stamps clientUpdatedAt with the device's
 * "now", sets dirty = 1 and clears syncError; every delete of a synced row
 * leaves a sync_tombstones row; re-creating a row clears its tombstone; the
 * account balance moves with the ledger the way db.ts moves it. If db.ts's
 * SQL changes, change it here too.
 *
 * Two deliberate differences: "now" is the device's clock (so a test can run
 * a phone whose clock is wrong), and every write runs through the store's
 * access (db.ts's withWriteLock in the app), so a write never interleaves
 * with a sync step — as on the phone.
 */
import {
  EPOCH_ISO,
  billPaidChange,
  serializeBreakdown,
  type Breakdown,
  type SyncDbAccess,
  type SyncEntity,
  type SyncSqlDb,
} from "./phone";

type Bind = string | number | null;

export interface AccountInput {
  name: string;
  type: string;
  balance: number;
  currency: string;
  color: string;
  icon: string;
  isDefault?: boolean;
  openingBalance?: number;
  createdAt?: string;
}

export interface AccountPatch {
  name?: string;
  type?: string;
  balance?: number;
  openingBalance?: number;
  currency?: string;
  color?: string;
  icon?: string;
}

export interface TransactionInput {
  amount: number;
  category: string;
  type: "Expense" | "Income";
  isImpulse: boolean;
  note?: string | null;
  dateISO: string;
  accountId?: string | null;
  currency?: string;
  createdAt?: string;
}

export interface SettingsPatch {
  monthlyBudget?: number;
  startingBalance?: number;
  hourlyValue?: number;
  showTimeCost?: number | boolean;
  currency?: string;
  currencySymbol?: string;
  monthlyIncome?: number;
  savingsGoal?: number;
  spendingStyle?: string;
  primaryGoal?: string;
  locale?: string;
}

export interface SubscriptionInput {
  id: string;
  merchantDisplay: string;
  merchantNormalized: string;
  cadence: "weekly" | "monthly" | "yearly" | "unknown";
  typicalAmount: number;
  currency: string;
  confidenceScore: number;
  lastChargedAt: string | null;
  nextExpectedAt: string | null;
  status: "confirmed" | "possible" | "canceled";
  cancelUrl: string | null;
  cancelNotes: string | null;
  source: "transaction" | "email";
  createdAt?: string;
}

export interface RecurringInput {
  accountId: string | null;
  name: string;
  amount: number;
  category: string;
  type: "Expense" | "Income";
  isImpulse: boolean;
  frequency: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
  startDate: string;
  nextDate: string;
  currency: string;
}

export interface BillReminderInput {
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  isRecurring: boolean;
  nextDueDate: string;
}

export interface NetWorthInput {
  date: string;
  assets: number;
  liabilities: number;
  breakdown?: Breakdown | null;
}

const ACCOUNT_COLUMNS = "id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt";
const RECURRING_COLUMNS =
  "id, accountId, name, amount, category, type, isImpulse, frequency, startDate, nextDate, lastCreated, isActive, currency, createdAt";
const BILL_COLUMNS = "id, name, amount, dueDay, category, isRecurring, isPaid, paidAt, nextDueDate, createdAt";
const TRANSACTION_COLUMNS = "id, amount, category, type, isImpulse, note, dateISO, createdAt, accountId, currency";
const SETTINGS_FIELDS = [
  "monthlyBudget", "startingBalance", "hourlyValue", "showTimeCost", "currency", "currencySymbol",
  "monthlyIncome", "savingsGoal", "spendingStyle", "primaryGoal", "locale",
] as const;
const SUBSCRIPTION_FIELDS = [
  "merchantDisplay", "merchantNormalized", "cadence", "typicalAmount", "currency", "confidenceScore",
  "lastChargedAt", "nextExpectedAt", "status", "cancelUrl", "cancelNotes", "source",
] as const;

async function inTransaction<T>(db: SyncSqlDb, fn: () => Promise<T>): Promise<T> {
  await db.execAsync("BEGIN");
  try {
    const result = await fn();
    await db.execAsync("COMMIT");
    return result;
  } catch (e) {
    try {
      await db.execAsync("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw e;
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

async function writeTombstone(db: SyncSqlDb, entity: SyncEntity, id: string, at: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES (?, ?, ?)
     ON CONFLICT(entity, id) DO UPDATE SET clientUpdatedAt = excluded.clientUpdatedAt`,
    [entity, id, at]
  );
}

async function clearTombstone(db: SyncSqlDb, entity: SyncEntity, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM sync_tombstones WHERE entity = ? AND id = ?`, [entity, id]);
}

async function adjustBalance(
  db: SyncSqlDb,
  accountId: string | null,
  tx: { amount: number; type: string },
  direction: 1 | -1
): Promise<void> {
  if (!accountId) return;
  const signed = (tx.type === "Income" ? tx.amount : -tx.amount) * direction;
  await db.runAsync("UPDATE accounts SET balance = balance + ? WHERE id = ?", [signed, accountId]);
}

async function recomputeBalances(db: SyncSqlDb, accountIds: (string | null | undefined)[]): Promise<void> {
  for (const id of new Set(accountIds.filter((a): a is string => !!a))) {
    await db.runAsync(
      `UPDATE accounts SET balance = openingBalance + COALESCE((
         SELECT SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE -t.amount END)
         FROM transactions t WHERE t.accountId = accounts.id
       ), 0)
       WHERE id = ?`,
      [id]
    );
  }
}

async function ledgerNet(db: SyncSqlDb, accountId: string): Promise<number> {
  const row = await db.getFirstAsync<{ net: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0) AS net
     FROM transactions WHERE accountId = ?`,
    [accountId]
  );
  return row?.net ?? 0;
}

function settingsAssignments(settings: SettingsPatch): { sql: string[]; params: Bind[] } {
  const sql: string[] = [];
  const params: Bind[] = [];
  for (const field of SETTINGS_FIELDS) {
    const value = settings[field];
    if (value === undefined) continue;
    sql.push(`${field} = ?`);
    params.push(field === "showTimeCost" ? (value ? 1 : 0) : (value as Bind));
  }
  return { sql, params };
}

export type PhoneWrites = ReturnType<typeof createPhoneWrites>;

/** db.ts's writes on one device's database, stamped with that device's clock. */
export function createPhoneWrites(opts: { access: SyncDbAccess; now: () => string }) {
  const { access, now } = opts;
  const run = <T>(fn: (db: SyncSqlDb) => Promise<T>) => access.run(fn);

  return {
    async createAccount(account: AccountInput): Promise<string> {
      const id = newId("acc");
      const at = now();
      await run(async (db) => {
        const opening = account.openingBalance ?? account.balance;
        await db.runAsync(
          `INSERT INTO accounts (${ACCOUNT_COLUMNS}, clientUpdatedAt, dirty, syncError)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
          [id, account.name, account.type, opening, opening, account.currency, account.color, account.icon,
            account.isDefault ? 1 : 0, account.createdAt ?? at, at]
        );
      });
      return id;
    },

    async updateAccount(id: string, account: AccountPatch): Promise<void> {
      await run(async (db) => {
        const current = await db.getFirstAsync<Record<string, any>>(
          `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`,
          [id]
        );
        if (!current) return false;
        let nextOpening = account.openingBalance ?? current.openingBalance;
        if (account.balance !== undefined && account.openingBalance === undefined) {
          nextOpening = account.balance - (await ledgerNet(db, id));
        }
        await db.runAsync(
          `UPDATE accounts
           SET name = ?, type = ?, openingBalance = ?, currency = ?, color = ?, icon = ?,
               clientUpdatedAt = ?, dirty = 1, syncError = NULL
           WHERE id = ?`,
          [account.name ?? current.name, account.type ?? current.type, nextOpening,
            account.currency ?? current.currency, account.color ?? current.color, account.icon ?? current.icon,
            now(), id]
        );
        await recomputeBalances(db, [id]);
        return true;
      });
    },

    async deleteAccount(id: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const result = await db.runAsync("DELETE FROM accounts WHERE id = ?", [id]);
          if (result.changes > 0) await writeTombstone(db, "accounts", id, now());
          return result.changes > 0;
        })
      );
    },

    async addTransaction(transaction: TransactionInput): Promise<string> {
      const id = newId("tx");
      const at = now();
      await run((db) =>
        inTransaction(db, async () => {
          let accountId = transaction.accountId ?? null;
          if (!accountId) {
            const fallback = await db.getFirstAsync<{ id: string }>(
              "SELECT id FROM accounts WHERE isDefault = 1 ORDER BY createdAt ASC LIMIT 1"
            );
            accountId = fallback?.id ?? null;
          }
          await db.runAsync(
            `INSERT INTO transactions (${TRANSACTION_COLUMNS}, clientUpdatedAt, dirty, syncError)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
            [id, transaction.amount, transaction.category, transaction.type, transaction.isImpulse ? 1 : 0,
              transaction.note || null, transaction.dateISO, transaction.createdAt ?? at, accountId,
              transaction.currency || "USD", at]
          );
          await adjustBalance(db, accountId, transaction, 1);
        })
      );
      return id;
    },

    async updateTransaction(id: string, transaction: Omit<TransactionInput, "createdAt">): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const before = await db.getFirstAsync<{ accountId: string | null }>(
            "SELECT accountId FROM transactions WHERE id = ?",
            [id]
          );
          if (!before) return false;
          const accountId = transaction.accountId || null;
          await db.runAsync(
            `UPDATE transactions
             SET amount = ?, category = ?, type = ?, isImpulse = ?, note = ?, dateISO = ?, accountId = ?, currency = ?,
                 clientUpdatedAt = ?, dirty = 1, syncError = NULL
             WHERE id = ?`,
            [transaction.amount, transaction.category, transaction.type, transaction.isImpulse ? 1 : 0,
              transaction.note || null, transaction.dateISO, accountId, transaction.currency || "USD", now(), id]
          );
          await recomputeBalances(db, [before.accountId, accountId]);
          return true;
        })
      );
    },

    async deleteTransaction(id: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const tx = await db.getFirstAsync<{ accountId: string | null; amount: number; type: string }>(
            "SELECT accountId, amount, type FROM transactions WHERE id = ?",
            [id]
          );
          if (!tx) return false;
          await db.runAsync("DELETE FROM transactions WHERE id = ?", [id]);
          await writeTombstone(db, "transactions", id, now());
          await adjustBalance(db, tx.accountId, tx, -1);
          return true;
        })
      );
    },

    async updateSettings(settings: SettingsPatch): Promise<void> {
      const { sql, params } = settingsAssignments(settings);
      if (sql.length === 0) return;
      await run(async (db) => {
        await db.runAsync(`INSERT OR IGNORE INTO settings (id, clientUpdatedAt, dirty) VALUES (1, ?, 1)`, [EPOCH_ISO]);
        await db.runAsync(
          `UPDATE settings SET ${[...sql, "clientUpdatedAt = ?", "dirty = 1", "syncError = NULL"].join(", ")}
           WHERE id = 1`,
          [...params, now()]
        );
      });
    },

    /** A default the device chose by itself (first-run language): leaves the row at the epoch. */
    async applySettingsDefaults(settings: SettingsPatch): Promise<boolean> {
      const { sql, params } = settingsAssignments(settings);
      if (sql.length === 0) return false;
      return run(async (db) => {
        const result = await db.runAsync(
          `UPDATE settings SET ${sql.join(", ")} WHERE id = 1 AND clientUpdatedAt = ?`,
          [...params, EPOCH_ISO]
        );
        return result.changes > 0;
      });
    },

    async addCustomCategory(cat: { name: string; icon: string; color: string }): Promise<void> {
      const name = cat.name.trim();
      await run((db) =>
        inTransaction(db, async () => {
          const at = now();
          await db.runAsync(
            `INSERT INTO custom_categories (name, icon, color, createdAt, clientUpdatedAt, dirty, syncError)
             VALUES (?, ?, ?, ?, ?, 1, NULL)
             ON CONFLICT(name) DO UPDATE SET
               icon = excluded.icon, color = excluded.color,
               clientUpdatedAt = excluded.clientUpdatedAt, dirty = 1, syncError = NULL`,
            [name, cat.icon, cat.color, at, at]
          );
          await clearTombstone(db, "categories", name);
        })
      );
    },

    async deleteCustomCategory(name: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const result = await db.runAsync(`DELETE FROM custom_categories WHERE name = ?`, [name]);
          if (result.changes > 0) await writeTombstone(db, "categories", name, now());
          return result.changes > 0;
        })
      );
    },

    async upsertSubscription(sub: SubscriptionInput): Promise<void> {
      const next: Record<(typeof SUBSCRIPTION_FIELDS)[number], Bind> = {
        merchantDisplay: sub.merchantDisplay,
        merchantNormalized: sub.merchantNormalized,
        cadence: sub.cadence,
        typicalAmount: sub.typicalAmount,
        currency: sub.currency || "USD",
        confidenceScore: sub.confidenceScore,
        lastChargedAt: sub.lastChargedAt ?? null,
        nextExpectedAt: sub.nextExpectedAt ?? null,
        status: sub.status,
        cancelUrl: sub.cancelUrl ?? null,
        cancelNotes: sub.cancelNotes ?? null,
        source: sub.source ?? "transaction",
      };
      await run((db) =>
        inTransaction(db, async () => {
          const existing = await db.getFirstAsync<Record<string, Bind>>(
            `SELECT ${SUBSCRIPTION_FIELDS.join(", ")} FROM subscriptions WHERE id = ?`,
            [sub.id]
          );
          const at = now();
          if (!existing) {
            await db.runAsync(
              `INSERT INTO subscriptions (id, ${SUBSCRIPTION_FIELDS.join(", ")}, createdAt, clientUpdatedAt, dirty, syncError)
               VALUES (?, ${SUBSCRIPTION_FIELDS.map(() => "?").join(", ")}, ?, ?, 1, NULL)`,
              [sub.id, ...SUBSCRIPTION_FIELDS.map((f) => next[f]), sub.createdAt ?? at, at]
            );
            await clearTombstone(db, "subscriptions", sub.id);
            return true;
          }
          if (SUBSCRIPTION_FIELDS.every((f) => (existing[f] ?? null) === next[f])) return false;
          await db.runAsync(
            `UPDATE subscriptions
             SET ${SUBSCRIPTION_FIELDS.map((f) => `${f} = ?`).join(", ")},
                 clientUpdatedAt = ?, dirty = 1, syncError = NULL
             WHERE id = ?`,
            [...SUBSCRIPTION_FIELDS.map((f) => next[f]), at, sub.id]
          );
          return true;
        })
      );
    },

    async updateSubscriptionStatus(id: string, status: "confirmed" | "possible" | "canceled"): Promise<void> {
      await run((db) =>
        db.runAsync(
          `UPDATE subscriptions SET status = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL WHERE id = ?`,
          [status, now(), id]
        )
      );
    },

    async deleteSubscription(id: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          await db.runAsync(`DELETE FROM subscription_occurrences WHERE subscriptionId = ?`, [id]);
          const result = await db.runAsync(`DELETE FROM subscriptions WHERE id = ?`, [id]);
          if (result.changes > 0) await writeTombstone(db, "subscriptions", id, now());
        })
      );
    },

    // ── Phase 4: recurring series, bills, budgets, net worth ──────────────

    async addRecurring(input: RecurringInput): Promise<string> {
      const id = newId("rec");
      const at = now();
      await run((db) =>
        db.runAsync(
          `INSERT INTO recurring_transactions (${RECURRING_COLUMNS}, clientUpdatedAt, dirty, syncError)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, 1, NULL)`,
          [id, input.accountId || null, input.name, input.amount, input.category, input.type, input.isImpulse ? 1 : 0,
            input.frequency, input.startDate, input.nextDate, input.currency || "USD", at, at]
        )
      );
      return id;
    },

    async setRecurringActive(id: string, active: boolean): Promise<void> {
      await run((db) =>
        db.runAsync(
          `UPDATE recurring_transactions SET isActive = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
           WHERE id = ? AND isActive <> ?`,
          [active ? 1 : 0, now(), id, active ? 1 : 0]
        )
      );
    },

    async deleteRecurring(id: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const result = await db.runAsync(`DELETE FROM recurring_transactions WHERE id = ?`, [id]);
          if (result.changes > 0) await writeTombstone(db, "recurring", id, now());
          return result.changes > 0;
        })
      );
    },

    async addBillReminder(input: BillReminderInput): Promise<string> {
      const id = newId("bill");
      const at = now();
      await run((db) =>
        db.runAsync(
          `INSERT INTO bill_reminders (${BILL_COLUMNS}, clientUpdatedAt, dirty, syncError)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 1, NULL)`,
          [id, input.name, input.amount, input.dueDay, input.category, input.isRecurring ? 1 : 0, input.nextDueDate, at, at]
        )
      );
      return id;
    },

    /** db.ts's setBillPaid: decided from the row as it is, with the app's own billPaidChange. */
    async setBillPaid(id: string, paid: boolean): Promise<boolean> {
      return run(async (db) => {
        const row = await db.getFirstAsync<Record<string, any>>(`SELECT ${BILL_COLUMNS} FROM bill_reminders WHERE id = ?`, [id]);
        if (!row) return false;
        const at = now();
        const next = billPaidChange(
          { isRecurring: row.isRecurring === 1, isPaid: row.isPaid === 1, paidAt: row.paidAt ?? null, dueDay: row.dueDay, nextDueDate: row.nextDueDate },
          paid,
          at
        );
        if (!next) return false;
        await db.runAsync(
          `UPDATE bill_reminders SET isPaid = ?, paidAt = ?, nextDueDate = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
           WHERE id = ?`,
          [next.isPaid ? 1 : 0, next.paidAt, next.nextDueDate, at, id]
        );
        return true;
      });
    },

    async deleteBillReminder(id: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const result = await db.runAsync(`DELETE FROM bill_reminders WHERE id = ?`, [id]);
          if (result.changes > 0) await writeTombstone(db, "billReminders", id, now());
          return result.changes > 0;
        })
      );
    },

    async setCategoryBudget(category: string, amount: number, period: "weekly" | "monthly" | "yearly" = "monthly"): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const at = now();
          await db.runAsync(
            `INSERT INTO category_budgets (category, amount, period, createdAt, clientUpdatedAt, dirty, syncError)
             VALUES (?, ?, ?, ?, ?, 1, NULL)
             ON CONFLICT(category) DO UPDATE SET
               amount = excluded.amount, period = excluded.period,
               clientUpdatedAt = excluded.clientUpdatedAt, dirty = 1, syncError = NULL`,
            [category, amount, period, at, at]
          );
          await clearTombstone(db, "categoryBudgets", category);
        })
      );
    },

    async deleteCategoryBudget(category: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const result = await db.runAsync(`DELETE FROM category_budgets WHERE category = ?`, [category]);
          if (result.changes > 0) await writeTombstone(db, "categoryBudgets", category, now());
          return result.changes > 0;
        })
      );
    },

    async addNetWorthEntry(input: NetWorthInput): Promise<string> {
      const id = newId("nw");
      const at = now();
      await run((db) =>
        db.runAsync(
          `INSERT INTO net_worth_entries (id, date, assets, liabilities, netWorth, breakdown, createdAt, clientUpdatedAt, dirty, syncError)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
          [id, input.date, input.assets, input.liabilities, input.assets - input.liabilities, serializeBreakdown(input.breakdown), at, at]
        )
      );
      return id;
    },

    async deleteNetWorthEntry(id: string): Promise<void> {
      await run((db) =>
        inTransaction(db, async () => {
          const result = await db.runAsync(`DELETE FROM net_worth_entries WHERE id = ?`, [id]);
          if (result.changes > 0) await writeTombstone(db, "netWorth", id, now());
          return result.changes > 0;
        })
      );
    },
  };
}
