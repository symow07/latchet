import { test, expect, mock, beforeEach, describe } from 'bun:test';
import { createMemorySqlite } from './test-support/memory-sqlite';
import { todayISO } from './dates';
import {
  defaultAccountId,
  EPOCH_ISO,
  LOCAL_SCHEMA_KEY,
  LOCAL_SCHEMA_SQL,
  LOCAL_SYNC_TABLES,
  SYNC_ENTITIES,
  upgradeLocalSchema,
} from './local-schema';
import { createSqliteSyncStore } from './sync/sqlite-store';
import { writeDetectedSubscription } from './sync/subscription-rows';
import type { LocalEmailFinding, SqlDb } from './db';

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
    expect(await db.getSubscriptionById('sub_netflix')).toMatchObject({ status: 'canceled', decision: 'cancel' });
    await db.deleteSubscription('sub_netflix');
    expect(await tombstones()).toEqual([{ entity: 'subscriptions', id: 'sub_netflix' }]);
  });

  test('a read returns every Phase 6 field, null or empty until something sets it', async () => {
    await db.upsertSubscription(detected);
    expect(await db.getSubscriptionById('sub_netflix')).toMatchObject({
      decision: null,
      canceledAt: null,
      trialEndsAt: null,
      previousAmount: null,
      priceChangedAt: null,
      alert: null,
      sources: '',
      billedVia: null,
    });
  });
});

