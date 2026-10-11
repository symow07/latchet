import { test, expect, mock, beforeEach, describe } from 'bun:test';
import { createMemorySqlite } from './test-support/memory-sqlite';
import { defaultAccountId, EPOCH_ISO } from './local-schema';
import { createSqliteSyncStore } from './sync/sqlite-store';
import type { SqlDb } from './db';

/**
 * db.ts's writes, run for real: its SQL against SQLite (bun:sqlite) behind a
 * stand-in for expo-sqlite. What is under test is the bookkeeping the sync
 * engine will rely on — which writes stamp clientUpdatedAt and mark rows
 * dirty, which leave tombstones, which deliberately do neither — and the 0/1
 * to boolean boundary.
 *
 * db.ts is imported under a query string. Bun's module mocks are process-wide,
 * and quick-add-notify.test.ts replaces './db' with a stub; the query string
 * gives this file its own instance of the real module regardless of the order
 * the files run in.
 */
const mem = createMemorySqlite();
mock.module('expo-sqlite', () => mem.expoSqlite);

const { Database } = await import('bun:sqlite');
// The legacy shared file, as a phone upgraded from the previous version has it.
mem.files.set('real_budget.db', new Database(':memory:'));

const db = (await import('./db.ts?isolated' as string)) as typeof import('./db');

let mutations = 0;
db.onLocalMutation(() => {
  mutations += 1;
});

let user = 0;
let handle: SqlDb;
let userId = '';

beforeEach(async () => {
  // A brand-new user for every test: a fresh file, seeded as on a new phone.
  userId = `user${++user}`;
  await db.openUserDatabase(userId);
  handle = await db.getDatabase();
  mutations = 0;
});

type SyncRow = { clientUpdatedAt: string; dirty: number; syncError: string | null };

async function syncState(table: string, idColumn: string, id: string | number): Promise<SyncRow | null> {
  return handle.getFirstAsync<SyncRow>(
    `SELECT clientUpdatedAt, dirty, syncError FROM ${table} WHERE ${idColumn} = ?`,
    [id],
  );
}

async function tombstones(): Promise<{ entity: string; id: string }[]> {
  return handle.getAllAsync('SELECT entity, id FROM sync_tombstones ORDER BY entity, id');
}

const isRecent = (iso: string | undefined) =>
  !!iso && iso !== EPOCH_ISO && Math.abs(Date.parse(iso) - Date.now()) < 60_000;

const expense = (over: Partial<Parameters<typeof db.addTransaction>[0]> = {}) => ({
  amount: 12.5,
  category: 'Food',
  type: 'Expense' as const,
  isImpulse: false,
  dateISO: '2026-10-11',
  ...over,
});

describe('per-user files', () => {
  test('the legacy shared file is gone, and each user has their own', async () => {
    expect(mem.files.has('real_budget.db')).toBe(false);
    expect(mem.files.has(`budget_${userId}.db`)).toBe(true);
    expect(db.activeUserId()).toBe(userId);
  });

  test('a new file starts with the epoch-dated defaults, which are not "unsynced work"', async () => {
    expect(await syncState('settings', 'id', 1)).toEqual({ clientUpdatedAt: EPOCH_ISO, dirty: 1, syncError: null });
    expect(await syncState('accounts', 'id', defaultAccountId(userId))).toEqual({
      clientUpdatedAt: EPOCH_ISO,
      dirty: 1,
      syncError: null,
    });
    expect((await db.countUnsyncedChanges()).total).toBe(0);
    expect(await db.isSettingsDefault()).toBe(true);
  });

  test('closing refuses later reads and writes; deleting removes the file', async () => {
    await db.closeUserDatabase();
    await expect(db.getTransactions()).rejects.toThrow(/nobody is signed in/);
    await expect(db.addTransaction(expense())).rejects.toThrow(/nobody is signed in/);
    await db.deleteUserDatabase(userId);
    expect(mem.files.has(`budget_${userId}.db`)).toBe(false);
    // Deleting a file that is not there is not an error.
    await db.deleteUserDatabase(userId);
  });
});

