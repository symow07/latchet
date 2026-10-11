import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EPOCH_ISO, LOCAL_SYNC_TABLES, SYNC_ENTITIES, defaultAccountId } from '../local-schema';
import { SYNC_FIELDS, entityFields, type PullResponse, type WireRow } from './protocol';
import { SYNC_COLUMNS, SYNC_ENTITY_SIGNATURE, SYNC_META, createSqliteSyncStore } from './sqlite-store';
import { openTestUserDatabase, type TestUserDatabase } from './test-sqlite';
import type { PendingChange, PushOutcome, SyncStore } from './engine';

/**
 * The store's real SQL, on bun:sqlite, against the real local schema
 * (LOCAL_SCHEMA_SQL, seeded as a new phone seeds itself).
 */

const USER = 'user_store';
let t: TestUserDatabase;
let store: SyncStore;

beforeEach(() => {
  t = openTestUserDatabase(USER, '2026-10-01T00:00:00.000Z');
  store = createSqliteSyncStore(t.access);
});

afterEach(() => t.close());

const at = (n: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, n)).toISOString();

/** A write as db.ts makes it: stamped now, dirty. */
function addTx(id: string, over: Record<string, unknown> = {}): void {
  const row = {
    id,
    amount: 10,
    category: 'Food',
    type: 'Expense',
    isImpulse: 0,
    note: null,
    dateISO: '2026-10-11',
    createdAt: at(0),
    accountId: defaultAccountId(USER),
    currency: 'USD',
    clientUpdatedAt: at(1),
    dirty: 1,
    ...over,
  };
  const cols = Object.keys(row);
  t.db.raw.query(`INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
    ...(Object.values(row) as (string | number | null)[]),
  );
}

function rowOf(table: string, where: string, ...params: (string | number)[]): Record<string, unknown> | null {
  return (t.db.raw.query(`SELECT * FROM ${table} WHERE ${where}`).get(...params) as Record<string, unknown> | null) ?? null;
}

function page(over: Partial<PullResponse> = {}): PullResponse {
  return { changes: {}, deletions: [], cursor: 'c1', hasMore: false, fullResync: false, serverTime: at(30), ...over };
}

function serverTx(id: string, over: Partial<WireRow> = {}): WireRow {
  return {
    id,
    clientUpdatedAt: at(10),
    amount: 25,
    category: 'Transport',
    type: 'Expense',
    isImpulse: true,
    note: 'bus',
    dateISO: '2026-10-10',
    accountId: null,
    currency: 'EUR',
    createdAt: at(9),
    ...over,
  };
}

async function allPending(entity: (typeof SYNC_ENTITIES)[number]): Promise<PendingChange[]> {
  return store.readPending(entity, null, 1000);
}

const applied = (changes: PendingChange[]): PushOutcome[] => changes.map((change) => ({ change, status: 'applied' }));

describe('the field map', () => {
  test('every synced field has a local column, and nothing else is mapped', () => {
    for (const entity of SYNC_ENTITIES) {
      expect(Object.keys(SYNC_COLUMNS[entity]).sort()).toEqual([...entityFields(entity)].sort());
      const { table } = LOCAL_SYNC_TABLES[entity];
      const columns = (t.db.raw.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      for (const field of entityFields(entity)) expect(columns).toContain(field);
      expect(SYNC_FIELDS[entity]).toContain('id');
      expect(SYNC_FIELDS[entity]).toContain('clientUpdatedAt');
    }
    // Derived on both sides (decision 4): never sent.
    expect(SYNC_FIELDS.accounts).not.toContain('balance');
  });
});

describe('reading what to push', () => {
  test('a fresh database offers its epoch-dated seeds, in wire shape', async () => {
    const [settings] = await allPending('settings');
    expect(settings!.row).toMatchObject({ id: 'settings', clientUpdatedAt: EPOCH_ISO, showTimeCost: false, locale: 'en' });
    expect(settings!.row).not.toHaveProperty('dirty');

    const [account] = await allPending('accounts');
    expect(account!.row).toMatchObject({ id: defaultAccountId(USER), isDefault: true, openingBalance: 0, name: 'Cash' });
    expect(account!.row).not.toHaveProperty('balance');
  });

  test('only dirty rows the server has not refused are offered; booleans leave as booleans', async () => {
    addTx('tx_a', { isImpulse: 1 });
    addTx('tx_clean', { dirty: 0 });
    addTx('tx_refused', { syncError: 'invalid' });
    const pending = await allPending('transactions');
    expect(pending.map((p) => p.id)).toEqual(['tx_a']);
    expect(pending[0]!.row.isImpulse).toBe(true);
    expect(pending[0]!.row.note).toBeNull();
  });

  test('pages by keyset: rows, then deletions of rows that are gone', async () => {
    addTx('tx_1');
    addTx('tx_2');
    addTx('tx_3');
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', 'tx_gone', ?)`).run(at(5));
    // A tombstone whose row exists again locally is obsolete and not sent.
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', 'tx_2', ?)`).run(at(0));

    const first = await store.readPending('transactions', null, 2);
    expect(first.map((p) => p.id)).toEqual(['tx_1', 'tx_2']);
    const second = await store.readPending('transactions', first[1]!.cursor, 2);
    expect(second.map((p) => [p.id, p.deleted])).toEqual([
      ['tx_3', false],
      ['tx_gone', true],
    ]);
    expect(second[1]!.row).toEqual({ id: 'tx_gone', clientUpdatedAt: at(5), deleted: true });
    expect(await store.readPending('transactions', second[1]!.cursor, 2)).toEqual([]);
  });

  test('a custom category travels under its name', async () => {
    t.db.raw
      .query(`INSERT INTO custom_categories (name, icon, color, createdAt, clientUpdatedAt, dirty) VALUES ('Pets', 'paw', '#123456', ?, ?, 1)`)
      .run(at(0), at(1));
    const [cat] = await allPending('categories');
    expect(cat!.row).toEqual({ id: 'Pets', clientUpdatedAt: at(1), icon: 'paw', color: '#123456', createdAt: at(0) });
  });
});