describe('user decision wins', () => {
  const found = {
    id: 'sub_gym',
    merchantDisplay: 'City Gym',
    merchantNormalized: 'city gym',
    cadence: 'monthly' as const,
    typicalAmount: 30,
    currency: 'EUR',
    confidenceScore: 0.9,
    lastChargedAt: '2026-10-01',
    nextExpectedAt: '2026-11-01',
    status: 'active' as const,
    cancelUrl: null,
    cancelNotes: null,
    source: 'bank' as const,
    trialEndsAt: null,
    previousAmount: null,
    priceChangedAt: null,
    alert: null,
    sources: 'bank',
    billedVia: null,
  };
  /** The engine's next run: a price rise, a new charge, and its own idea of the status. */
  const rescan = (status: 'possible' | 'active' | 'trial' | 'ended') => ({
    ...found,
    typicalAmount: 35,
    previousAmount: 30,
    priceChangedAt: '2026-11-01',
    alert: 'price_rise' as const,
    lastChargedAt: '2026-11-01',
    nextExpectedAt: '2026-12-01',
    sources: 'bank,email',
    status,
  });
  /** As if the sync engine had uploaded the row. */
  const markSynced = () =>
    handle.runAsync(`UPDATE subscriptions SET dirty = 0, clientUpdatedAt = '2026-10-02T00:00:00.000Z'`);

  test('an engine write over a kept row updates the amount and dates, never the decision or its status', async () => {
    await db.upsertSubscription(found);
    await db.setSubscriptionDecision('sub_gym', 'keep');
    await markSynced();
    expect(await db.upsertSubscription(rescan('possible'))).toBe(true);
    expect(await db.getSubscriptionById('sub_gym')).toMatchObject({
      decision: 'keep',
      status: 'confirmed',
      canceledAt: null,
      typicalAmount: 35,
      previousAmount: 30,
      priceChangedAt: '2026-11-01',
      alert: 'price_rise',
      lastChargedAt: '2026-11-01',
      nextExpectedAt: '2026-12-01',
      sources: 'bank,email',
    });
    // A detection that changed something is an edit to sync.
    expect((await syncState('subscriptions', 'id', 'sub_gym'))?.dirty).toBe(1);
  });

  test('an engine write over a cancelled row keeps the cancellation and its date, even when the engine sees it active', async () => {
    await db.upsertSubscription(found);
    await db.setSubscriptionDecision('sub_gym', 'cancel', { canceledAt: '2026-10-15' });
    await db.upsertSubscription({ ...rescan('active'), decision: 'keep', canceledAt: null });
    expect(await db.getSubscriptionById('sub_gym')).toMatchObject({
      decision: 'cancel',
      canceledAt: '2026-10-15',
      status: 'canceled',
      typicalAmount: 35,
      lastChargedAt: '2026-11-01',
    });
  });

  test('an engine write never revives a dismissed row; one that changes nothing else stamps nothing', async () => {
    await db.upsertSubscription(found);
    await db.setSubscriptionDecision('sub_gym', 'dismiss');
    await markSynced();
    mutations = 0;
    // Only the engine's status differs from what is stored: nothing to write.
    expect(await db.upsertSubscription({ ...found, status: 'possible' })).toBe(false);
    expect(await syncState('subscriptions', 'id', 'sub_gym')).toEqual({
      clientUpdatedAt: '2026-10-02T00:00:00.000Z',
      dirty: 0,
      syncError: null,
    });
    expect(mutations).toBe(0);
    await db.upsertSubscription(rescan('trial'));
    expect(await db.getSubscriptionById('sub_gym')).toMatchObject({ decision: 'dismiss', status: 'dismissed', typicalAmount: 35 });
  });

  test('the rule is in the SQL, not the caller: a direct engine write cannot set a decision on an existing row', async () => {
    await db.upsertSubscription(found);
    await db.setSubscriptionDecision('sub_gym', 'keep');
    await db.withWriteLock((sql) =>
      writeDetectedSubscription(sql, {
        id: 'sub_gym',
        values: { ...rescan('ended'), decision: 'dismiss', canceledAt: '2026-01-01', cancelNotes: 'engine' },
        at: new Date().toISOString(),
      }),
    );
    expect(await db.getSubscriptionById('sub_gym')).toMatchObject({
      decision: 'keep',
      status: 'confirmed',
      canceledAt: null,
      cancelNotes: null,
      typicalAmount: 35,
    });
  });

  test('setSubscriptionDecision is the user’s edit: stamped, dirty, announced, with the status that follows it', async () => {
    await db.upsertSubscription(found);
    const cases = [
      ['keep', 'confirmed', null],
      ['cancel', 'canceled', todayISO()],
      ['dismiss', 'dismissed', null],
      [null, 'possible', null],
    ] as const;
    for (const [decision, status, canceledAt] of cases) {
      await markSynced();
      mutations = 0;
      expect(await db.setSubscriptionDecision('sub_gym', decision)).toBe(true);
      const state = await syncState('subscriptions', 'id', 'sub_gym');
      expect(state?.dirty).toBe(1);
      expect(state?.syncError).toBeNull();
      expect(state?.clientUpdatedAt).not.toBe('2026-10-02T00:00:00.000Z');
      expect(isRecent(state?.clientUpdatedAt)).toBe(true);
      expect(mutations).toBe(1);
      expect(await db.getSubscriptionById('sub_gym')).toMatchObject({ decision, status, canceledAt });
    }
    // Saying it again changes nothing; a given cancellation date is kept.
    await markSynced();
    mutations = 0;
    expect(await db.setSubscriptionDecision('sub_gym', null)).toBe(false);
    expect(mutations).toBe(0);
    expect((await syncState('subscriptions', 'id', 'sub_gym'))?.dirty).toBe(0);
    await db.setSubscriptionDecision('sub_gym', 'cancel', { canceledAt: '2026-09-30' });
    expect(await db.getSubscriptionById('sub_gym')).toMatchObject({ decision: 'cancel', canceledAt: '2026-09-30' });
    expect(await db.setSubscriptionDecision('missing', 'keep')).toBe(false);
  });

  test('a caller that predates the Phase 6 fields leaves them as they are; the user’s notes outlive a re-scan', async () => {
    await db.upsertSubscription({ ...found, trialEndsAt: '2026-10-20', alert: 'trial_ending', billedVia: 'apple' });
    await db.updateSubscriptionCancelInfo('sub_gym', 'https://gym.example/cancel', 'call them');
    const {
      trialEndsAt: _t,
      previousAmount: _p,
      priceChangedAt: _c,
      alert: _a,
      sources: _s,
      billedVia: _b,
      ...phase5
    } = found;
    await db.upsertSubscription({ ...phase5, typicalAmount: 31, cancelUrl: null, cancelNotes: null });
    expect(await db.getSubscriptionById('sub_gym')).toMatchObject({
      typicalAmount: 31,
      trialEndsAt: '2026-10-20',
      alert: 'trial_ending',
      billedVia: 'apple',
      sources: 'bank',
      cancelUrl: null,
      cancelNotes: 'call them',
    });
  });

  test('a new row may carry a decision (a merge moving it to a new id), and its status follows it', async () => {
    await db.upsertSubscription({ ...found, id: 'sub_gym_2', decision: 'cancel', canceledAt: '2026-10-01', status: 'active' });
    expect(await db.getSubscriptionById('sub_gym_2')).toMatchObject({ decision: 'cancel', canceledAt: '2026-10-01', status: 'canceled' });
    await db.upsertSubscription({ ...found, id: 'sub_gym_3', decision: 'keep', canceledAt: '2026-10-01' });
    expect(await db.getSubscriptionById('sub_gym_3')).toMatchObject({ decision: 'keep', canceledAt: null, status: 'confirmed' });
  });

  test('merging moves the charge history once; the target never counts a charge twice', async () => {
    await db.upsertSubscription(found);
    await db.upsertSubscription({ ...found, id: 'sub_gym_old' });
    const occ = (id: string, subscriptionId: string, transactionId: string | null, chargedAt: string) => ({
      id,
      subscriptionId,
      transactionId,
      chargedAt,
      amount: 30,
    });
    await db.addSubscriptionOccurrence(occ('o1', 'sub_gym_old', 'tx_1', '2026-08-01'));
    await db.addSubscriptionOccurrence(occ('o2', 'sub_gym_old', 'tx_2', '2026-09-01'));
    await db.addSubscriptionOccurrence(occ('o3', 'sub_gym_old', null, '2026-07-01'));
    await db.addSubscriptionOccurrence(occ('n2', 'sub_gym', 'tx_2', '2026-09-01'));
    await db.addSubscriptionOccurrence(occ('n3', 'sub_gym', null, '2026-07-01'));
    mutations = 0;

    expect(await db.moveSubscriptionOccurrences('sub_gym_old', 'sub_gym')).toBe(1);
    const history = await db.getSubscriptionOccurrences('sub_gym');
    expect(history.map((o) => o.id).sort()).toEqual(['n2', 'n3', 'o1']);
    expect(await db.getSubscriptionOccurrences('sub_gym_old')).toEqual([]);
    // The engine re-deriving the moved charge under its new id adds nothing.
    await db.addSubscriptionOccurrence(occ('n1', 'sub_gym', 'tx_1', '2026-08-01'));
    expect((await db.getSubscriptionOccurrences('sub_gym')).length).toBe(3);
    expect(mutations).toBe(0);

    await db.deleteSubscription('sub_gym_old');
    expect(await tombstones()).toEqual([{ entity: 'subscriptions', id: 'sub_gym_old' }]);
    expect(await db.moveSubscriptionOccurrences('sub_gym', 'sub_gym')).toBe(0);
  });
});