describe('transactions', () => {
  test('adding one stamps it, marks it dirty, books it to the default account and says so', async () => {
    const id = await db.addTransaction(expense({ isImpulse: true }));
    const state = await syncState('transactions', 'id', id);
    expect(state?.dirty).toBe(1);
    expect(isRecent(state?.clientUpdatedAt)).toBe(true);
    expect(mutations).toBe(1);

    const [tx] = await db.getTransactions();
    expect(tx).toEqual({
      id,
      amount: 12.5,
      category: 'Food',
      type: 'Expense',
      isImpulse: true,
      note: null,
      dateISO: '2026-10-11',
      createdAt: expect.any(String),
      accountId: defaultAccountId(userId),
      currency: 'USD',
    });
    expect((await db.getAccountById(defaultAccountId(userId)))?.balance).toBe(-12.5);
  });

  test('isImpulse leaves SQLite as a boolean, false as well as true', async () => {
    await db.addTransaction(expense({ isImpulse: false, note: 'Lunch' }));
    const [tx] = await db.getTransactions();
    expect(tx!.isImpulse).toBe(false);
    expect(tx!.note).toBe('Lunch');
    const raw = await handle.getFirstAsync<{ isImpulse: number }>('SELECT isImpulse FROM transactions');
    expect(raw?.isImpulse).toBe(0);
  });

  test('deleting one leaves a tombstone and corrects the balance', async () => {
    const id = await db.addTransaction(expense());
    mutations = 0;
    await db.deleteTransaction(id);
    expect(await db.getTransactions()).toEqual([]);
    expect(await tombstones()).toEqual([{ entity: 'transactions', id }]);
    expect((await db.getAccountById(defaultAccountId(userId)))?.balance).toBe(0);
    expect(mutations).toBe(1);
    expect((await db.countUnsyncedChanges()).deletions).toBe(1);
  });

  test('an edit re-stamps the row, clears its sync error and moves money between accounts', async () => {
    const other = await db.createAccount({ name: 'Bank', type: 'checking', balance: 0, currency: 'USD', color: '#000', icon: 'bank' });
    const id = await db.addTransaction(expense());
    await handle.runAsync(`UPDATE transactions SET dirty = 0, syncError = 'invalid', clientUpdatedAt = ? WHERE id = ?`, [
      EPOCH_ISO,
      id,
    ]);
    await db.updateTransaction(id, { ...expense(), accountId: other });
    expect(await syncState('transactions', 'id', id)).toEqual({
      clientUpdatedAt: expect.not.stringMatching(/^1970/),
      dirty: 1,
      syncError: null,
    });
    expect((await db.getAccountById(defaultAccountId(userId)))?.balance).toBe(0);
    expect((await db.getAccountById(other))?.balance).toBe(-12.5);
  });

  test('concurrent writes queue instead of colliding inside one connection', async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => db.addTransaction(expense({ amount: i + 1 }))));
    expect(new Set(ids).size).toBe(12);
    expect((await db.getAccountById(defaultAccountId(userId)))?.balance).toBe(-78);
  });
});

describe('settings', () => {
  test('a user edit stamps the whole row as theirs', async () => {
    await db.updateSettings({ monthlyBudget: 900, showTimeCost: 1 });
    const state = await syncState('settings', 'id', 1);
    expect(state?.dirty).toBe(1);
    expect(isRecent(state?.clientUpdatedAt)).toBe(true);
    expect((await db.getSettings()).monthlyBudget).toBe(900);
    expect(await db.isSettingsDefault()).toBe(false);
    expect(mutations).toBe(1);
  });

  test('a device default fills an untouched row without claiming it, and never overrides an edit', async () => {
    expect(await db.applySettingsDefaults({ locale: 'fr' })).toBe(true);
    expect((await db.getSettings()).locale).toBe('fr');
    expect((await syncState('settings', 'id', 1))?.clientUpdatedAt).toBe(EPOCH_ISO);
    expect(mutations).toBe(0);

    await db.updateSettings({ locale: 'zh' });
    expect(await db.applySettingsDefaults({ locale: 'ar' })).toBe(false);
    expect((await db.getSettings()).locale).toBe('zh');
  });
});

