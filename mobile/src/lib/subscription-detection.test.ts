import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemorySqlite } from './test-support/memory-sqlite';
import type { LocalEmailFinding } from './db';
import {
  createDetectionRunner,
  detectionAfterPull,
  emptyPullTally,
  monthlyTotalIn,
  tallyPullPage,
  transactionSourceOf,
  type DetectionDeps,
  type ImportBatch,
  type ReminderRequest,
} from './subscription-detection';

/**
 * The runner, run for real: db.ts's own SQL against SQLite (bun:sqlite)
 * behind a stand-in for expo-sqlite, with the engine in between — so what is
 * under test is what the phone does: which rows a run writes, that the
 * user's decisions survive it, that overlapping runs are one after another,
 * and the total it reports.
 *
 * db.ts is imported under its own query string: Bun's module mocks are
 * process-wide, and other files replace './db' with stubs.
 */
const mem = createMemorySqlite();
mock.module('expo-sqlite', () => mem.expoSqlite);
const db = (await import('./db.ts?detection-runner' as string)) as typeof import('./db');

const TODAY = '2026-10-12';
let user = 0;
let uid = '';
let batches: ImportBatch[] = [];
let reminders: ReminderRequest[] = [];
let changes = 0;
let mutations = 0;
db.onLocalMutation(() => {
  mutations += 1;
});

beforeEach(async () => {
  uid = `runner${++user}`;
  await db.openUserDatabase(uid);
  batches = [];
  reminders = [];
  changes = 0;
  mutations = 0;
});

function deps(over: Partial<DetectionDeps> = {}): DetectionDeps {
  return {
    activeUser: async () => db.activeUserId(),
    needsFirstPull: async () => false,
    getTransactions: () => db.getTransactions(),
    getEmailFindings: () => db.getEmailFindings(),
    getSubscriptions: () => db.getSubscriptions(),
    upsertSubscription: (s) => db.upsertSubscription(s),
    moveSubscriptionOccurrences: (a, b) => db.moveSubscriptionOccurrences(a, b),
    deleteSubscription: (id) => db.deleteSubscription(id),
    getSubscriptionOccurrences: (id) => db.getSubscriptionOccurrences(id),
    addSubscriptionOccurrence: (o) => db.addSubscriptionOccurrence(o),
    setSubscriptionDecision: (id, d) => db.setSubscriptionDecision(id, d),
    importBatches: async () => batches,
    userCurrency: async () => (await db.getSettings()).currency,
    rates: async () => ({ USD: 1, EUR: 0.9, GBP: 0.8 }),
    scheduleReminders: async (r) => {
      reminders.push(r);
    },
    today: () => TODAY,
    changed: () => {
      changes += 1;
    },
    ...over,
  };
}