describe('email findings cache', () => {
  const finding = (id: string, over: Partial<LocalEmailFinding> = {}): LocalEmailFinding => ({
    id,
    connectionId: 'conn_1',
    source: 'gmail',
    kind: 'renewal',
    merchant: 'Netflix',
    senderDomain: 'netflix.com',
    billedVia: null,
    amount: 15.49,
    currency: 'EUR',
    cadence: 'monthly',
    chargedISO: '2026-10-03',
    emailDateISO: '2026-10-03',
    nextChargeISO: '2026-11-03',
    trialEndsISO: null,
    previousAmount: null,
    confidence: 0.92,
    receivedAt: '2026-10-03T08:00:00.000Z',
    ...over,
  });

  test('upsert stores findings and replaces by id; nothing is dirty, nothing announced, nothing to sync', async () => {
    expect(await db.upsertEmailFindings([finding('f1'), finding('f2', { receivedAt: '2026-10-04T08:00:00.000Z' })])).toBe(2);
    expect(
      await db.upsertEmailFindings([
        finding('f1', { amount: 17.99, previousAmount: 15.49, kind: 'price_change', currency: null }),
        finding('f3', { receivedAt: '2026-10-05T08:00:00.000Z', kind: 'trial_ending', trialEndsISO: '2026-10-20' }),
      ]),
    ).toBe(1);
    const all = await db.getEmailFindings();
    expect(all.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(all[0]).toEqual(finding('f1', { amount: 17.99, previousAmount: 15.49, kind: 'price_change', currency: null }));
    expect(all[2]).toMatchObject({ kind: 'trial_ending', trialEndsISO: '2026-10-20' });
    expect(mutations).toBe(0);
    expect((await db.countUnsyncedChanges()).total).toBe(0);
    expect(await tombstones()).toEqual([]);
  });

  test('a malformed finding is skipped or reduced to its unknowns, never stored as garbage', async () => {
    const junk = {
      ...finding('f9'),
      kind: 'spam',
      cadence: 'fortnightly',
      source: 'pigeon',
      billedVia: 'venmo',
      amount: Number.NaN,
      confidence: 'high',
    } as unknown as LocalEmailFinding;
    const missing = [{ ...finding(''), id: '' }, { ...finding('f8'), receivedAt: '' }];
    expect(await db.upsertEmailFindings([junk, ...missing])).toBe(1);
    expect(await db.getEmailFindings()).toEqual([
      finding('f9', { kind: 'other', cadence: 'unknown', source: 'forwarding', billedVia: null, amount: null, confidence: 0 }),
    ]);
  });

  test('a page of a thousand counts what is new once, an id sent twice included', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => finding(`f${String(i).padStart(4, '0')}`));
    expect(await db.upsertEmailFindings(page)).toBe(1000);
    expect(await db.upsertEmailFindings([...page.slice(0, 500), finding('new'), finding('new', { amount: 1 })])).toBe(1);
    expect((await db.getEmailFindings()).length).toBe(1001);
    expect((await db.getEmailFindings()).find((f) => f.id === 'new')?.amount).toBe(1);
    expect(await db.deleteEmailFindings(page.map((f) => f.id))).toBe(1000);
  });

  test('delete by ids, nothing for an empty list, and everything when no list is given', async () => {
    await db.upsertEmailFindings([finding('f1'), finding('f2'), finding('f3')]);
    expect(await db.deleteEmailFindings(['f2', 'nope'])).toBe(1);
    expect((await db.getEmailFindings()).map((f) => f.id)).toEqual(['f1', 'f3']);
    expect(await db.deleteEmailFindings([])).toBe(0);
    expect((await db.getEmailFindings()).length).toBe(2);
    expect(await db.deleteEmailFindings()).toBe(2);
    expect(await db.getEmailFindings()).toEqual([]);
  });

  test('the table is not a synced entity: absent from the sync lists, without sync columns', async () => {
    expect(SYNC_ENTITIES as readonly string[]).not.toContain('emailFindings');
    expect(Object.values(LOCAL_SYNC_TABLES).map((t) => t.table)).not.toContain('email_findings');
    const columns = (await handle.getAllAsync<{ name: string }>(`PRAGMA table_info(email_findings)`)).map((c) => c.name);
    expect(columns).toContain('receivedAt');
    for (const sync of ['dirty', 'clientUpdatedAt', 'syncError']) expect(columns).not.toContain(sync);
  });
});