describe('subscriptions', () => {
  const detected = {
    id: 'sub_netflix',
    merchantDisplay: 'Netflix',
    merchantNormalized: 'netflix',
    cadence: 'monthly' as const,
    typicalAmount: 15.49,
    currency: 'USD',
    confidenceScore: 0.92,
    lastChargedAt: '2026-10-01',
    nextExpectedAt: '2026-11-01',
    status: 'possible' as const,
    cancelUrl: null,
    cancelNotes: null,
    source: 'transaction' as const,
  };

  test('a re-scan that finds nothing new changes nothing — no stamp, no dirty, no upload', async () => {
    await db.upsertSubscription(detected);
    expect((await syncState('subscriptions', 'id', 'sub_netflix'))?.dirty).toBe(1);
    // As if the sync engine had since uploaded it.
    await handle.runAsync(`UPDATE subscriptions SET dirty = 0, clientUpdatedAt = '2026-10-02T00:00:00.000Z'`);
    mutations = 0;

    await db.upsertSubscription({ ...detected });
    expect(await syncState('subscriptions', 'id', 'sub_netflix')).toEqual({
      clientUpdatedAt: '2026-10-02T00:00:00.000Z',
      dirty: 0,
      syncError: null,
    });
    expect(mutations).toBe(0);
  });

  test('a re-scan that does change a value is an edit', async () => {
    await db.upsertSubscription(detected);
    await handle.runAsync(`UPDATE subscriptions SET dirty = 0, clientUpdatedAt = '2026-10-02T00:00:00.000Z'`);
    await db.upsertSubscription({ ...detected, lastChargedAt: '2026-11-01', nextExpectedAt: '2026-12-01' });
    const state = await syncState('subscriptions', 'id', 'sub_netflix');
    expect(state?.dirty).toBe(1);
    expect(isRecent(state?.clientUpdatedAt)).toBe(true);
    const [sub] = await db.getSubscriptions();
    expect(sub?.updatedAt).toBe(state!.clientUpdatedAt);
  });

  test('a status change is the user’s edit; a deletion leaves a tombstone', async () => {
    await db.upsertSubscription(detected);
    await handle.runAsync(`UPDATE subscriptions SET dirty = 0, clientUpdatedAt = ?`, [EPOCH_ISO]);
    await db.updateSubscriptionStatus('sub_netflix', 'canceled');
    expect((await syncState('subscriptions', 'id', 'sub_netflix'))?.dirty).toBe(1);
    await db.deleteSubscription('sub_netflix');
    expect(await tombstones()).toEqual([{ entity: 'subscriptions', id: 'sub_netflix' }]);
  });
});

describe('custom categories', () => {
  test('identified by name: deleting leaves a tombstone, re-creating lifts it', async () => {
    await db.addCustomCategory({ name: '  Pets ', icon: 'paw', color: '#123456' });
    expect((await syncState('custom_categories', 'name', 'Pets'))?.dirty).toBe(1);
    await db.deleteCustomCategory('Pets');
    expect(await tombstones()).toEqual([{ entity: 'categories', id: 'Pets' }]);
    await db.addCustomCategory({ name: 'Pets', icon: 'paw', color: '#654321' });
    expect(await tombstones()).toEqual([]);
    expect((await db.getCustomCategories()).map((c) => c.color)).toEqual(['#654321']);
    expect(mutations).toBe(3);
  });
});

describe('reset all activity', () => {
  test('deletes through tombstones so the reset reaches the server', async () => {
    const bank = await db.createAccount({ name: 'Bank', type: 'checking', balance: 50, currency: 'EUR', color: '#000', icon: 'bank' });
    const a = await db.addTransaction(expense());
    const b = await db.addTransaction(expense({ accountId: bank }));
    await db.updateSettings({ monthlyBudget: 900, currency: 'EUR', currencySymbol: '€', locale: 'fr' });
    await db.updateAccount(defaultAccountId(userId), { name: 'Wallet', openingBalance: 30 });

    await db.resetAllData();

    expect(await db.getTransactions()).toEqual([]);
    expect(await tombstones()).toEqual(
      [
        { entity: 'accounts', id: bank },
        { entity: 'transactions', id: a },
        { entity: 'transactions', id: b },
      ].sort((x, y) => (x.entity + x.id).localeCompare(y.entity + y.id)),
    );
    // The default account is reset in place, as an edit made now.
    const accounts = await db.getAccounts();
    expect(accounts.map((x) => [x.id, x.name, x.balance])).toEqual([[defaultAccountId(userId), 'Cash', 0]]);
    expect(isRecent((await syncState('accounts', 'id', defaultAccountId(userId)))?.clientUpdatedAt)).toBe(true);
    // Numbers zeroed and stamped; currency and language kept.
    const settings = await db.getSettings();
    expect([settings.monthlyBudget, settings.currency, settings.locale]).toEqual([0, 'EUR', 'fr']);
    expect(await db.isSettingsDefault()).toBe(false);
  });
});

// ── Phase 4: the four screens' entities ──────────────────────────────────────

/** The sync store over the active database, as cloud-sync.ts builds it. */
function store() {
  return createSqliteSyncStore({ run: (fn) => db.withWriteLock((h) => fn(h)) });
}