describe('settling a push', () => {
  test('applied marks clean, but only what has not changed since it was read', async () => {
    addTx('tx_a');
    addTx('tx_b');
    const pending = await allPending('transactions');
    // The user edits tx_b while the request is in flight (as db.ts does).
    t.db.raw.query(`UPDATE transactions SET amount = 99, clientUpdatedAt = ?, dirty = 1 WHERE id = 'tx_b'`).run(at(20));

    const counts = await store.settlePush(applied(pending));
    expect(counts).toEqual({ settled: 1, changedSinceRead: 1, rejected: 0 });
    expect(rowOf('transactions', `id = 'tx_a'`)!.dirty).toBe(0);
    expect(rowOf('transactions', `id = 'tx_b'`)).toMatchObject({ dirty: 1, amount: 99 });
  });

  test('an edit with the same timestamp still counts as a change', async () => {
    addTx('tx_a');
    const pending = await allPending('transactions');
    t.db.raw.query(`UPDATE transactions SET note = 'edited' WHERE id = 'tx_a'`).run();
    await store.settlePush(applied(pending));
    expect(rowOf('transactions', `id = 'tx_a'`)!.dirty).toBe(1);
  });

  test('invalid and forbidden are recorded on the row, which stays dirty and is not offered again', async () => {
    addTx('tx_bad');
    addTx('tx_theirs');
    const pending = await allPending('transactions');
    const counts = await store.settlePush([
      { change: pending[0]!, status: 'invalid' },
      { change: pending[1]!, status: 'forbidden' },
    ]);
    expect(counts.rejected).toBe(2);
    expect(rowOf('transactions', `id = 'tx_bad'`)).toMatchObject({ dirty: 1, syncError: 'invalid' });
    expect(rowOf('transactions', `id = 'tx_theirs'`)).toMatchObject({ dirty: 1, syncError: 'forbidden' });
    expect(await allPending('transactions')).toEqual([]);

    // Editing the row (db.ts clears syncError) makes it eligible again.
    t.db.raw.query(`UPDATE transactions SET amount = 5, clientUpdatedAt = ?, syncError = NULL WHERE id = 'tx_bad'`).run(at(40));
    expect((await allPending('transactions')).map((p) => p.id)).toEqual(['tx_bad']);
  });

  test('a settled deletion drops its tombstone unless it was deleted again since', async () => {
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', 'tx_1', ?)`).run(at(1));
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', 'tx_2', ?)`).run(at(1));
    const pending = await allPending('transactions');
    t.db.raw.query(`UPDATE sync_tombstones SET clientUpdatedAt = ? WHERE id = 'tx_2'`).run(at(9));
    await store.settlePush(applied(pending));
    const left = t.db.raw.query(`SELECT id FROM sync_tombstones`).all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual(['tx_2']);
  });

  test('unanswered changes are left exactly as they were', async () => {
    addTx('tx_a');
    const pending = await allPending('transactions');
    await store.settlePush([{ change: pending[0]!, status: 'unanswered' }]);
    expect(rowOf('transactions', `id = 'tx_a'`)).toMatchObject({ dirty: 1, syncError: null });
  });
});