const months = (from: number, to: number, day: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

/** A bank row as the server books it: a provider-namespaced id, arriving by sync. */
async function bankCharge(id: string, note: string, amount: number, dateISO: string, currency = 'USD') {
  const handle = await db.getDatabase();
  await handle.runAsync(
    `INSERT INTO transactions (id, amount, category, type, isImpulse, note, dateISO, createdAt, accountId, currency)
     VALUES (?, ?, 'Subscriptions', 'Expense', 0, ?, ?, '2026-10-01T08:00:00.000Z', NULL, ?)`,
    [id, amount, note, dateISO, currency],
  );
}

/** Statement lines saved the way import.tsx saves them, inside a recorded batch. */
async function importLines(note: string, amount: number, dates: string[], currency = 'USD') {
  const from = new Date().toISOString();
  for (const dateISO of dates) {
    await db.addTransaction({ amount, category: 'Subscriptions', type: 'Expense', isImpulse: false, note, dateISO, currency });
  }
  batches.push({ from, to: new Date().toISOString() });
}

function finding(over: Partial<LocalEmailFinding> & Pick<LocalEmailFinding, 'id'>): LocalEmailFinding {
  return {
    connectionId: 'conn_1',
    source: 'gmail',
    kind: 'receipt',
    merchant: null,
    senderDomain: null,
    billedVia: null,
    amount: null,
    currency: null,
    cadence: 'monthly',
    chargedISO: null,
    emailDateISO: null,
    nextChargeISO: null,
    trialEndsISO: null,
    previousAmount: null,
    confidence: 0.9,
    receivedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

describe('detection runner', () => {
  test('a bank charge, a statement line and an email receipt each month are one Netflix, written through db.ts with one occurrence a month', async () => {
    const dates = months(5, 9, 15);
    for (const [i, d] of dates.entries()) await bankCharge(`plaid_nf${i}`, 'NETFLIX.COM', 15.49, d);
    await importLines('PRLV NETFLIX.COM 866-579-7172 CA', 15.49, dates);
    await db.upsertEmailFindings(
      dates.map((d, i) =>
        finding({ id: `f${i}`, merchant: 'Netflix', senderDomain: 'netflix.com', amount: 15.49, currency: 'USD', emailDateISO: d, chargedISO: d }),
      ),
    );

    const summary = await createDetectionRunner(deps()).runDetection('import');

    const subs = await db.getSubscriptions();
    expect(subs.map((s) => s.merchantNormalized)).toEqual(['netflix']);
    const [netflix] = subs;
    expect(netflix!.sources).toBe('import,bank,email');
    expect(netflix!.status).toBe('active');
    expect(netflix!.typicalAmount).toBe(15.49);
    const history = await db.getSubscriptionOccurrences(netflix!.id);
    expect(history.map((o) => o.chargedAt).sort()).toEqual(dates);
    // The bank's copy represents each payment.
    expect(history.every((o) => o.transactionId?.startsWith('plaid_'))).toBe(true);

    expect(summary.newSubscriptions.map((s) => s.id)).toEqual([netflix!.id]);
    expect(summary.active.map((s) => s.id)).toEqual([netflix!.id]);
    expect(summary.monthlyTotal).toBe(15.49);
    expect(summary.currency).toBe('USD');
    expect(summary.events).toEqual([{ type: 'new', subscriptionId: netflix!.id }]);
    // Handed to the reminder planner as it now stands; an import announces, and may ask.
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ uid, announceFinds: true, interactive: true, events: summary.events });
    expect(reminders[0]!.subscriptions.map((s) => s.id)).toEqual([netflix!.id]);
    expect(changes).toBe(1);
  });

  test('a statement imported first and the bank linked later keep one history entry a month', async () => {
    const dates = months(5, 9, 15);
    await importLines('NETFLIX.COM 866-579-7172 CA', 15.49, dates);
    const runner = createDetectionRunner(deps());
    await runner.runDetection('import');
    // The bank's copies, a day later, become each payment's representative.
    for (const [i, d] of dates.entries()) await bankCharge(`plaid_late${i}`, 'NETFLIX.COM', 15.49, d.replace(/-15$/, '-16'));
    await runner.runDetection('bank');
    const [netflix] = await db.getSubscriptions();
    expect(netflix!.sources).toBe('import,bank');
    expect((await db.getSubscriptionOccurrences(netflix!.id)).map((o) => o.chargedAt).sort()).toEqual(dates);
  });

  test('the user’s decisions win: a kept row keeps its decision while its price updates, a dismissed one stays dismissed', async () => {
    for (const [i, d] of months(4, 7, 3).entries()) await bankCharge(`plaid_sp${i}`, 'SPOTIFY P1234', 10.99, d);
    for (const [i, d] of months(4, 7, 20).entries()) await bankCharge(`plaid_gym${i}`, 'BASIC-FIT', 29.99, d);
    const runner = createDetectionRunner(deps());
    await runner.runDetection('sync');
    const spotify = (await db.getSubscriptions()).find((s) => s.merchantNormalized === 'spotify')!;
    const gym = (await db.getSubscriptions()).find((s) => s.merchantNormalized !== 'spotify')!;
    await runner.decideSubscription(spotify.id, 'keep');
    await runner.decideSubscription(gym.id, 'dismiss');

    // Spotify goes up; the gym keeps charging.
    for (const [i, d] of months(8, 9, 3).entries()) await bankCharge(`plaid_sp_new${i}`, 'SPOTIFY P1234', 11.99, d);
    for (const [i, d] of months(8, 9, 20).entries()) await bankCharge(`plaid_gym_new${i}`, 'BASIC-FIT', 29.99, d);
    reminders = [];
    const summary = await runner.runDetection('bank');

    const after = new Map((await db.getSubscriptions()).map((s) => [s.id, s]));
    expect(after.get(spotify.id)).toMatchObject({ decision: 'keep', status: 'confirmed', typicalAmount: 11.99, previousAmount: 10.99 });
    expect(after.get(gym.id)).toMatchObject({ decision: 'dismiss', status: 'dismissed' });
    expect(summary.events).toEqual([{ type: 'price_rise', subscriptionId: spotify.id, from: 10.99, to: 11.99 }]);
    // Dismissed is not running: not in the total, not among the active.
    expect(summary.active.map((s) => s.id)).toEqual([spotify.id]);
    expect(summary.monthlyTotal).toBe(11.99);
    // A background run never asks for permission.
    expect(reminders[0]).toMatchObject({ interactive: false });
  });

  test('overlapping runs are serialised, and triggers during a run schedule exactly one more', async () => {
    for (const [i, d] of months(5, 9, 10).entries()) await bankCharge(`plaid_d${i}`, 'DISNEY PLUS', 8.99, d);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    let inFlight = 0;
    let most = 0;
    const runner = createDetectionRunner(
      deps({
        getTransactions: async () => {
          reads += 1;
          inFlight += 1;
          most = Math.max(most, inFlight);
          if (reads === 1) await held;
          const rows = await db.getTransactions();
          inFlight -= 1;
          return rows;
        },
      }),
    );
    const first = runner.runDetection('startup');
    await Bun.sleep(5);
    // Three triggers while the first is held: one more run, which they all join.
    const later = [runner.runDetection('sync'), runner.runDetection('import'), runner.runDetection('email')];
    expect(later[0]).toBe(later[1]);
    expect(later[1]).toBe(later[2]);
    release();
    const [a, b] = await Promise.all([first, later[0]]);
    expect(reads).toBe(2);
    expect(most).toBe(1);
    expect(a.newSubscriptions).toHaveLength(1);
    // The second run found nothing new, and was interactive because an import joined it.
    expect(b.newSubscriptions).toHaveLength(0);
    expect(reminders.map((r) => r.interactive)).toEqual([false, true]);
    // Nothing queued any more: the next trigger starts a run of its own.
    await runner.runDetection('manual');
    expect(reads).toBe(3);
  });

  test('the monthly total is in the user’s currency: converted with cached rates, never euros added to dollars', async () => {
    for (const [i, d] of months(4, 9, 5).entries()) await bankCharge(`plaid_us${i}`, 'NETFLIX.COM', 18, d, 'USD');
    for (const [i, d] of months(4, 9, 7).entries()) await bankCharge(`plaid_eu${i}`, 'SPOTIFY AB', 9, d, 'EUR');
    await bankCharge('plaid_y0', 'AMAZON PRIME*2K4', 120, '2025-10-01', 'GBP');
    await bankCharge('plaid_y1', 'AMAZON PRIME*7Q1', 120, '2026-10-01', 'GBP');

    const converted = await createDetectionRunner(deps()).runDetection('manual');
    // 18 + 9 € (= 10 $ at 0.9 € to the dollar) + 120 £ a year (= 150 $, so 12.50 $ a month).
    expect(converted.currency).toBe('USD');
    expect(converted.monthlyTotal).toBe(40.5);
    expect(converted.notInTotal).toBe(0);

    // No rates at all: what cannot be converted is left out and counted, not added at face value.
    const unconverted = await createDetectionRunner(deps({ rates: async () => null })).runDetection('manual');
    expect(unconverted.monthlyTotal).toBe(18);
    expect(unconverted.notInTotal).toBe(2);

    expect(monthlyTotalIn([{ cadence: 'weekly', typicalAmount: 7, currency: 'usd' }], 'USD', null).total).toBe(30.42);
  });

  test('a run never rejects into its trigger, and the next one works', async () => {
    for (const [i, d] of months(5, 9, 12).entries()) await bankCharge(`plaid_x${i}`, 'NETFLIX.COM', 15.49, d);
    let fail = true;
    const runner = createDetectionRunner(
      deps({
        getTransactions: async () => {
          if (fail) throw new Error('database is locked');
          return db.getTransactions();
        },
      }),
    );
    const failed = await runner.runDetection('import');
    expect(failed).toMatchObject({ newSubscriptions: [], active: [], monthlyTotal: 0, events: [] });
    expect(await db.getSubscriptions()).toEqual([]);
    fail = false;
    expect((await runner.runDetection('import')).newSubscriptions).toHaveLength(1);
  });

  test('an upgraded database waits for its first pull before writing anything, then runs', async () => {
    for (const [i, d] of months(5, 9, 12).entries()) await bankCharge(`plaid_w${i}`, 'NETFLIX.COM', 15.49, d);
    let firstPullDone = false;
    const runner = createDetectionRunner(deps({ needsFirstPull: async () => !firstPullDone }));
    expect((await runner.runDetection('startup')).events).toEqual([]);
    expect(runner.isDeferred()).toBe(true);
    expect(await db.getSubscriptions()).toEqual([]);
    expect(reminders).toEqual([]);
    firstPullDone = true;
    expect((await runner.runDetection('sync')).newSubscriptions).toHaveLength(1);
    expect(runner.isDeferred()).toBe(false);
  });

  test('a quiet re-run writes nothing, raises nothing and refreshes nothing', async () => {
    for (const [i, d] of months(5, 9, 12).entries()) await bankCharge(`plaid_q${i}`, 'NETFLIX.COM', 15.49, d);
    const runner = createDetectionRunner(deps());
    await runner.runDetection('sync');
    mutations = 0;
    changes = 0;
    const again = await runner.runDetection('sync');
    expect(again.events).toEqual([]);
    expect(again.newSubscriptions).toEqual([]);
    expect(mutations).toBe(0);
    expect(changes).toBe(0);
    // The reminders are re-planned all the same (the date moves on).
    expect(reminders).toHaveLength(2);
  });

  test('a user switch during a run writes nothing into the next user’s ledger', async () => {
    for (const [i, d] of months(5, 9, 12).entries()) await bankCharge(`plaid_s${i}`, 'NETFLIX.COM', 15.49, d);
    let calls = 0;
    const runner = createDetectionRunner(
      deps({
        activeUser: async () => (++calls === 1 ? uid : 'someone-else'),
      }),
    );
    const summary = await runner.runDetection('sync');
    expect(summary.events).toEqual([]);
    expect(await db.getSubscriptions()).toEqual([]);
    expect(reminders).toEqual([]);
  });

  test('finds the user is looking at are not announced; finds from a background run are', async () => {
    for (const [i, d] of months(5, 9, 12).entries()) await bankCharge(`plaid_a${i}`, 'NETFLIX.COM', 15.49, d);
    const runner = createDetectionRunner(deps());
    await runner.runDetection('manual');
    await runner.runDetection('onboarding');
    await runner.runDetection('email', { interactive: true, announce: false });
    await runner.runDetection('bank');
    expect(reminders.map((r) => [r.announceFinds, r.interactive])).toEqual([
      [false, true],
      [false, true],
      [false, true],
      [true, false],
    ]);
  });

  test('decideSubscription records the decision and re-plans the reminders, interactively', async () => {
    for (const [i, d] of months(5, 9, 12).entries()) await bankCharge(`plaid_k${i}`, 'NETFLIX.COM', 15.49, d);
    const runner = createDetectionRunner(deps());
    await runner.runDetection('sync');
    const [sub] = await db.getSubscriptions();
    reminders = [];
    expect(await runner.decideSubscription(sub!.id, 'cancel')).toBe(true);
    expect((await db.getSubscriptionById(sub!.id))!).toMatchObject({ decision: 'cancel', status: 'canceled' });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ events: [], interactive: true, announceFinds: false });
    expect(reminders[0]!.subscriptions[0]!.status).toBe('canceled');
  });
});

