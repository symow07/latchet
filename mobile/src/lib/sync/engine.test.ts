import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EPOCH_ISO, defaultAccountId } from '../local-schema';
import { createSyncEngine, type SyncEngine, type SyncReport } from './engine';
import { FakeSyncServer } from './fake-sync-server';
import { SyncTransportError, type PushRequest, type SyncTransport, type WireRow } from './protocol';
import { SYNC_ENTITY_SIGNATURE, createSqliteSyncStore } from './sqlite-store';
import { openTestUserDatabase, type TestUserDatabase } from './test-sqlite';

/**
 * The engine, end to end on the phone's side: the real store and its SQL on
 * bun:sqlite, against an in-memory server that keeps I-WIRE's rules.
 */

const USER = 'user_engine';
let device: TestUserDatabase;
let server: FakeSyncServer;
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0, clock++)).toISOString();
const at = (n: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, n)).toISOString();

function engineFor(d: TestUserDatabase, options: { pushBatchSize?: number; pullPageSize?: number; transport?: SyncTransport } = {}): SyncEngine {
  return createSyncEngine({
    store: createSqliteSyncStore(d.access),
    transport: options.transport ?? server.transport(),
    now,
    pushBatchSize: options.pushBatchSize,
    pullPageSize: options.pullPageSize,
  });
}

beforeEach(() => {
  clock = 0;
  device = openTestUserDatabase(USER, at(0));
  server = new FakeSyncServer();
});

afterEach(() => device.close());

function q<T = Record<string, unknown>>(d: TestUserDatabase, sql: string, ...params: (string | number | null)[]): T[] {
  return d.db.raw.query(sql).all(...params) as T[];
}

function one<T>(d: TestUserDatabase, sql: string, ...params: (string | number | null)[]): T | null {
  return (d.db.raw.query(sql).get(...params) as T | null) ?? null;
}

/** One row, untyped, for comparing with toEqual. */
function row(d: TestUserDatabase, sql: string, ...params: (string | number | null)[]): Record<string, unknown> | null {
  return one<Record<string, unknown>>(d, sql, ...params);
}

/** A user-originated write, the way db.ts makes it. */
function addTx(d: TestUserDatabase, id: string, over: Record<string, string | number | null> = {}): void {
  const row: Record<string, string | number | null> = {
    id,
    amount: 10,
    category: 'Food',
    type: 'Expense',
    isImpulse: 0,
    note: null,
    dateISO: '2026-10-11',
    createdAt: at(1),
    accountId: defaultAccountId(USER),
    currency: 'USD',
    clientUpdatedAt: at(2),
    dirty: 1,
    ...over,
  };
  const cols = Object.keys(row);
  d.db.raw.query(`INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row));
}

function addAccount(d: TestUserDatabase, id: string, clientUpdatedAt = at(2)): void {
  d.db.raw
    .query(
      `INSERT INTO accounts (id, name, type, balance, openingBalance, currency, color, icon, isDefault, createdAt, clientUpdatedAt, dirty)
       VALUES (?, 'Savings', 'savings', 0, 0, 'USD', '#000', 'bank', 0, ?, ?, 1)`,
    )
    .run(id, at(1), clientUpdatedAt);
}

function deleteTx(d: TestUserDatabase, id: string, when = at(5)): void {
  d.db.raw.query(`DELETE FROM transactions WHERE id = ?`).run(id);
  d.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('transactions', ?, ?)`).run(id, when);
}

function serverTx(id: string, over: Partial<WireRow> = {}): WireRow {
  return {
    id,
    clientUpdatedAt: at(10),
    amount: 40,
    category: 'Transport',
    type: 'Expense',
    isImpulse: false,
    note: null,
    dateISO: '2026-10-09',
    accountId: null,
    currency: 'USD',
    createdAt: at(9),
    ...over,
  };
}

const realSettings = (over: Partial<WireRow> = {}): WireRow => ({
  id: 'settings',
  clientUpdatedAt: at(3),
  monthlyBudget: 2400,
  startingBalance: 100,
  hourlyValue: 30,
  showTimeCost: true,
  currency: 'EUR',
  currencySymbol: '€',
  monthlyIncome: 4000,
  savingsGoal: 500,
  spendingStyle: 'frugal',
  primaryGoal: 'save',
  locale: 'fr',
  ...over,
});