describe('applying a pull page', () => {
  test('server rows land clean, unstamped, booleans as 0/1, and the cursor is stored with them', async () => {
    const counts = await store.applyPullPage(page({ changes: { transactions: [serverTx('tx_s')] }, cursor: 'cur-7' }), {
      wipe: false,
      resyncActive: false,
    });
    expect(counts).toEqual({ changed: 1, skipped: 0, errors: [] });
    expect(rowOf('transactions', `id = 'tx_s'`)).toMatchObject({
      dirty: 0,
      syncError: null,
      isImpulse: 1,
      clientUpdatedAt: at(10),
      currency: 'EUR',
      note: 'bus',
    });
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM sync_tombstones`).get()).toEqual({ n: 0 });
    expect(await store.getPullState()).toEqual({ cursor: 'cur-7', resyncActive: false });
  });

  test('the settings row maps to row 1 and an account starts at its opening balance', async () => {
    await store.applyPullPage(
      page({
        changes: {
          settings: [{ id: 'settings', clientUpdatedAt: at(3), monthlyBudget: 1500, showTimeCost: true, locale: 'fr', currency: 'EUR', currencySymbol: '€' }],
          accounts: [{ id: 'acc_s', clientUpdatedAt: at(3), name: 'Bank', type: 'checking', openingBalance: 250, currency: 'EUR', color: '#000', icon: 'bank', isDefault: false, createdAt: at(2) }],
        },
      }),
      { wipe: false, resyncActive: false },
    );
    expect(rowOf('settings', 'id = 1')).toMatchObject({ monthlyBudget: 1500, showTimeCost: 1, locale: 'fr', dirty: 0, clientUpdatedAt: at(3) });
    expect(rowOf('accounts', `id = 'acc_s'`)).toMatchObject({ balance: 250, openingBalance: 250, isDefault: 0, dirty: 0 });
  });

  test('a local edit newer than the server row is kept; ties and older edits go to the server', async () => {
    addTx('tx_newer', { clientUpdatedAt: at(50), amount: 1 });
    addTx('tx_tie', { clientUpdatedAt: at(10), amount: 2 });
    addTx('tx_older', { clientUpdatedAt: at(5), amount: 3 });
    const counts = await store.applyPullPage(
      page({ changes: { transactions: [serverTx('tx_newer'), serverTx('tx_tie'), serverTx('tx_older')] } }),
      { wipe: false, resyncActive: false },
    );
    expect(counts.skipped).toBe(1);
    expect(rowOf('transactions', `id = 'tx_newer'`)).toMatchObject({ amount: 1, dirty: 1 });
    expect(rowOf('transactions', `id = 'tx_tie'`)).toMatchObject({ amount: 25, dirty: 0 });
    expect(rowOf('transactions', `id = 'tx_older'`)).toMatchObject({ amount: 25, dirty: 0 });
  });

  test('a local deletion newer than the server row wins; an older one is undone', async () => {
    const tomb = t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', ?, ?)`);
    tomb.run('tx_del_new', at(50));
    tomb.run('tx_del_old', at(1));
    await store.applyPullPage(page({ changes: { transactions: [serverTx('tx_del_new'), serverTx('tx_del_old')] } }), {
      wipe: false,
      resyncActive: false,
    });
    expect(rowOf('transactions', `id = 'tx_del_new'`)).toBeNull();
    expect(rowOf('transactions', `id = 'tx_del_old'`)).not.toBeNull();
    const left = t.db.raw.query(`SELECT id FROM sync_tombstones`).all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual(['tx_del_new']);
  });

  test('a row re-sent unchanged (an account whose balance moved) changes nothing', async () => {
    const account: WireRow = { id: 'acc_s', clientUpdatedAt: at(3), name: 'Bank', type: 'checking', openingBalance: 0, currency: 'USD', color: '#000', icon: 'bank', isDefault: false, createdAt: at(2) };
    await store.applyPullPage(page({ changes: { accounts: [account] } }), { wipe: false, resyncActive: false });
    const again = await store.applyPullPage(page({ changes: { accounts: [{ ...account, balance: 999 }] } }), { wipe: false, resyncActive: false });
    expect(again.changed).toBe(0);
  });

  test('a malformed row is skipped and reported; the rest of the page and its cursor still commit', async () => {
    const counts = await store.applyPullPage(
      page({ changes: { transactions: [serverTx('tx_ok'), { id: 'tx_bad', clientUpdatedAt: at(4), category: 'Food' }] }, cursor: 'cur-9' }),
      { wipe: false, resyncActive: false },
    );
    expect(counts.changed).toBe(1);
    expect(counts.errors.length).toBe(1);
    expect(rowOf('transactions', `id = 'tx_bad'`)).toBeNull();
    expect((await store.getPullState()).cursor).toBe('cur-9');
  });

  test('deleting an account detaches its transactions; deleting a subscription drops its occurrences', async () => {
    addTx('tx_on_cash', { dirty: 0 });
    t.db.raw
      .query(`INSERT INTO subscriptions (id, merchantDisplay, merchantNormalized, createdAt, clientUpdatedAt) VALUES ('sub_1', 'Netflix', 'netflix', ?, ?)`)
      .run(at(0), at(0));
    t.db.raw.query(`INSERT INTO subscription_occurrences (id, subscriptionId, chargedAt, amount) VALUES ('occ_1', 'sub_1', ?, 9)`).run(at(0));

    await store.applyPullPage(
      page({
        deletions: [
          { entity: 'accounts', id: defaultAccountId(USER), clientUpdatedAt: at(20) },
          { entity: 'subscriptions', id: 'sub_1', clientUpdatedAt: at(20) },
        ],
      }),
      { wipe: false, resyncActive: false },
    );
    expect(rowOf('accounts', 'id = ?', defaultAccountId(USER))).toBeNull();
    expect(rowOf('transactions', `id = 'tx_on_cash'`)).toMatchObject({ accountId: null, dirty: 0 });
    expect(rowOf('subscriptions', `id = 'sub_1'`)).toBeNull();
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM subscription_occurrences`).get()).toEqual({ n: 0 });
    // A deletion the server sends never becomes a deletion to send back.
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM sync_tombstones`).get()).toEqual({ n: 0 });
  });

  test('a server deletion does not remove a row edited here after it', async () => {
    addTx('tx_edited', { clientUpdatedAt: at(30) });
    const counts = await store.applyPullPage(
      page({ deletions: [{ entity: 'transactions', id: 'tx_edited', clientUpdatedAt: at(20) }] }),
      { wipe: false, resyncActive: false },
    );
    expect(counts.skipped).toBe(1);
    expect(rowOf('transactions', `id = 'tx_edited'`)).not.toBeNull();
  });

  test('the first snapshot page wipes clean synced rows, keeping dirty rows, settings and pending deletions', async () => {
    addTx('tx_clean', { dirty: 0 });
    addTx('tx_dirty');
    t.db.raw.query(`UPDATE settings SET dirty = 0, clientUpdatedAt = ? WHERE id = 1`).run(at(1));
    t.db.raw.query(`UPDATE accounts SET dirty = 0 WHERE id = ?`).run(defaultAccountId(USER));
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', 'tx_x', ?)`).run(at(1));

    await store.applyPullPage(page({ changes: { transactions: [serverTx('tx_snap')] }, fullResync: true, hasMore: true }), {
      wipe: true,
      resyncActive: true,
    });
    const ids = (t.db.raw.query(`SELECT id FROM transactions ORDER BY id`).all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['tx_dirty', 'tx_snap']);
    expect(rowOf('accounts', 'id = ?', defaultAccountId(USER))).toBeNull();
    expect(rowOf('settings', 'id = 1')).not.toBeNull();
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM sync_tombstones`).get()).toEqual({ n: 1 });
    expect(await store.getPullState()).toEqual({ cursor: 'c1', resyncActive: true });
  });

  test('charge history outlives a snapshot page and goes only with a subscription the snapshot did not restate', async () => {
    const sub = t.db.raw.query(
      `INSERT INTO subscriptions (id, merchantDisplay, merchantNormalized, createdAt, clientUpdatedAt, dirty) VALUES (?, ?, ?, ?, ?, 0)`,
    );
    sub.run('sub_kept', 'Gym', 'gym', at(0), at(0));
    sub.run('sub_gone', 'Old', 'old', at(0), at(0));
    const occ = t.db.raw.query(`INSERT INTO subscription_occurrences (id, subscriptionId, chargedAt, amount) VALUES (?, ?, ?, 9)`);
    occ.run('occ_kept', 'sub_kept', at(0));
    occ.run('occ_gone', 'sub_gone', at(0));
    const restated: WireRow = {
      id: 'sub_kept', clientUpdatedAt: at(0), merchantDisplay: 'Gym', merchantNormalized: 'gym', cadence: 'monthly', typicalAmount: 0,
      currency: 'USD', confidenceScore: 0, lastChargedAt: null, nextExpectedAt: null, status: 'possible', cancelUrl: null,
      cancelNotes: null, source: 'transaction', createdAt: at(0),
    };

    await store.applyPullPage(page({ fullResync: true, hasMore: true }), { wipe: true, resyncActive: true });
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM subscription_occurrences`).get()).toEqual({ n: 2 });

    await store.applyPullPage(page({ changes: { subscriptions: [restated] }, fullResync: true, hasMore: false }), {
      wipe: false,
      resyncActive: false,
    });
    const left = t.db.raw.query(`SELECT id FROM subscription_occurrences`).all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual(['occ_kept']);
  });

  test('resetting the pull state forgets the cursor and the snapshot in progress', async () => {
    await store.applyPullPage(page({ cursor: 'cur-1', fullResync: true, hasMore: true }), { wipe: true, resyncActive: true });
    await store.resetPullState();
    expect(await store.getPullState()).toEqual({ cursor: null, resyncActive: false });
    expect(t.db.raw.query(`SELECT value FROM sync_meta WHERE key = ?`).get(SYNC_META.cursor)).toBeNull();
  });
});