describe('detection trigger', () => {
  const report = (changed: number, complete = true) => ({ pulled: { changed, complete } });

  test('a pull that changed transactions runs detection; the bank’s rows make it a bank run', () => {
    const synced = tallyPullPage(emptyPullTally(), {
      changes: { transactions: [{ id: 'tx_1_abc' }], accounts: [{ id: 'acc_1' }] },
      deletions: [],
    });
    expect(detectionAfterPull(report(2), synced, false)).toEqual({ detect: 'sync', replan: false });

    const plaid = tallyPullPage(emptyPullTally(), {
      changes: { transactions: [{ id: 'plaid_9xk' }, { id: 'tx_2_def' }] },
      deletions: [{ entity: 'transactions', id: 'plaid_removed' }],
    });
    expect(plaid).toEqual({ transactions: 3, bankTransactions: 2, subscriptions: 0 });
    expect(detectionAfterPull(report(3), plaid, false)).toEqual({ detect: 'bank', replan: false });
  });

  test('an echo of this phone’s own rows, or a pull without transactions, runs nothing', () => {
    const echo = tallyPullPage(emptyPullTally(), { changes: { transactions: [{ id: 'tx_1_abc' }] }, deletions: [] });
    expect(detectionAfterPull(report(0), echo, false)).toEqual({ detect: null, replan: false });
    const settingsOnly = tallyPullPage(emptyPullTally(), { changes: { settings: [{ id: '1' }] }, deletions: [] });
    expect(detectionAfterPull(report(1), settingsOnly, false)).toEqual({ detect: null, replan: false });
    expect(detectionAfterPull(report(0), emptyPullTally(), false)).toEqual({ detect: null, replan: false });
  });

  test('a decision synced in from another device re-plans the reminders', () => {
    const decided = tallyPullPage(emptyPullTally(), { changes: { subscriptions: [{ id: 'sub_netflix' }] }, deletions: [] });
    expect(detectionAfterPull(report(1), decided, false)).toEqual({ detect: null, replan: true });
  });

  test('a run waiting for the first pull runs once that pull completes, not before', () => {
    expect(detectionAfterPull(report(0, false), emptyPullTally(), true)).toEqual({ detect: null, replan: false });
    expect(detectionAfterPull(report(0, true), emptyPullTally(), true)).toEqual({ detect: 'sync', replan: false });
  });

  test('every charge is tagged with where it came from: the bank, a recorded import, or by hand', () => {
    const sourceOf = transactionSourceOf([{ from: '2026-10-01T10:00:00.000Z', to: '2026-10-01T10:00:02.500Z' }]);
    expect(sourceOf({ id: 'plaid_abc', createdAt: '2026-10-01T10:00:01.000Z' })).toBe('bank');
    expect(sourceOf({ id: 'tx_1', createdAt: '2026-10-01T10:00:01.000Z' })).toBe('import');
    expect(sourceOf({ id: 'tx_2', createdAt: '2026-10-01T10:00:02.500Z' })).toBe('import');
    expect(sourceOf({ id: 'tx_3', createdAt: '2026-10-01T10:00:03.000Z' })).toBe('manual');
    expect(sourceOf({ id: 'tx_4', createdAt: null })).toBe('manual');
  });

  test('an import, an email sync and a pull each run detection by themselves, not only a Scan tap', () => {
    const src = (f: string) =>
      readFileSync(join(import.meta.dir, '..', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const importScreen = src('app/import.tsx');
    // After the rows are saved, with the batch they were saved in.
    const saved = importScreen.indexOf('await addTransaction(');
    const recorded = importScreen.indexOf('recordImportBatch(startedAt');
    const detected = importScreen.indexOf("runDetection('import')");
    expect(saved).toBeGreaterThan(-1);
    expect(recorded).toBeGreaterThan(saved);
    expect(detected).toBeGreaterThan(recorded);

    expect(src('lib/email-connections.ts')).toMatch(/runDetection\('email'\)/);
    const cloud = src('lib/cloud-sync.ts');
    expect(cloud).toMatch(/tallyPullPage\(pullTally, page\)/);
    expect(cloud).toMatch(/runDetection\('bank'\)/);
    expect(cloud).toMatch(/runDetection\('sync'\)/);

    const layout = src('app/_layout.tsx');
    expect(layout).toMatch(/runDetection\('startup'\)/);
    expect(layout).toMatch(/syncEmailIfDue\(\)/);
  });
});

test('detection runner: an imported row is known as imported on every device by its id', () => {
  const sourceOf = transactionSourceOf([]);
  expect(sourceOf({ id: 'imp_1760000000000_ab12cd34e', createdAt: '2026-10-01T10:00:00.000Z' })).toBe('import');
  expect(sourceOf({ id: 'plaid_abc', createdAt: null })).toBe('bank');
  expect(sourceOf({ id: 'tx_1760000000000_ab12cd34e', createdAt: '2026-10-01T10:00:00.000Z' })).toBe('manual');
});