const series = (over: Partial<Parameters<typeof db.addRecurring>[0]> = {}) => ({
  accountId: null,
  name: 'Rent',
  amount: 700,
  category: 'Other',
  type: 'Expense' as const,
  isImpulse: false,
  frequency: 'monthly' as const,
  startDate: '2026-10-11',
  nextDate: '2026-10-11',
  currency: 'EUR',
  ...over,
});

describe('recurring account', () => {
  test('a new series keeps the account it books onto, and is pushed with it', async () => {
    const bank = await db.createAccount({ name: 'Bank', type: 'checking', balance: 0, currency: 'EUR', color: '#000', icon: 'bank' });
    mutations = 0;
    const id = await db.addRecurring(series({ accountId: bank }));
    expect(id).toMatch(/^rec_/);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(mutations).toBe(1);

    const [saved] = await db.getRecurring();
    expect(saved).toEqual({
      id,
      accountId: bank,
      name: 'Rent',
      amount: 700,
      category: 'Other',
      type: 'Expense',
      isImpulse: false,
      frequency: 'monthly',
      startDate: '2026-10-11',
      nextDate: '2026-10-11',
      lastCreated: null,
      isActive: true,
      currency: 'EUR',
      createdAt: expect.any(String),
    });
    const state = await syncState('recurring_transactions', 'id', id);
    expect(state?.dirty).toBe(1);
    expect(isRecent(state?.clientUpdatedAt)).toBe(true);

    const [pending] = await store().readPending('recurring', null, 10);
    expect(pending!.row).toMatchObject({ id, accountId: bank, isActive: true, isImpulse: false, lastCreated: null });
    expect(await db.getLocalSyncState('recurring', id)).toBe('pending');
  });

  test('deleting the account a series books onto leaves the series alone until the server unlinks it', async () => {
    const bank = await db.createAccount({ name: 'Bank', type: 'checking', balance: 0, currency: 'USD', color: '#000', icon: 'bank' });
    const id = await db.addRecurring(series({ accountId: bank }));
    await db.deleteAccount(bank);
    // Unlinking here would race the server: the delete may yet lose to a newer edit of the account.
    expect((await db.getRecurring())[0]).toMatchObject({ id, accountId: bank });
  });
});

describe('recurring series', () => {
  test('pausing is a stamped edit, a no-op when it already is, and a delete leaves a tombstone', async () => {
    const id = await db.addRecurring(series());
    await handle.runAsync(`UPDATE recurring_transactions SET dirty = 0, clientUpdatedAt = ?`, [EPOCH_ISO]);
    expect(await db.getLocalSyncState('recurring', id)).toBe('synced');
    mutations = 0;

    await db.setRecurringActive(id, true);
    expect(await syncState('recurring_transactions', 'id', id)).toEqual({ clientUpdatedAt: EPOCH_ISO, dirty: 0, syncError: null });
    expect(mutations).toBe(0);

    await db.setRecurringActive(id, false);
    expect((await db.getRecurring())[0]!.isActive).toBe(false);
    expect(isRecent((await syncState('recurring_transactions', 'id', id))?.clientUpdatedAt)).toBe(true);
    expect(mutations).toBe(1);

    await db.deleteRecurring(id);
    expect(await db.getRecurring()).toEqual([]);
    expect(await tombstones()).toEqual([{ entity: 'recurring', id }]);
    expect(await db.getLocalSyncState('recurring', id)).toBe('missing');
  });
});

describe('bill reminders', () => {
  const water = { name: 'Water', amount: 20, dueDay: 31, category: 'Other', isRecurring: true, nextDueDate: '2026-01-31' };

  test('paying moves a recurring bill on a month; asking again changes nothing; un-paying moves it back', async () => {
    const id = await db.addBillReminder(water);
    expect(id).toMatch(/^bill_/);
    expect((await db.getBillReminders())[0]).toEqual({
      id, ...water, isPaid: false, paidAt: null, createdAt: expect.any(String),
    });
    mutations = 0;

    expect(await db.setBillPaid(id, true)).toBe(true);
    const paid = (await db.getBillReminders())[0]!;
    expect(paid).toMatchObject({ isPaid: true, nextDueDate: '2026-02-28' });
    expect(isRecent(paid.paidAt ?? undefined)).toBe(true);
    const raw = await handle.getFirstAsync<{ isPaid: number; dirty: number }>('SELECT isPaid, dirty FROM bill_reminders');
    expect(raw).toEqual({ isPaid: 1, dirty: 1 });

    // A second tap on a row drawn before the first landed.
    expect(await db.setBillPaid(id, true)).toBe(false);
    expect((await db.getBillReminders())[0]!.nextDueDate).toBe('2026-02-28');
    expect(mutations).toBe(1);

    expect(await db.setBillPaid(id, false)).toBe(true);
    expect((await db.getBillReminders())[0]).toMatchObject({ isPaid: false, paidAt: null, nextDueDate: '2026-01-31' });

    await db.deleteBillReminder(id);
    expect(await tombstones()).toEqual([{ entity: 'billReminders', id }]);
  });
});