/** A cursor as this build stores one: with the entity signature it was read under. */
function storeCursor(d: TestUserDatabase, cursor: string): void {
  const put = d.db.raw.query(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`);
  put.run('pull_cursor', cursor);
  put.run('pull_entities', SYNC_ENTITY_SIGNATURE);
}

const dirtyCount = (d: TestUserDatabase, table: string) => one<{ n: number }>(d, `SELECT COUNT(*) AS n FROM ${table} WHERE dirty = 1`)!.n;
const entitiesOf = (request: PushRequest) => Object.entries(request.changes).filter(([, rows]) => rows && rows.length > 0).map(([e]) => e);

describe('push', () => {
  test('sends in entity order — settings, categories, accounts, transactions, subscriptions — also across requests', async () => {
    addTx(device, 'tx_1');
    device.db.raw
      .query(`INSERT INTO custom_categories (name, icon, color, createdAt, clientUpdatedAt, dirty) VALUES ('Pets', 'paw', '#111', ?, ?, 1)`)
      .run(at(1), at(2));
    device.db.raw
      .query(`INSERT INTO subscriptions (id, merchantDisplay, merchantNormalized, createdAt, clientUpdatedAt, dirty) VALUES ('sub_1', 'Gym', 'gym', ?, ?, 1)`)
      .run(at(1), at(2));

    await engineFor(device).syncOnce();
    expect(entitiesOf(server.pushes[0]!)).toEqual(['settings', 'categories', 'accounts', 'transactions', 'subscriptions']);

    // One row per request: the order holds across requests.
    const other = openTestUserDatabase('user_other', at(0));
    addTx(other, 'tx_2', { accountId: defaultAccountId('user_other') });
    const server2 = new FakeSyncServer();
    await engineFor(other, { pushBatchSize: 1, transport: server2.transport() }).syncOnce();
    expect(server2.pushes.map((p) => entitiesOf(p)[0])).toEqual(['settings', 'accounts', 'transactions']);
    // The account went first, so the server kept the transaction's account.
    expect(server2.get('transactions', 'tx_2')!.accountId).toBe(defaultAccountId('user_other'));
    other.close();
  });

  test('batches at most 500 rows per request', async () => {
    for (let i = 0; i < 1100; i++) addTx(device, `tx_${String(i).padStart(4, '0')}`);
    const report = await engineFor(device).syncOnce();
    const sizes = server.pushes.map((p) => Object.values(p.changes).reduce((n, rows) => n + (rows?.length ?? 0), 0));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(500);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(1102); // + the two seeds
    expect(report.pushed.applied).toBe(1102);
    expect(dirtyCount(device, 'transactions')).toBe(0);
  });

  test('applied rows become clean and stay clean through the pull that follows', async () => {
    addTx(device, 'tx_a');
    const report = await engineFor(device).syncOnce();
    expect(report.ok).toBe(true);
    expect(report.pushed.applied).toBe(3);
    expect(row(device, `SELECT dirty FROM transactions WHERE id = 'tx_a'`)).toEqual({ dirty: 0 });
    expect(server.get('transactions', 'tx_a')).toMatchObject({ amount: 10, isImpulse: false });
  });

  test('stale rows become clean and the pull brings the server version', async () => {
    server.put('transactions', serverTx('tx_a', { clientUpdatedAt: at(30), amount: 77 }));
    addTx(device, 'tx_a', { clientUpdatedAt: at(2), amount: 10 });
    const report = await engineFor(device).syncOnce();
    expect(report.pushed.stale).toBe(1);
    expect(row(device, `SELECT amount, dirty, clientUpdatedAt FROM transactions WHERE id = 'tx_a'`)).toEqual({
      amount: 77,
      dirty: 0,
      clientUpdatedAt: at(30),
    });
  });

  test('invalid rows keep their error and are not resent until edited', async () => {
    addTx(device, 'tx_bad');
    server.invalid.add('transactions\u0000tx_bad');
    const engine = engineFor(device);
    const first = await engine.syncOnce();
    expect(first.pushed.invalid).toBe(1);
    expect(row(device, `SELECT dirty, syncError FROM transactions WHERE id = 'tx_bad'`)).toEqual({ dirty: 1, syncError: 'invalid' });

    await engine.syncOnce();
    const sentAgain = server.pushes.slice(1).some((p) => p.changes.transactions?.some((r) => r.id === 'tx_bad'));
    expect(sentAgain).toBe(false);

    // The user fixes it (db.ts stamps it and clears the error).
    server.invalid.clear();
    device.db.raw.query(`UPDATE transactions SET amount = 11, clientUpdatedAt = ?, syncError = NULL WHERE id = 'tx_bad'`).run(at(40));
    const third = await engine.syncOnce();
    expect(third.pushed.applied).toBe(1);
    expect(row(device, `SELECT dirty, syncError FROM transactions WHERE id = 'tx_bad'`)).toEqual({ dirty: 0, syncError: null });
  });

  test('forbidden rows are recorded and not resent', async () => {
    addTx(device, 'tx_theirs');
    server.forbidden.add('transactions\u0000tx_theirs');
    const engine = engineFor(device);
    expect((await engine.syncOnce()).pushed.forbidden).toBe(1);
    expect(row(device, `SELECT syncError FROM transactions WHERE id = 'tx_theirs'`)).toEqual({ syncError: 'forbidden' });
    await engine.syncOnce();
    expect(server.pushes.length).toBe(1);
  });

  test('a row the server could not identify (id "") stays dirty', async () => {
    addTx(device, 'tx_odd');
    server.unidentifiable.add('transactions\u0000tx_odd');
    const report = await engineFor(device).syncOnce();
    expect(report.pushed.unanswered).toBe(1);
    expect(row(device, `SELECT dirty, syncError FROM transactions WHERE id = 'tx_odd'`)).toEqual({ dirty: 1, syncError: null });
  });

  test('local deletions are pushed as deletions and their tombstones dropped', async () => {
    addTx(device, 'tx_a');
    const engine = engineFor(device);
    await engine.syncOnce();
    deleteTx(device, 'tx_a', at(20));
    const report = await engine.syncOnce();
    expect(server.pushes[1]!.changes.transactions).toEqual([{ id: 'tx_a', clientUpdatedAt: at(20), deleted: true }]);
    expect(report.pushed.applied).toBe(1);
    expect(server.get('transactions', 'tx_a')).toBeUndefined();
    expect(row(device, `SELECT COUNT(*) AS n FROM sync_tombstones`)).toEqual({ n: 0 });
  });

  test('a row edited while its push is in flight stays dirty and is not overwritten by the pull', async () => {
    addTx(device, 'tx_a', { amount: 10 });
    server.onPush = () => {
      device.db.raw.query(`UPDATE transactions SET amount = 12, clientUpdatedAt = ?, dirty = 1 WHERE id = 'tx_a'`).run(at(45));
      server.onPush = null;
    };
    const engine = engineFor(device);
    const report = await engine.syncOnce();
    expect(report.pushed.changedSinceRead).toBe(1);
    // The pull brought the server's copy (amount 10), older than the edit: skipped.
    expect(report.pulled.skipped).toBeGreaterThanOrEqual(1);
    expect(row(device, `SELECT amount, dirty FROM transactions WHERE id = 'tx_a'`)).toEqual({ amount: 12, dirty: 1 });

    await engine.syncOnce();
    expect(server.get('transactions', 'tx_a')!.amount).toBe(12);
    expect(row(device, `SELECT dirty FROM transactions WHERE id = 'tx_a'`)).toEqual({ dirty: 0 });
  });
});

describe('pull', () => {
  test('epoch defaults lose to the server: a fresh device takes the real settings and account', async () => {
    server.put('settings', realSettings());
    server.put('accounts', {
      id: defaultAccountId(USER),
      clientUpdatedAt: at(4),
      name: 'Wallet',
      type: 'cash',
      openingBalance: 300,
      currency: 'EUR',
      color: '#22c55e',
      icon: 'wallet',
      isDefault: true,
      createdAt: at(1),
    });
    const report = await engineFor(device).syncOnce();
    expect(report.pushed.stale).toBe(2);
    expect(server.get('settings', 'settings')).toMatchObject({ monthlyBudget: 2400, locale: 'fr' });
    expect(row(device, `SELECT monthlyBudget, locale, showTimeCost, dirty, clientUpdatedAt FROM settings WHERE id = 1`)).toEqual({
      monthlyBudget: 2400,
      locale: 'fr',
      showTimeCost: 1,
      dirty: 0,
      clientUpdatedAt: at(3),
    });
    expect(row(device, `SELECT name, balance, dirty FROM accounts WHERE id = ?`, defaultAccountId(USER))).toEqual({
      name: 'Wallet',
      balance: 300,
      dirty: 0,
    });
  });

  test('a new account uploads its defaults, which the server has none of', async () => {
    await engineFor(device).syncOnce();
    expect(server.get('settings', 'settings')).toMatchObject({ clientUpdatedAt: EPOCH_ISO });
    expect(server.get('accounts', defaultAccountId(USER))).toMatchObject({ isDefault: true });
    expect(dirtyCount(device, 'settings') + dirtyCount(device, 'accounts')).toBe(0);
  });

  test('server deletions remove local rows without creating deletions to send back', async () => {
    server.put('transactions', serverTx('tx_s'));
    const engine = engineFor(device);
    await engine.syncOnce();
    expect(row(device, `SELECT id FROM transactions WHERE id = 'tx_s'`)).not.toBeNull();

    server.remove('transactions', 'tx_s', at(50));
    const report = await engine.syncOnce();
    expect(report.pulled.deletions).toBe(1);
    expect(row(device, `SELECT id FROM transactions WHERE id = 'tx_s'`)).toBeNull();
    expect(row(device, `SELECT COUNT(*) AS n FROM sync_tombstones`)).toEqual({ n: 0 });
  });

  test('deletions travel both ways between two devices', async () => {
    const phoneB = openTestUserDatabase(USER, at(0));
    const a = engineFor(device);
    const b = engineFor(phoneB);
    addTx(device, 'tx_shared');
    await a.syncOnce();
    await b.syncOnce();
    expect(row(phoneB, `SELECT amount FROM transactions WHERE id = 'tx_shared'`)).toEqual({ amount: 10 });

    deleteTx(phoneB, 'tx_shared', at(30));
    await b.syncOnce();
    await a.syncOnce();
    expect(row(device, `SELECT id FROM transactions WHERE id = 'tx_shared'`)).toBeNull();
    phoneB.close();
  });

  test('a fresh device after a snapshot wipe keeps only what the server has, plus its own unsent work', async () => {
    const engine = engineFor(device);
    server.put('transactions', serverTx('tx_kept'));
    server.put('transactions', serverTx('tx_gone'));
    await engine.syncOnce();
    // The server forgets tx_gone without a tombstone (retention purged it) and
    // the device's cursor is too old: the server answers with a snapshot.
    server.live.delete('transactions\u0000tx_gone');
    device.db.raw.query(`UPDATE sync_meta SET value = NULL WHERE key = 'pull_cursor'`).run();
    addTx(device, 'tx_mine', { clientUpdatedAt: at(40) });
    server.failPush = new SyncTransportError('http', 'busy', 503);

    const report = await engine.syncOnce();
    expect(report.pulled.fullResync).toBe(true);
    const ids = q<{ id: string }>(device, `SELECT id FROM transactions ORDER BY id`).map((r) => r.id);
    expect(ids).toEqual(['tx_kept', 'tx_mine']);
  });

  test('a snapshot spanning pages wipes once, before its first page — even when interrupted between pages', async () => {
    for (let i = 0; i < 5; i++) server.put('transactions', serverTx(`tx_${i}`));
    // Seven rows (the two uploaded seeds first), pages of two; the connection
    // drops after the second page.
    server.failPullAfterPages = 2;
    const engine = engineFor(device, { pullPageSize: 2 });
    const first = await engine.syncOnce();
    expect(first.ok).toBe(false);
    expect(first.pulled.pages).toBe(2);
    expect(q<{ id: string }>(device, `SELECT id FROM transactions ORDER BY id`).map((r) => r.id)).toEqual(['tx_0', 'tx_1']);

    // The next cycle continues the same snapshot from the stored cursor, and
    // wipes nothing: page one's account and page two's rows are still there.
    const pullsBefore = server.pulls.length;
    const second = await engine.syncOnce();
    expect(second.ok).toBe(true);
    expect(server.pulls[pullsBefore]!.cursor).toMatch(/^snap:4:/);
    expect(q<{ id: string }>(device, `SELECT id FROM transactions ORDER BY id`).map((r) => r.id)).toEqual([
      'tx_0',
      'tx_1',
      'tx_2',
      'tx_3',
      'tx_4',
    ]);
    expect(row(device, `SELECT dirty FROM accounts WHERE id = ?`, defaultAccountId(USER))).toEqual({ dirty: 0 });
    expect(row(device, `SELECT value FROM sync_meta WHERE key = 'pull_resync_active'`)).toBeNull();
  });

  test('the cursor is stored and a restarted engine resumes from it', async () => {
    server.put('transactions', serverTx('tx_1'));
    await engineFor(device).syncOnce();
    const stored = one<{ value: string }>(device, `SELECT value FROM sync_meta WHERE key = 'pull_cursor'`)!.value;
    expect(stored).toMatch(/^seq:/);

    server.put('transactions', serverTx('tx_2'));
    const restarted = engineFor(device);
    const report = await restarted.syncOnce();
    expect(server.pulls[server.pulls.length - 1]!.cursor).toBe(stored);
    expect(report.pulled.fullResync).toBe(false);
    expect(report.pulled.rows).toBe(1);
  });

  test('a refused cursor (400 invalid_cursor) is dropped and the pull restarts as a snapshot', async () => {
    server.put('transactions', serverTx('tx_1'));
    storeCursor(device, 'garbage');
    const report = await engineFor(device).syncOnce();
    expect(report.ok).toBe(true);
    expect(report.pulled.cursorReset).toBe(true);
    expect(report.pulled.fullResync).toBe(true);
    expect(row(device, `SELECT id FROM transactions WHERE id = 'tx_1'`)).not.toBeNull();
  });

  test('a cursor that never advances stops the cycle instead of looping', async () => {
    storeCursor(device, 'stuck');
    server.stuckCursor = 'stuck';
    const report = await engineFor(device).syncOnce();
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toContain('did not advance');
  });

  test('balances are recomputed once the pull has applied rows', async () => {
    server.put('accounts', {
      id: 'acc_s',
      clientUpdatedAt: at(4),
      name: 'Bank',
      type: 'checking',
      openingBalance: 1000,
      currency: 'USD',
      color: '#000',
      icon: 'bank',
      isDefault: false,
      createdAt: at(1),
    });
    server.put('transactions', serverTx('tx_rent', { accountId: 'acc_s', amount: 400 }));
    server.put('transactions', serverTx('tx_pay', { accountId: 'acc_s', amount: 150, type: 'Income' }));
    await engineFor(device).syncOnce();
    expect(row(device, `SELECT balance FROM accounts WHERE id = 'acc_s'`)).toEqual({ balance: 750 });
  });

  test('a server-deleted account leaves no local transaction pointing at it', async () => {
    addAccount(device, 'acc_x');
    addTx(device, 'tx_on_x', { accountId: 'acc_x' });
    const engine = engineFor(device);
    await engine.syncOnce();
    server.remove('accounts', 'acc_x', at(50));
    await engine.syncOnce();
    expect(row(device, `SELECT id FROM accounts WHERE id = 'acc_x'`)).toBeNull();
    expect(row(device, `SELECT accountId, dirty FROM transactions WHERE id = 'tx_on_x'`)).toEqual({ accountId: null, dirty: 0 });
  });
});

describe('failures and concurrency', () => {
  test('a network failure leaves every dirty row intact and skips the pull; the next cycle sends them', async () => {
    addTx(device, 'tx_a');
    server.failPush = new SyncTransportError('network', 'offline');
    const engine = engineFor(device);
    const report = await engine.syncOnce();
    expect(report.ok).toBe(false);
    expect(server.pulls.length).toBe(0);
    expect(dirtyCount(device, 'transactions')).toBe(1);

    const retry = await engine.syncOnce();
    expect(retry.ok).toBe(true);
    expect(dirtyCount(device, 'transactions')).toBe(0);
  });

  test('a server error on push still lets the device receive what the server has', async () => {
    server.put('transactions', serverTx('tx_s'));
    addTx(device, 'tx_a');
    server.failPush = new SyncTransportError('http', 'Internal error', 500);
    const report = await engineFor(device).syncOnce();
    expect(report.ok).toBe(false);
    expect(row(device, `SELECT id FROM transactions WHERE id = 'tx_s'`)).not.toBeNull();
    expect(dirtyCount(device, 'transactions')).toBe(1);
  });

  test('cut off between push requests: what was answered stays clean, the rest stays dirty and goes next time', async () => {
    for (let i = 0; i < 5; i++) addTx(device, `tx_${i}`);
    // The first request (the two seeds and one row) is answered, then the
    // connection drops — the app went to the background mid-cycle.
    server.onPush = () => {
      server.onPush = null;
      server.failPush = new SyncTransportError('network', 'connection lost');
    };
    const engine = engineFor(device, { pushBatchSize: 3 });
    const report = await engine.syncOnce();
    expect(report.ok).toBe(false);
    expect(report.pushed.applied).toBe(3);
    expect(dirtyCount(device, 'transactions')).toBe(4);
    expect(server.pulls.length).toBe(0);

    const retry = await engine.syncOnce();
    expect(retry.ok).toBe(true);
    expect(dirtyCount(device, 'transactions')).toBe(0);
    expect(server.get('transactions', 'tx_4')).toBeDefined();
  });

  test('an edit made here after a deletion elsewhere survives it, and brings the row back', async () => {
    addTx(device, 'tx_a');
    const engine = engineFor(device);
    await engine.syncOnce();
    server.remove('transactions', 'tx_a', at(20));
    device.db.raw.query(`UPDATE transactions SET amount = 33, clientUpdatedAt = ?, dirty = 1 WHERE id = 'tx_a'`).run(at(40));
    // This cycle pushes the edit first: newer than the deletion, it resurrects.
    const report = await engine.syncOnce();
    expect(report.pushed.applied).toBe(1);
    expect(server.get('transactions', 'tx_a')).toMatchObject({ amount: 33 });
    expect(row(device, `SELECT amount, dirty FROM transactions WHERE id = 'tx_a'`)).toEqual({ amount: 33, dirty: 0 });
  });

  test('overlapping triggers share one cycle', async () => {
    addTx(device, 'tx_a');
    const engine = engineFor(device);
    const [r1, r2, r3] = await Promise.all([engine.syncOnce(), engine.syncOnce(), engine.syncOnce()]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(server.pushes.length).toBe(1);
    expect(server.pulls.length).toBe(1);
    expect(engine.isRunning()).toBe(false);
  });

  test('requestCycle during a cycle runs one more after it, shared by everyone who asked', async () => {
    const engine = engineFor(device);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.onPush = async () => {
      server.onPush = null;
      await gate;
    };
    const running = engine.syncOnce();
    await Promise.resolve();
    // A change made while that cycle is in flight, and two callers who need it sent.
    addTx(device, 'tx_late');
    const a = engine.requestCycle();
    const b = engine.requestCycle();
    expect(a).toBe(b);
    release();
    const [first, second] = await Promise.all([running, a]);
    expect(second).not.toBe(first);
    expect(server.get('transactions', 'tx_late')).toBeDefined();
    expect(server.pulls.length).toBe(2);
  });

  test('a store failure becomes a failed report, never a rejection, and the next cycle runs', async () => {
    const store = createSqliteSyncStore(device.access);
    let broken = true;
    const engine = createSyncEngine({
      store: {
        ...store,
        readPending: (...args) => (broken ? Promise.reject(new Error('database is closed')) : store.readPending(...args)),
      },
      transport: server.transport(),
      now,
    });
    const failed: SyncReport = await engine.syncOnce();
    expect(failed.ok).toBe(false);
    expect(failed.errors[0]).toContain('database is closed');
    broken = false;
    expect((await engine.syncOnce()).ok).toBe(true);
  });
});

test('categories and subscriptions land too, one row per page', async () => {
  server.put('categories', { id: 'Pets', clientUpdatedAt: at(3), icon: 'paw', color: '#111', createdAt: at(1) });
  server.put('subscriptions', {
    id: 'sub_1',
    clientUpdatedAt: at(3),
    merchantDisplay: 'Netflix',
    merchantNormalized: 'netflix',
    cadence: 'monthly',
    typicalAmount: 12,
    currency: 'USD',
    confidenceScore: 0.9,
    lastChargedAt: null,
    nextExpectedAt: '2026-11-01',
    status: 'confirmed',
    cancelUrl: null,
    cancelNotes: null,
    source: 'transaction',
    createdAt: at(1),
  });
  const report = await engineFor(device, { pullPageSize: 1 }).syncOnce();
  expect(report.pulled.pages).toBeGreaterThanOrEqual(4);
  expect(row(device, `SELECT icon FROM custom_categories WHERE name = 'Pets'`)).toEqual({ icon: 'paw' });
  expect(row(device, `SELECT status, dirty FROM subscriptions WHERE id = 'sub_1'`)).toEqual({ status: 'confirmed', dirty: 0 });
});

// ── Phase 4: recurring series, bills, budgets and net worth ───────────────────

const P4_TABLES = ['recurring_transactions', 'bill_reminders', 'category_budgets', 'net_worth_entries'] as const;

function putPhase4Rows(s: FakeSyncServer): void {
  s.put('recurring', {
    id: 'rec_gym', clientUpdatedAt: at(3), accountId: defaultAccountId(USER), name: 'Gym', amount: 35.5, category: 'Gym',
    type: 'Expense', isImpulse: false, frequency: 'weekly', startDate: '2026-10-01', nextDate: '2026-10-15', lastCreated: '2026-10-08',
    isActive: true, currency: 'USD', createdAt: at(1),
  });
  s.put('billReminders', {
    id: 'bill_water', clientUpdatedAt: at(3), name: 'Water', amount: 20, dueDay: 12, category: 'Other', isRecurring: true,
    isPaid: false, paidAt: null, nextDueDate: '2026-10-12', createdAt: at(1),
  });
  s.put('categoryBudgets', { id: 'Food', clientUpdatedAt: at(3), amount: 300, period: 'monthly', createdAt: at(1) });
  s.put('netWorth', {
    id: 'nw_1', clientUpdatedAt: at(3), date: '2026-10-11', assets: 10, liabilities: 2, netWorth: 8,
    breakdown: '{"cashSavings":10,"loans":2}', createdAt: at(1),
  });
}

const p4Counts = (d: TestUserDatabase) =>
  P4_TABLES.map((table) => one<{ n: number }>(d, `SELECT COUNT(*) AS n FROM ${table}`)!.n);

describe('the Phase 4 entities', () => {
  test('push after subscriptions, in contract order, and land on a second phone as they left the first', async () => {
    device.db.raw
      .query(
        `INSERT INTO recurring_transactions (id, accountId, name, amount, category, type, frequency, startDate, nextDate, isActive, createdAt, clientUpdatedAt, dirty)
         VALUES ('rec_1', ?, 'Rent', 700, 'Other', 'Expense', 'monthly', '2026-10-11', '2026-10-11', 1, ?, ?, 1)`,
      )
      .run(defaultAccountId(USER), at(1), at(2));
    device.db.raw
      .query(
        `INSERT INTO bill_reminders (id, name, amount, dueDay, category, isRecurring, isPaid, paidAt, nextDueDate, createdAt, clientUpdatedAt, dirty)
         VALUES ('bill_1', 'Water', 20, 31, 'Other', 1, 1, ?, '2026-11-30', ?, ?, 1)`,
      )
      .run(at(2), at(1), at(2));
    device.db.raw
      .query(`INSERT INTO category_budgets (category, amount, period, createdAt, clientUpdatedAt, dirty) VALUES ('Food', 300, 'monthly', ?, ?, 1)`)
      .run(at(1), at(2));
    device.db.raw
      .query(
        `INSERT INTO net_worth_entries (id, date, assets, liabilities, netWorth, breakdown, createdAt, clientUpdatedAt, dirty)
         VALUES ('nw_1', '2026-10-11', 10, 2, 8, '{"cashSavings":10,"loans":2}', ?, ?, 1)`,
      )
      .run(at(1), at(2));

    const report = await engineFor(device, { pushBatchSize: 1 }).syncOnce();
    expect(report.ok).toBe(true);
    expect(server.pushes.map((p) => entitiesOf(p)[0])).toEqual([
      'settings', 'accounts', 'recurring', 'billReminders', 'categoryBudgets', 'netWorth',
    ]);
    // The series' account went first, so the server kept it.
    expect(server.get('recurring', 'rec_1')).toMatchObject({ accountId: defaultAccountId(USER), isActive: true });
    expect(server.get('billReminders', 'bill_1')).toMatchObject({ isPaid: true, isRecurring: true, paidAt: at(2) });
    expect(server.get('netWorth', 'nw_1')!.breakdown).toBe('{"cashSavings":10,"loans":2}');
    for (const table of P4_TABLES) expect(dirtyCount(device, table)).toBe(0);

    const phoneB = openTestUserDatabase(USER, at(0));
    await engineFor(phoneB).syncOnce();
    for (const table of P4_TABLES) {
      expect(q(phoneB, `SELECT * FROM ${table}`)).toEqual(q(device, `SELECT * FROM ${table}`));
    }
    phoneB.close();
  });

  test('a phone upgraded from the five-entity build pulls everything once and fills the new tables', async () => {
    putPhase4Rows(server);
    server.put('transactions', serverTx('tx_1'));
    const engine = engineFor(device);
    await engine.syncOnce();
    expect(p4Counts(device)).toEqual([1, 1, 1, 1]);

    // The database as the five-entity build left it, opened by this one: its
    // cursor is past the four entities' rows, which it skipped, and the new
    // tables are empty. It has unsent work of its own.
    for (const table of P4_TABLES) device.db.raw.query(`DELETE FROM ${table}`).run();
    device.db.raw.query(`DELETE FROM sync_meta WHERE key = 'pull_entities'`).run();
    addTx(device, 'tx_unsent', { clientUpdatedAt: at(40) });
    server.failPush = new SyncTransportError('http', 'busy', 503);

    const upgraded = await engine.syncOnce();
    expect(upgraded.pulled.fullResync).toBe(true);
    expect(server.pulls[server.pulls.length - 1]!.cursor).toBeNull();
    expect(p4Counts(device)).toEqual([1, 1, 1, 1]);
    expect(row(device, `SELECT accountId, isActive, lastCreated FROM recurring_transactions WHERE id = 'rec_gym'`)).toEqual({
      accountId: defaultAccountId(USER),
      isActive: 1,
      lastCreated: '2026-10-08',
    });
    expect(row(device, `SELECT breakdown FROM net_worth_entries WHERE id = 'nw_1'`)).toEqual({ breakdown: '{"cashSavings":10,"loans":2}' });
    // The snapshot kept what was not yet sent.
    expect(q<{ id: string }>(device, `SELECT id FROM transactions ORDER BY id`).map((r) => r.id)).toEqual(['tx_1', 'tx_unsent']);

    // Once: the next cycle goes on from the snapshot's cursor.
    const after = await engine.syncOnce();
    expect(after.pulled.fullResync).toBe(false);
    expect(server.pulls[server.pulls.length - 1]!.cursor).toMatch(/^seq:/);
    expect(server.get('transactions', 'tx_unsent')).toBeDefined();
  });

  test('a series edited here after the server booked it keeps the edit; the server-moved dates come back by pull', async () => {
    putPhase4Rows(server);
    const engine = engineFor(device);
    await engine.syncOnce();
    // Paused here, then the server's booking (stamped later) arrives: the server write wins.
    device.db.raw.query(`UPDATE recurring_transactions SET isActive = 0, clientUpdatedAt = ?, dirty = 1 WHERE id = 'rec_gym'`).run(at(20));
    const booked = server.get('recurring', 'rec_gym')!;
    server.put('recurring', { ...booked, clientUpdatedAt: at(30), lastCreated: '2026-10-15', nextDate: '2026-10-22' });
    const report = await engine.syncOnce();
    expect(report.pushed.stale).toBe(1);
    expect(row(device, `SELECT isActive, lastCreated, nextDate, dirty FROM recurring_transactions WHERE id = 'rec_gym'`)).toEqual({
      isActive: 1,
      lastCreated: '2026-10-15',
      nextDate: '2026-10-22',
      dirty: 0,
    });
  });
});