describe('local schema version 2', () => {
  /** A file as the Phase 5 build left it: version 1, without the Phase 6 columns or the cache. */
  async function phase5File(owner: string): Promise<InstanceType<typeof Database>> {
    const file = new Database(':memory:');
    file.exec(LOCAL_SCHEMA_SQL);
    for (const column of ['decision', 'canceledAt', 'trialEndsAt', 'previousAmount', 'priceChangedAt', 'alert', 'sources', 'billedVia']) {
      file.exec(`ALTER TABLE subscriptions DROP COLUMN ${column}`);
    }
    file.exec(`DROP TABLE email_findings`);
    file.query(`INSERT INTO local_meta (key, value) VALUES ('owner', ?)`).run(owner);
    file.query(`INSERT INTO migrations (key, appliedAt) VALUES ('schema_v1', '2026-09-01T00:00:00.000Z')`).run();
    file.query(`INSERT INTO settings (id, monthlyBudget, clientUpdatedAt, dirty) VALUES (1, 900, '2026-09-02T00:00:00.000Z', 0)`).run();
    // The user deleted the default account long ago; the deletion was sent.
    const sub = file.query(
      `INSERT INTO subscriptions (id, merchantDisplay, merchantNormalized, status, source, createdAt, clientUpdatedAt, dirty)
       VALUES (?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-03T00:00:00.000Z', ?)`,
    );
    sub.run('sub_kept', 'Netflix', 'netflix', 'confirmed', 'transaction', 0);
    sub.run('sub_gone', 'Gym', 'gym', 'canceled', 'email', 1);
    sub.run('sub_maybe', 'News', 'news', 'possible', 'transaction', 0);
    file.query(`INSERT INTO sync_meta (key, value) VALUES ('pull_cursor', 'c42'), ('pull_entities', ?)`).run(SYNC_ENTITIES.join(','));
    return file;
  }

  test('a file the Phase 5 build made is brought to version 2 as it opens: columns, decisions, the cache, one full pull, no second seed', async () => {
    const owner = `${userId}_v1`;
    mem.files.set(`budget_${owner}.db`, await phase5File(owner));
    await db.openUserDatabase(owner);
    const file = await db.getDatabase();

    const markers = await file.getAllAsync<{ key: string }>(`SELECT key FROM migrations ORDER BY key`);
    expect(markers.map((m) => m.key)).toEqual(['schema_v1', LOCAL_SCHEMA_KEY]);
    expect(LOCAL_SCHEMA_KEY).toBe('schema_v2');
    // Not seeded again: the deleted default account stays deleted, the settings stay the user's.
    expect(await db.getAccountById(defaultAccountId(owner))).toBeNull();
    expect((await db.getSettings()).monthlyBudget).toBe(900);

    expect((await db.getSubscriptions()).map((s) => [s.id, s.decision, s.status, s.sources])).toEqual([
      ['sub_gone', 'cancel', 'canceled', 'email'],
      ['sub_kept', 'keep', 'confirmed', 'transaction'],
      ['sub_maybe', null, 'possible', 'transaction'],
    ]);
    // Read as the server's migration reads them: nothing stamped, nothing newly dirty.
    const states = await file.getAllAsync<{ id: string; dirty: number; clientUpdatedAt: string }>(
      `SELECT id, dirty, clientUpdatedAt FROM subscriptions ORDER BY id`,
    );
    expect(states).toEqual([
      { id: 'sub_gone', dirty: 1, clientUpdatedAt: '2026-09-03T00:00:00.000Z' },
      { id: 'sub_kept', dirty: 0, clientUpdatedAt: '2026-09-03T00:00:00.000Z' },
      { id: 'sub_maybe', dirty: 0, clientUpdatedAt: '2026-09-03T00:00:00.000Z' },
    ]);
    // The cursor the old build stored no longer counts: the next pull is full.
    expect(await file.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'pull_entities'`)).toBeNull();
    const store = createSqliteSyncStore({ run: (fn) => db.withWriteLock((sql) => fn(sql)) });
    expect(await store.getPullState()).toEqual({ cursor: null, resyncActive: false });

    // The cache exists, and an engine write works on the upgraded table.
    expect(await db.upsertEmailFindings([{ ...finding, id: 'f1' }])).toBe(1);
    await db.setSubscriptionDecision('sub_maybe', 'dismiss');
    expect(await db.getSubscriptionById('sub_maybe')).toMatchObject({ decision: 'dismiss', status: 'dismissed' });

    // Opening it again is a no-op.
    await db.closeUserDatabase();
    await db.openUserDatabase(owner);
    expect(await db.getSubscriptionById('sub_maybe')).toMatchObject({ decision: 'dismiss' });
    expect((await (await db.getDatabase()).getAllAsync(`SELECT key FROM migrations`)).length).toBe(2);
  });

  test('a new file is created at version 2 directly, and the upgrade leaves it alone', async () => {
    const markers = await handle.getAllAsync<{ key: string }>(`SELECT key FROM migrations`);
    expect(markers).toEqual([{ key: 'schema_v2' }]);
    expect(await upgradeLocalSchema(handle, new Date().toISOString())).toBe('none');
  });

  test('a file whose creation never finished only gains its columns; the initializer seeds it as new', async () => {
    const owner = `${userId}_half`;
    const half = await phase5File(owner);
    half.exec(`DELETE FROM migrations; DELETE FROM local_meta; DELETE FROM subscriptions; DELETE FROM sync_meta`);
    mem.files.set(`budget_${owner}.db`, half);
    await db.openUserDatabase(owner);
    expect((await (await db.getDatabase()).getAllAsync<{ key: string }>(`SELECT key FROM migrations`)).map((m) => m.key)).toEqual([
      'schema_v2',
    ]);
    expect(await db.getAccountById(defaultAccountId(owner))).not.toBeNull();
    await db.upsertSubscription({ ...emptySub, id: 'sub_new', alert: 'price_rise' });
    expect(await db.getSubscriptionById('sub_new')).toMatchObject({ alert: 'price_rise', sources: '' });
  });

  const finding: LocalEmailFinding = {
    id: 'f0',
    connectionId: null,
    source: 'forwarding',
    kind: 'receipt',
    merchant: null,
    senderDomain: null,
    billedVia: null,
    amount: null,
    currency: null,
    cadence: 'unknown',
    chargedISO: null,
    emailDateISO: null,
    nextChargeISO: null,
    trialEndsISO: null,
    previousAmount: null,
    confidence: 0,
    receivedAt: '2026-10-01T00:00:00.000Z',
  };
  const emptySub = {
    id: 'sub_x',
    merchantDisplay: 'X',
    merchantNormalized: 'x',
    cadence: 'monthly' as const,
    typicalAmount: 1,
    currency: 'USD',
    confidenceScore: 0.5,
    lastChargedAt: null,
    nextExpectedAt: null,
    status: 'possible' as const,
    cancelUrl: null,
    cancelNotes: null,
    source: 'manual' as const,
  };
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