describe('phase4 screens', () => {
  test('a category budget upserts by category', async () => {
    await db.setCategoryBudget('Food', 300);
    const [first] = await db.getCategoryBudgets();
    await handle.runAsync(`UPDATE category_budgets SET dirty = 0, clientUpdatedAt = ?`, [EPOCH_ISO]);

    await db.setCategoryBudget('Food', 450);
    const budgets = await db.getCategoryBudgets();
    expect(budgets).toEqual([{ category: 'Food', amount: 450, period: 'monthly', createdAt: first!.createdAt }]);
    const state = await syncState('category_budgets', 'category', 'Food');
    expect(state?.dirty).toBe(1);
    expect(isRecent(state?.clientUpdatedAt)).toBe(true);

    // On the wire under its category, as the server keys it.
    const [pending] = await store().readPending('categoryBudgets', null, 10);
    expect(pending!.row).toEqual({
      id: 'Food', clientUpdatedAt: state!.clientUpdatedAt, amount: 450, period: 'monthly', createdAt: first!.createdAt,
    });

    await db.deleteCategoryBudget('Food');
    expect(await tombstones()).toEqual([{ entity: 'categoryBudgets', id: 'Food' }]);
    await db.setCategoryBudget('Food', 200);
    expect(await tombstones()).toEqual([]);
    expect((await db.getCategoryBudgets()).map((b) => [b.category, b.amount])).toEqual([['Food', 200]]);
  });

  test('a net-worth snapshot keeps its breakdown as JSON text, and reads back as an object', async () => {
    const id = await db.addNetWorthEntry({ date: '2026-10-11', assets: 5000, liabilities: 1200, breakdown: { cashSavings: 5000, loans: 1200 } });
    expect(id).toMatch(/^nw_/);
    const raw = await handle.getFirstAsync<{ breakdown: string; netWorth: number }>('SELECT breakdown, netWorth FROM net_worth_entries');
    expect(raw).toEqual({ breakdown: '{"cashSavings":5000,"loans":1200}', netWorth: 3800 });
    expect(await db.getNetWorthEntries()).toEqual([
      {
        id, date: '2026-10-11', assets: 5000, liabilities: 1200, netWorth: 3800,
        breakdown: { cashSavings: 5000, loans: 1200 }, createdAt: expect.any(String),
      },
    ]);
    const [pending] = await store().readPending('netWorth', null, 10);
    expect(pending!.row).toMatchObject({ id, netWorth: 3800, breakdown: '{"cashSavings":5000,"loans":1200}' });

    await db.addNetWorthEntry({ date: '2026-10-12', assets: 1, liabilities: 0, breakdown: {} });
    expect((await db.getNetWorthEntries())[0]).toMatchObject({ date: '2026-10-12', breakdown: null });

    // One taken by mistake can go, as a deletion the server receives.
    await db.deleteNetWorthEntry(id);
    expect((await db.getNetWorthEntries()).map((e) => e.date)).toEqual(['2026-10-12']);
    expect(await tombstones()).toEqual([{ entity: 'netWorth', id }]);
  });
});

describe('unsynced work', () => {
  test('the four new tables count, and a refused row says so', async () => {
    const id = await db.addBillReminder({ name: 'Gas', amount: 5, dueDay: 2, category: 'Other', isRecurring: false, nextDueDate: '2026-11-02' });
    await db.setCategoryBudget('Food', 10);
    await db.addNetWorthEntry({ date: '2026-10-11', assets: 1, liabilities: 0 });
    await db.addRecurring(series());
    const unsynced = await db.countUnsyncedChanges();
    expect([unsynced.byEntity.billReminders, unsynced.byEntity.categoryBudgets, unsynced.byEntity.netWorth, unsynced.byEntity.recurring]).toEqual([1, 1, 1, 1]);
    await handle.runAsync(`UPDATE bill_reminders SET syncError = 'invalid' WHERE id = ?`, [id]);
    expect(await db.getLocalSyncState('billReminders', id)).toBe('refused');
  });
});