test('balances are recomputed from the opening balance and the ledger', async () => {
  t.db.raw.query(`UPDATE accounts SET openingBalance = 100, balance = 0 WHERE id = ?`).run(defaultAccountId(USER));
  addTx('tx_e', { amount: 30, type: 'Expense' });
  addTx('tx_i', { amount: 50, type: 'Income' });
  await store.recomputeBalances();
  expect(rowOf('accounts', 'id = ?', defaultAccountId(USER))!.balance).toBe(120);
});

// ── Phase 4: recurring series, bills, budgets and net worth (I-WIRE-4) ───────

function insertRow(table: string, row: Record<string, string | number | null>): void {
  const cols = Object.keys(row);
  t.db.raw.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row));
}

const serverSeries = (id: string, over: Partial<WireRow> = {}): WireRow => ({
  id,
  clientUpdatedAt: at(10),
  accountId: null,
  name: 'Gym',
  amount: 35.5,
  category: 'Gym',
  type: 'Expense',
  isImpulse: true,
  frequency: 'weekly',
  startDate: '2026-10-01',
  nextDate: '2026-10-15',
  lastCreated: '2026-10-08',
  isActive: false,
  currency: 'EUR',
  createdAt: at(9),
  ...over,
});

describe('the Phase 4 entities', () => {
  test('pulled rows land clean: booleans as 0/1, paidAt as given, the breakdown as JSON text, a budget under its category', async () => {
    const counts = await store.applyPullPage(
      page({
        changes: {
          recurring: [serverSeries('rec_1')],
          billReminders: [
            { id: 'bill_1', clientUpdatedAt: at(10), name: 'Water', amount: 20, dueDay: 12, category: 'Other', isRecurring: false, isPaid: true, paidAt: at(8), nextDueDate: '2026-10-12', createdAt: at(7) },
          ],
          categoryBudgets: [{ id: 'Food', clientUpdatedAt: at(10), amount: 300, period: 'monthly', createdAt: at(6) }],
          netWorth: [
            { id: 'nw_text', clientUpdatedAt: at(10), date: '2026-10-11', assets: 10, liabilities: 2, netWorth: 8, breakdown: '{"cashSavings":10,"loans":2}', createdAt: at(5) },
            // An object where text belongs is kept as its JSON text, not "[object Object]".
            { id: 'nw_object', clientUpdatedAt: at(10), date: '2026-10-10', assets: 4, liabilities: 0, netWorth: 4, breakdown: { investments: 4 }, createdAt: at(5) },
            { id: 'nw_none', clientUpdatedAt: at(10), date: '2026-10-09', assets: 1, liabilities: 0, netWorth: 1, breakdown: null, createdAt: at(5) },
          ],
        },
      }),
      { wipe: false, resyncActive: false },
    );
    expect(counts).toEqual({ changed: 6, skipped: 0, errors: [] });
    expect(rowOf('recurring_transactions', `id = 'rec_1'`)).toMatchObject({
      accountId: null, isImpulse: 1, isActive: 0, lastCreated: '2026-10-08', nextDate: '2026-10-15', dirty: 0, clientUpdatedAt: at(10),
    });
    expect(rowOf('bill_reminders', `id = 'bill_1'`)).toMatchObject({ isRecurring: 0, isPaid: 1, paidAt: at(8), dueDay: 12, dirty: 0 });
    expect(rowOf('category_budgets', `category = 'Food'`)).toMatchObject({ amount: 300, period: 'monthly', dirty: 0 });
    expect(rowOf('net_worth_entries', `id = 'nw_text'`)).toMatchObject({ breakdown: '{"cashSavings":10,"loans":2}', netWorth: 8 });
    expect(rowOf('net_worth_entries', `id = 'nw_object'`)!.breakdown).toBe('{"investments":4}');
    expect(rowOf('net_worth_entries', `id = 'nw_none'`)!.breakdown).toBeNull();

    // Sent again unchanged (a page re-read inside the pull's safety lag): nothing changes.
    const again = await store.applyPullPage(
      page({ changes: { recurring: [serverSeries('rec_1')], netWorth: [{ id: 'nw_text', clientUpdatedAt: at(10), date: '2026-10-11', assets: 10, liabilities: 2, netWorth: 8, breakdown: '{"cashSavings":10,"loans":2}', createdAt: at(5) }] } }),
      { wipe: false, resyncActive: false },
    );
    expect(again.changed).toBe(0);
  });

  test('they are pushed in wire shape: booleans, the breakdown text, a budget under its category', async () => {
    insertRow('recurring_transactions', {
      id: 'rec_mine', accountId: defaultAccountId(USER), name: 'Rent', amount: 700, category: 'Other', type: 'Expense', isImpulse: 0,
      frequency: 'monthly', startDate: '2026-10-11', nextDate: '2026-10-11', lastCreated: null, isActive: 1, currency: 'USD',
      createdAt: at(0), clientUpdatedAt: at(1), dirty: 1,
    });
    insertRow('bill_reminders', {
      id: 'bill_mine', name: 'Water', amount: 20, dueDay: 31, category: 'Other', isRecurring: 1, isPaid: 1, paidAt: at(1),
      nextDueDate: '2026-11-30', createdAt: at(0), clientUpdatedAt: at(1), dirty: 1,
    });
    insertRow('category_budgets', { category: 'Food', amount: 300, period: 'monthly', createdAt: at(0), clientUpdatedAt: at(1), dirty: 1 });
    insertRow('net_worth_entries', {
      id: 'nw_mine', date: '2026-10-11', assets: 10, liabilities: 2, netWorth: 8, breakdown: '{"cashSavings":10,"loans":2}',
      createdAt: at(0), clientUpdatedAt: at(1), dirty: 1,
    });

    expect((await allPending('recurring'))[0]!.row).toEqual({
      id: 'rec_mine', clientUpdatedAt: at(1), accountId: defaultAccountId(USER), name: 'Rent', amount: 700, category: 'Other',
      type: 'Expense', isImpulse: false, frequency: 'monthly', startDate: '2026-10-11', nextDate: '2026-10-11', lastCreated: null,
      isActive: true, currency: 'USD', createdAt: at(0),
    });
    expect((await allPending('billReminders'))[0]!.row).toEqual({
      id: 'bill_mine', clientUpdatedAt: at(1), name: 'Water', amount: 20, dueDay: 31, category: 'Other', isRecurring: true,
      isPaid: true, paidAt: at(1), nextDueDate: '2026-11-30', createdAt: at(0),
    });
    expect((await allPending('categoryBudgets'))[0]!.row).toEqual({ id: 'Food', clientUpdatedAt: at(1), amount: 300, period: 'monthly', createdAt: at(0) });
    expect((await allPending('netWorth'))[0]!.row).toEqual({
      id: 'nw_mine', clientUpdatedAt: at(1), date: '2026-10-11', assets: 10, liabilities: 2, netWorth: 8,
      breakdown: '{"cashSavings":10,"loans":2}', createdAt: at(0),
    });

    // A deleted budget goes as a deletion under its category.
    t.db.raw.query(`DELETE FROM category_budgets`).run();
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('categoryBudgets', 'Food', ?)`).run(at(2));
    expect((await allPending('categoryBudgets'))[0]!.row).toEqual({ id: 'Food', clientUpdatedAt: at(2), deleted: true });
  });

  test('a server-deleted account unlinks the recurring series that named it, as its foreign key did on the server', async () => {
    insertRow('recurring_transactions', {
      id: 'rec_on_cash', accountId: defaultAccountId(USER), name: 'Rent', amount: 700, category: 'Other', type: 'Expense',
      frequency: 'monthly', startDate: '2026-10-11', nextDate: '2026-10-11', createdAt: at(0), clientUpdatedAt: at(1), dirty: 0,
    });
    await store.applyPullPage(page({ deletions: [{ entity: 'accounts', id: defaultAccountId(USER), clientUpdatedAt: at(20) }] }), {
      wipe: false,
      resyncActive: false,
    });
    expect(rowOf('recurring_transactions', `id = 'rec_on_cash'`)).toMatchObject({ accountId: null, dirty: 0, clientUpdatedAt: at(1) });
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM sync_tombstones`).get()).toEqual({ n: 0 });
  });

  test('a snapshot wipes their clean rows too, keeping unsent ones', async () => {
    insertRow('category_budgets', { category: 'Food', amount: 300, period: 'monthly', createdAt: at(0), clientUpdatedAt: at(1), dirty: 0 });
    insertRow('category_budgets', { category: 'Pets', amount: 40, period: 'monthly', createdAt: at(0), clientUpdatedAt: at(1), dirty: 1 });
    await store.applyPullPage(page({ fullResync: true }), { wipe: true, resyncActive: false });
    const left = t.db.raw.query(`SELECT category FROM category_budgets`).all() as { category: string }[];
    expect(left.map((r) => r.category)).toEqual(['Pets']);
  });
});

describe('a phone upgraded from a build that synced fewer entities', () => {
  test("a cursor stored without this build's entity signature is not used, and the next page stores the signature", async () => {
    // What a five-entity build leaves behind: a cursor past rows it skipped, and no signature.
    t.db.raw.query(`INSERT INTO sync_meta (key, value) VALUES (?, 'old-cursor'), (?, '1')`).run(SYNC_META.cursor, SYNC_META.resyncActive);
    expect(await store.getPullState()).toEqual({ cursor: null, resyncActive: false });

    await store.applyPullPage(page({ cursor: 'snap-1', fullResync: true, hasMore: true }), { wipe: true, resyncActive: true });
    expect(t.db.raw.query(`SELECT value FROM sync_meta WHERE key = ?`).get(SYNC_META.entities)).toEqual({ value: SYNC_ENTITY_SIGNATURE });
    // From here the snapshot continues where it is, rather than starting over.
    expect(await store.getPullState()).toEqual({ cursor: 'snap-1', resyncActive: true });
    expect(SYNC_ENTITY_SIGNATURE).toBe(SYNC_ENTITIES.join(','));
    expect(SYNC_ENTITY_SIGNATURE).toContain('netWorth');
  });

  test('a signature from a different entity set counts as none', async () => {
    t.db.raw
      .query(`INSERT INTO sync_meta (key, value) VALUES (?, 'c9'), (?, ?)`)
      .run(SYNC_META.cursor, SYNC_META.entities, 'settings,categories,accounts,transactions,subscriptions');
    expect(await store.getPullState()).toEqual({ cursor: null, resyncActive: false });
    t.db.raw.query(`UPDATE sync_meta SET value = ? WHERE key = ?`).run(SYNC_ENTITY_SIGNATURE, SYNC_META.entities);
    expect(await store.getPullState()).toEqual({ cursor: 'c9', resyncActive: false });
  });
});
