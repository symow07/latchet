/**
 * End to end: the phone's real sync against the real server.
 *
 * Every "phone" here is the app's own code from mobile/src — its per-user
 * schema and seed, its sync engine and SQLite store, on bun:sqlite — talking
 * to the backend app in process (index.ts) on Postgres, with a real session
 * cookie from a real sign-up or sign-in. Local edits are db.ts's writes
 * (mirrored in test-support/phone-writes.ts, which says why). Server-side
 * writes go through the recurring job, the run-now endpoint and bank sync, as
 * in production. Nothing in between is stubbed except the bank: a scripted
 * provider stands in for Plaid.
 *
 * What it proves, against the four structural breaks:
 *   two devices      a second phone, or a reinstall, gets everything; edits
 *                    and deletes converge; a phone whose clock is behind ends
 *                    up holding the server's version (contract rev 5).
 *   server-created   the recurring job, run-now and bank sync reach both
 *                    phones' ledgers once, with the right balances.
 *   separation       one user's phones never see another user's rows; a new
 *                    phone's seeded defaults never beat real server settings
 *                    and never add a second default account.
 *
 * Timing. A pull returns every row visible when it is read, so a row written
 * before a sync arrives in that sync — no test waits for arrival. The cursor
 * is held PULL_SAFETY_LAG_MS behind the database clock, so a pull may also
 * re-send rows written in the last few seconds (applied idempotently). Tests
 * therefore judge "exactly once" by the ledger a phone ends with, and judge
 * what a pull carried only where the lag cannot add to it, or after waiting
 * it out (the clock-skew test).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { app } from "./index";
import { prisma } from "./prisma";
import { processRecurring } from "./jobs/recurring-processor";
import { dbToday } from "./lib/distributed/clock";
import { advanceDays, anchorDayOf, computeNextDate } from "./lib/recurrence";
import { bankAccountId, persistConnection, syncConnectionTransactions, transactionId } from "./lib/bank-sync";
import type { BankProvider, ProviderAccount, ProviderTransaction, TransactionPage } from "./lib/bank-providers";
import { PULL_SAFETY_LAG_MS } from "./lib/sync/constants";
import { openDevice, type Device, type DeviceOptions, type LocalRow, type SyncResult } from "./test-support/device";
import { EPOCH_ISO, SYNC_META, defaultAccountId } from "./test-support/phone";
import { deleteUsers, request, signIn, signUp, type E2EUser } from "./test-support/session";

const TIMEOUT = 30_000;

const users: E2EUser[] = [];
const phones: Device[] = [];
/** Accounts whose sign-up session a phone already holds. */
const signedUpSessionTaken = new Set<string>();

afterAll(async () => {
  for (const p of phones) p.close();
  await deleteUsers(users);
});

async function newUser(label: string): Promise<E2EUser> {
  const user = await signUp(app, label);
  users.push(user);
  return user;
}

/** A phone for `user`: the first one holds the sign-up session, every other signs in. */
async function phone(user: E2EUser, label: string, options: Omit<DeviceOptions, "label"> = {}): Promise<Device> {
  let session = user.session;
  if (signedUpSessionTaken.has(user.id)) session = await signIn(app, user);
  signedUpSessionTaken.add(user.id);
  const device = openDevice(app, session, { label, ...options });
  phones.push(device);
  return device;
}

/** One sync cycle that must run clean to the end. */
async function synced(p: Device): Promise<SyncResult> {
  const result = await p.sync();
  expect({ phone: p.label, errors: result.report.errors }).toEqual({ phone: p.label, errors: [] });
  expect(result.report.ok).toBe(true);
  expect(result.report.pulled.complete).toBe(true);
  return result;
}

/** A sync that has nothing left to do: nothing to push, nothing in the pull that changes the phone. */
async function quiet(p: Device): Promise<void> {
  const r = await synced(p);
  expect({ phone: p.label, pushed: r.report.pushed.rows, changed: r.report.pulled.changed, skipped: r.report.pulled.skipped })
    .toEqual({ phone: p.label, pushed: 0, changed: 0, skipped: 0 });
  expect(await p.pending()).toEqual({ dirty: [], tombstones: [] });
}

async function balances(p: Device): Promise<Record<string, number>> {
  return Object.fromEntries((await p.rows("accounts")).map((a) => [a.id, a.balance as number]));
}

async function serverBalances(userId: string): Promise<Record<string, number>> {
  const rows = await prisma.bankAccount.findMany({ where: { userId }, select: { id: true, balance: true } });
  return Object.fromEntries(rows.map((a) => [a.id, a.balance]));
}

/** Sorted here, not by Postgres: its collation need not order ids the way the phone's SQLite does. */
async function serverTransactionIds(userId: string): Promise<string[]> {
  const rows = await prisma.transaction.findMany({ where: { userId }, select: { id: true } });
  return sorted(rows.map((r) => r.id));
}

/** The server's copy of one transaction, in the phone's comparison shape. */
async function serverTransaction(id: string): Promise<LocalRow> {
  const t = await prisma.transaction.findUniqueOrThrow({ where: { id } });
  return {
    id: t.id,
    clientUpdatedAt: t.clientUpdatedAt.toISOString(),
    amount: t.amount,
    category: t.category,
    type: t.type,
    isImpulse: t.isImpulse ? 1 : 0,
    note: t.note,
    dateISO: t.dateISO,
    accountId: t.accountId,
    currency: t.currency,
    createdAt: t.createdAt.toISOString(),
  };
}

/** The id the recurring job and run-now both give an occurrence (I-DIST). */
const occurrence = (seriesId: string, date: string) => `tx_rec_${seriesId}_${date}`;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const sorted = (xs: string[]) => [...xs].sort();
const tick = () => Bun.sleep(5);

const spending = (over: Partial<Parameters<Device["write"]["addTransaction"]>[0]> = {}) => ({
  amount: 10,
  category: "Food",
  type: "Expense" as const,
  isImpulse: false,
  dateISO: "2026-10-10",
  ...over,
});

const subscription = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  merchantDisplay: "Netflix",
  merchantNormalized: "netflix",
  cadence: "monthly" as const,
  typicalAmount: 15.49,
  currency: "USD",
  confidenceScore: 0.92,
  lastChargedAt: "2026-10-03",
  nextExpectedAt: "2026-11-03",
  status: "confirmed" as const,
  cancelUrl: "https://www.netflix.com/cancelplan",
  cancelNotes: null,
  source: "transaction" as const,
  ...over,
});

describe("two devices", () => {
  test("a transaction, an account, a category, a subscription and a settings change made on phone 1 appear on phone 2", async () => {
    const user = await newUser("e2e-create");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");
    await synced(p1);
    await synced(p2);

    const checking = await p1.write.createAccount({
      name: "Checking", type: "checking", balance: 1000, currency: "USD", color: "#3b82f6", icon: "bank",
    });
    const groceries = await p1.write.addTransaction(
      spending({ amount: 42.5, category: "Groceries", isImpulse: true, note: "market", dateISO: "2026-10-09", accountId: checking })
    );
    const salary = await p1.write.addTransaction(
      spending({ amount: 2500, category: "Salary", type: "Income", dateISO: "2026-10-01", accountId: checking })
    );
    // No account named: db.ts books it to the default account.
    const treats = await p1.write.addTransaction(spending({ amount: 3.75, category: "Pets", dateISO: "2026-10-10" }));
    await p1.write.addCustomCategory({ name: "Pets", icon: "paw", color: "#f97316" });
    await p1.write.upsertSubscription(subscription("sub_netflix"));
    await p1.write.updateSettings({
      monthlyBudget: 1800, currency: "EUR", currencySymbol: "€", locale: "fr", showTimeCost: true, hourlyValue: 30, primaryGoal: "save",
    });

    const sent = await synced(p1);
    expect(sent.statuses("transactions")).toEqual({ [groceries]: "applied", [salary]: "applied", [treats]: "applied" });
    expect(sent.statuses("accounts")).toEqual({ [checking]: "applied" });
    expect(sent.statuses("categories")).toEqual({ Pets: "applied" });
    expect(sent.statuses("subscriptions")).toEqual({ sub_netflix: "applied" });
    expect(sent.statuses("settings")).toEqual({ settings: "applied" });
    expect(await p1.pending()).toEqual({ dirty: [], tombstones: [] });

    const got = await synced(p2);
    expect(got.report.pushed.rows).toBe(0);
    // Nothing of these existed before phone 2's last pull, so the lag cannot add to them.
    expect(sorted(got.pulledIds("transactions"))).toEqual(sorted([groceries, salary, treats]));
    expect(got.pulledIds("categories")).toEqual(["Pets"]);
    expect(got.pulledIds("subscriptions")).toEqual(["sub_netflix"]);
    expect(got.pulledIds("accounts")).toContain(checking);

    const p1Rows = await p1.view();
    expect(await p2.view()).toEqual(p1Rows);
    expect(await p2.pending()).toEqual({ dirty: [], tombstones: [] });

    // The rows themselves, not only their agreement.
    const byId = Object.fromEntries((await p2.rows("transactions")).map((t) => [t.id, t]));
    expect(byId[groceries]).toMatchObject({
      amount: 42.5, category: "Groceries", type: "Expense", isImpulse: 1, note: "market", dateISO: "2026-10-09", accountId: checking, currency: "USD",
    });
    expect(byId[salary]).toMatchObject({ amount: 2500, type: "Income", isImpulse: 0, note: null, accountId: checking });
    expect(byId[treats]).toMatchObject({ amount: 3.75, category: "Pets", accountId: p2.defaultAccountId });
    for (const id of [groceries, salary, treats]) expect(byId[id]).toEqual(await serverTransaction(id));
    expect(await p2.rows("categories")).toEqual([
      { id: "Pets", clientUpdatedAt: p1Rows.categories[0]!.clientUpdatedAt, icon: "paw", color: "#f97316", createdAt: p1Rows.categories[0]!.createdAt },
    ]);
    const { id: _subId, ...subFields } = subscription("sub_netflix");
    expect(await p2.rows("subscriptions")).toEqual([{
      id: "sub_netflix", ...subFields,
      clientUpdatedAt: p1Rows.subscriptions[0]!.clientUpdatedAt, createdAt: p1Rows.subscriptions[0]!.createdAt,
    }]);
    const p1Checking = p1Rows.accounts.find((a) => a.id === checking)!;
    expect((await p2.rows("accounts")).find((a) => a.id === checking)).toEqual({
      id: checking, name: "Checking", type: "checking", openingBalance: 1000, currency: "USD", color: "#3b82f6", icon: "bank",
      isDefault: 0, balance: 3457.5, clientUpdatedAt: p1Checking.clientUpdatedAt, createdAt: p1Checking.createdAt,
    });
    const settings = await p2.row("settings", "settings");
    expect(settings).toMatchObject({
      monthlyBudget: 1800, currency: "EUR", currencySymbol: "€", locale: "fr", showTimeCost: 1, hourlyValue: 30, primaryGoal: "save",
      spendingStyle: "moderate", dirty: 0, syncError: null,
    });
    expect(settings!.clientUpdatedAt).not.toBe(EPOCH_ISO);

    // Balances are derived on both sides from the same ledger.
    const expected = { [checking]: 1000 - 42.5 + 2500, [p2.defaultAccountId]: -3.75 };
    expect(await balances(p2)).toEqual(expected);
    expect(await balances(p1)).toEqual(expected);
    expect(await serverBalances(user.id)).toEqual(expected);
  }, TIMEOUT);

  test("an edit on phone 2 and deletes on phone 1 converge on both", async () => {
    const user = await newUser("e2e-converge");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");

    const savings = await p1.write.createAccount({
      name: "Savings", type: "savings", balance: 500, currency: "USD", color: "#22c55e", icon: "piggy",
    });
    const lunch = await p1.write.addTransaction(spending({ amount: 20, category: "Food", note: "lunch" }));
    const taxi = await p1.write.addTransaction(spending({ amount: 15, category: "Transport" }));
    const interest = await p1.write.addTransaction(spending({ amount: 250, category: "Interest", type: "Income", accountId: savings }));
    await p1.write.addCustomCategory({ name: "Gym", icon: "dumbbell", color: "#ef4444" });
    await p1.write.upsertSubscription(subscription("sub_spotify", { merchantDisplay: "Spotify", merchantNormalized: "spotify", typicalAmount: 10.99 }));
    await synced(p1);
    await synced(p2);
    expect(await p2.view()).toEqual(await p1.view());

    // Phone 2 edits; phone 1 deletes other rows, including the account a transaction is booked to.
    // An edit carries the transaction's account, as the edit screen sends it.
    await p2.write.updateTransaction(lunch, spending({ amount: 27.75, category: "Dining", note: "edited on phone 2", accountId: p2.defaultAccountId }));
    await p2.write.updateSubscriptionStatus("sub_spotify", "canceled");
    await p2.write.updateSettings({ monthlyBudget: 950 });
    await p1.write.deleteTransaction(taxi);
    await p1.write.deleteCustomCategory("Gym");
    await p1.write.deleteAccount(savings);

    const edits = await synced(p2);
    expect(edits.statuses("transactions")).toEqual({ [lunch]: "applied" });
    expect(edits.statuses("subscriptions")).toEqual({ sub_spotify: "applied" });
    expect(edits.statuses("settings")).toEqual({ settings: "applied" });

    const deletes = await synced(p1);
    expect(deletes.statuses("transactions")).toEqual({ [taxi]: "applied" });
    expect(deletes.statuses("categories")).toEqual({ Gym: "applied" });
    expect(deletes.statuses("accounts")).toEqual({ [savings]: "applied" });

    const back = await synced(p2);
    expect(sorted(back.pulledDeletions())).toEqual(sorted([`transactions:${taxi}`, "categories:Gym", `accounts:${savings}`]));

    for (const p of [p1, p2]) {
      expect(ids(await p.rows("transactions"))).toEqual(sorted([lunch, interest]));
      const tx = Object.fromEntries((await p.rows("transactions")).map((t) => [t.id, t]));
      expect(tx[lunch]).toMatchObject({ amount: 27.75, category: "Dining", note: "edited on phone 2", accountId: p.defaultAccountId });
      // The server unlinked it when its account went (ON DELETE SET NULL), on every phone.
      expect(tx[interest]).toMatchObject({ amount: 250, accountId: null });
      expect(await p.rows("categories")).toEqual([]);
      expect(ids(await p.rows("accounts"))).toEqual([p.defaultAccountId]);
      expect(await balances(p)).toEqual({ [p.defaultAccountId]: -27.75 });
      expect(await p.rows("subscriptions")).toMatchObject([{ id: "sub_spotify", status: "canceled" }]);
      expect(await p.row("settings", "settings")).toMatchObject({ monthlyBudget: 950, dirty: 0 });
    }
    expect(await p1.view()).toEqual(await p2.view());
    expect(await serverTransactionIds(user.id)).toEqual(sorted([lunch, interest]));
    expect(await serverBalances(user.id)).toEqual({ [p1.defaultAccountId]: -27.75 });
    const tombstones = await prisma.syncTombstone.findMany({ where: { userId: user.id }, select: { entity: true, syncId: true } });
    expect(sorted(tombstones.map((t) => `${t.entity}:${t.syncId}`))).toEqual(
      sorted([`transactions:${taxi}`, "categories:Gym", `accounts:${savings}`])
    );
    await quiet(p1);
    await quiet(p2);
  }, TIMEOUT);

  test("an edit and a delete of the same row: the later one wins, on both phones and the server", async () => {
    const user = await newUser("e2e-same-row");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");
    const doomed = await p1.write.addTransaction(spending({ amount: 12, note: "edited, then deleted" }));
    const revived = await p1.write.addTransaction(spending({ amount: 8, note: "deleted, then edited" }));
    await synced(p1);
    await synced(p2);

    // doomed: edited on phone 2, then deleted on phone 1 — the delete is later.
    await p2.write.updateTransaction(doomed, spending({ amount: 99, note: "too late", accountId: p2.defaultAccountId }));
    await tick();
    await p1.write.deleteTransaction(doomed);
    // revived: deleted on phone 1, then edited on phone 2 — the edit is later.
    await p1.write.deleteTransaction(revived);
    await tick();
    await p2.write.updateTransaction(revived, spending({ amount: 77, note: "kept", accountId: p2.defaultAccountId }));

    const first = await synced(p1);
    expect(first.statuses("transactions")).toEqual({ [doomed]: "applied", [revived]: "applied" });
    const second = await synced(p2);
    expect(second.statuses("transactions")).toEqual({ [doomed]: "stale", [revived]: "applied" });
    expect(second.pulledDeletions()).toEqual([`transactions:${doomed}`]);
    await synced(p1);

    const expected = await serverTransaction(revived);
    expect(expected).toMatchObject({ amount: 77, note: "kept" });
    for (const p of [p1, p2]) {
      expect(await p.rows("transactions")).toEqual([expected]);
      expect(await balances(p)).toEqual({ [p.defaultAccountId]: -77 });
    }
    expect(await serverTransactionIds(user.id)).toEqual([revived]);
    const tombstones = await prisma.syncTombstone.findMany({ where: { userId: user.id, entity: "transactions" }, select: { syncId: true } });
    expect(tombstones.map((t) => t.syncId)).toEqual([doomed]);
    await quiet(p1);
    await quiet(p2);
  }, TIMEOUT);

  test("a reinstalled phone restores everything synced, over several pages, with the same balances", async () => {
    const user = await newUser("e2e-reinstall");
    // Phone 1 pushes in batches of two: its first sync takes ten requests.
    const p1 = await phone(user, "phone 1", { pushBatchSize: 2 });
    const p2 = await phone(user, "phone 2");

    const checking = await p1.write.createAccount({ name: "Checking", type: "checking", balance: 1200, currency: "USD", color: "#3b82f6", icon: "bank" });
    const savings = await p1.write.createAccount({ name: "Savings", type: "savings", balance: 5000, currency: "USD", color: "#22c55e", icon: "piggy" });
    const card = await p1.write.createAccount({ name: "Card", type: "credit", balance: -300, currency: "USD", color: "#ef4444", icon: "card" });
    const p1Spend: [number, string | null, "Expense" | "Income"][] = [
      [45.5, checking, "Expense"], [120.25, checking, "Expense"], [3000, checking, "Income"], [64, card, "Expense"],
      [18.75, card, "Expense"], [300, card, "Income"], [250, savings, "Income"], [1000, savings, "Expense"],
      [9.5, null, "Expense"], [14.25, null, "Expense"], [60, null, "Income"], [7, checking, "Expense"],
    ];
    const p1Tx: string[] = [];
    for (const [amount, accountId, type] of p1Spend) {
      p1Tx.push(await p1.write.addTransaction(spending({ amount, accountId, type, category: type === "Income" ? "Salary" : "Food" })));
    }
    await p1.write.addCustomCategory({ name: "Kids", icon: "baby", color: "#a855f7" });
    await p1.write.upsertSubscription(subscription("sub_netflix"));
    await p1.write.upsertSubscription(subscription("sub_gym", { merchantDisplay: "City Gym", merchantNormalized: "city gym", typicalAmount: 35, cancelUrl: null }));
    await p1.write.updateSettings({ monthlyBudget: 2200, monthlyIncome: 4100, savingsGoal: 600, spendingStyle: "frugal" });
    const uploaded = await synced(p1);
    expect([uploaded.report.pushed.requests, uploaded.report.pushed.rows, uploaded.report.pushed.applied]).toEqual([10, 20, 20]);
    await synced(p2);

    // Phone 2 adds its own and deletes one of phone 1's.
    const p2Tx = [
      await p2.write.addTransaction(spending({ amount: 22, accountId: checking, category: "Kids" })),
      await p2.write.addTransaction(spending({ amount: 5.5, category: "Kids" })),
    ];
    await p2.write.deleteTransaction(p1Tx[1]!);
    await p2.write.addCustomCategory({ name: "Travel", icon: "plane", color: "#0ea5e9" });
    await synced(p2);
    await synced(p1);
    const before = await p1.view();
    expect(await p2.view()).toEqual(before);

    const liveTx = sorted([...p1Tx.filter((id) => id !== p1Tx[1]), ...p2Tx]);
    expect(ids(before.transactions)).toEqual(liveTx);
    expect(ids(before.accounts)).toEqual(sorted([checking, savings, card, p1.defaultAccountId]));
    expect(ids(before.categories)).toEqual(["Kids", "Travel"]);
    expect(ids(before.subscriptions)).toEqual(["sub_gym", "sub_netflix"]);
    expect(before.settings).toMatchObject([{ id: "settings", monthlyBudget: 2200, monthlyIncome: 4100, savingsGoal: 600, spendingStyle: "frugal" }]);
    const expectedBalances = {
      [checking]: 1200 - 45.5 + 3000 - 7 - 22,
      [savings]: 5000 + 250 - 1000,
      [card]: -300 - 64 - 18.75 + 300,
      [p1.defaultAccountId]: -9.5 - 14.25 + 60 - 5.5,
    };
    expect(await balances(p1)).toEqual(expectedBalances);
    expect(await serverBalances(user.id)).toEqual(expectedBalances);

    // The app is deleted and installed again: a new, empty, freshly seeded database.
    p1.close();
    const reinstalled = await phone(user, "phone 1 reinstalled", { pullPageSize: 4 });
    const restore = await synced(reinstalled);
    // Its seeds (epoch settings, the Cash default account) lose to the server's rows.
    expect(restore.statuses("settings")).toEqual({ settings: "stale" });
    expect(restore.statuses("accounts")).toEqual({ [reinstalled.defaultAccountId]: "stale" });
    const total = Object.values(before).reduce((n, rows) => n + rows.length, 0);
    expect(total).toBe(1 + 2 + 4 + 13 + 2);
    expect(restore.report.pulled.fullResync).toBe(true);
    expect(restore.report.pulled.rows).toBe(total);
    expect(restore.report.pulled.pages).toBe(Math.ceil(total / 4));
    expect(restore.pulls.every((p) => p.response.fullResync)).toBe(true);

    expect(await reinstalled.view()).toEqual(before);
    expect(await balances(reinstalled)).toEqual(expectedBalances);
    expect(await reinstalled.pending()).toEqual({ dirty: [], tombstones: [] });
    expect((await reinstalled.rows("accounts")).filter((a) => a.isDefault === 1).map((a) => a.id)).toEqual([reinstalled.defaultAccountId]);
    expect(await reinstalled.row("transactions", p1Tx[1]!)).toBeNull();
    await quiet(reinstalled);
  }, TIMEOUT);

  test("a phone whose clock is ten minutes behind edits a row it already pulled, and ends up holding the server's version", async () => {
    const user = await newUser("e2e-clock");
    const p1 = await phone(user, "phone 1");
    const slow = await phone(user, "slow phone", { clockSkewMs: -10 * 60_000 });

    const groceries = await p1.write.addTransaction(spending({ amount: 40, category: "Groceries", note: "weekly shop" }));
    const rent = await p1.write.addTransaction(spending({ amount: 900, category: "Housing", note: "rent" }));
    await p1.write.updateSettings({ monthlyBudget: 1500 });
    await synced(p1);
    await synced(slow);
    expect(await slow.view()).toEqual(await p1.view());

    // Wait out the safety lag, then show the slow phone's cursor is past every
    // row: whatever its next pull carries, it carries because of the push.
    await Bun.sleep(PULL_SAFETY_LAG_MS + 300);
    await synced(slow);
    const idle = await synced(slow);
    expect([idle.report.pulled.rows, idle.report.pulled.deletions]).toEqual([0, 0]);

    // Edits stamped ten minutes ago by the slow clock: older than what the server holds.
    await slow.write.updateTransaction(groceries, spending({ amount: 4, category: "Groceries", note: "typo", accountId: slow.defaultAccountId }));
    await slow.write.updateSettings({ monthlyBudget: 99 });
    await slow.write.deleteTransaction(rent);
    const edited = await slow.row("transactions", groceries);
    expect(edited).toMatchObject({ amount: 4, dirty: 1 });
    expect(Date.parse(edited!.clientUpdatedAt as string)).toBeLessThan(Date.parse((await serverTransaction(groceries)).clientUpdatedAt as string));

    const r = await synced(slow);
    expect(r.statuses("transactions")).toEqual({ [groceries]: "stale", [rent]: "stale" });
    expect(r.statuses("settings")).toEqual({ settings: "stale" });
    // The server sent its winners back in the same cycle.
    expect(sorted(r.pulledIds("transactions"))).toEqual(sorted([groceries, rent]));
    expect(r.pulledIds("settings")).toEqual(["settings"]);

    const server = [await serverTransaction(groceries), await serverTransaction(rent)];
    expect(server[0]).toMatchObject({ amount: 40, note: "weekly shop" });
    expect(await slow.rows("transactions")).toEqual(sorted([groceries, rent]).map((id) => server.find((s) => s.id === id)!));
    expect(await slow.row("transactions", groceries)).toMatchObject({ amount: 40, note: "weekly shop", dirty: 0, syncError: null });
    expect(await slow.row("settings", "settings")).toMatchObject({ monthlyBudget: 1500, dirty: 0 });
    expect(await balances(slow)).toEqual({ [slow.defaultAccountId]: -940 });

    await synced(p1);
    expect(await p1.view()).toEqual(await slow.view());
    expect(await serverTransactionIds(user.id)).toEqual(sorted([groceries, rent]));
    expect(await serverBalances(user.id)).toEqual({ [p1.defaultAccountId]: -940 });
    await quiet(slow);
  }, TIMEOUT);
});

describe("server-created rows", () => {
  /** A recurring series created over REST, as the app's recurring screen does. */
  async function series(user: E2EUser, body: Record<string, unknown>): Promise<string> {
    const res = await request(app, user.session, "POST", "/api/v1/recurring", {
      category: "Bills", type: "Expense", currency: "USD", isImpulse: false, ...body,
    });
    expect(res.status).toBe(201);
    return res.json.id as string;
  }
  const runNow = (user: E2EUser, seriesId: string) => request(app, user.session, "POST", `/api/v1/recurring/${seriesId}/run`);

  /** Server-written stamps are UTC from the database clock: "now", not eight hours off. */
  function expectFresh(row: LocalRow) {
    for (const field of ["clientUpdatedAt", "createdAt"] as const) {
      expect(Math.abs(Date.parse(row[field] as string) - Date.now())).toBeLessThan(60_000);
    }
  }

  test("the recurring job's booking reaches both phones once, with the account balance", async () => {
    const user = await newUser("e2e-job");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");
    const checking = await p1.write.createAccount({ name: "Checking", type: "checking", balance: 1000, currency: "USD", color: "#3b82f6", icon: "bank" });
    await synced(p1);
    await synced(p2);

    const today = await dbToday();
    const rent = await series(user, { accountId: checking, name: "Rent", amount: 700, category: "Housing", frequency: "monthly", startDate: today, nextDate: today });
    expect(await processRecurring({ userIds: [user.id] })).toBe(1);

    const booked = occurrence(rent, today);
    const serverRow = await serverTransaction(booked);
    expect(serverRow).toMatchObject({
      amount: 700, category: "Housing", type: "Expense", isImpulse: 0, note: "[Auto] Rent", dateISO: today, accountId: checking, currency: "USD",
    });
    expectFresh(serverRow);

    for (const p of [p1, p2]) {
      const r = await synced(p);
      expect(r.pulledIds("transactions")).toEqual([booked]);
      expect(await p.rows("transactions")).toEqual([serverRow]);
      expect(await balances(p)).toEqual({ [checking]: 300, [p.defaultAccountId]: 0 });
    }

    // Later ticks the same day book nothing more.
    expect(await processRecurring({ userIds: [user.id] })).toBe(0);
    for (const p of [p1, p2]) {
      await synced(p);
      expect(await p.rows("transactions")).toEqual([serverRow]);
      expect(await balances(p)).toEqual({ [checking]: 300, [p.defaultAccountId]: 0 });
    }
    expect(await serverTransactionIds(user.id)).toEqual([booked]);
    expect(await serverBalances(user.id)).toEqual({ [checking]: 300, [p1.defaultAccountId]: 0 });
    const after = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rent } });
    expect([after.lastCreated, after.nextDate]).toEqual([today, computeNextDate(today, "monthly", anchorDayOf(today))]);
  }, TIMEOUT);

  test("run-now's booking reaches both phones once; a second tap books nothing", async () => {
    const user = await newUser("e2e-run-now");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");
    await synced(p1);
    await synced(p2);

    const today = await dbToday();
    const startDate = "2026-01-05";
    // Not due for three days: run-now books today's occurrence anyway, and
    // the series restarts from today (a week on), not from where it was.
    const gym = await series(user, {
      accountId: p1.defaultAccountId, name: "Gym", amount: 35.5, category: "Health", frequency: "weekly",
      startDate, nextDate: advanceDays(today, 3),
    });
    const booked = occurrence(gym, today);
    const nextDate = advanceDays(today, 7);

    expect(await runNow(user, gym)).toEqual({ status: 201, json: { transactionId: booked, nextDate } });
    const serverRow = await serverTransaction(booked);
    expect(serverRow).toMatchObject({ amount: 35.5, category: "Health", note: "[Auto] Gym", dateISO: today, accountId: p1.defaultAccountId });
    expectFresh(serverRow);

    for (const p of [p1, p2]) {
      const r = await synced(p);
      expect(r.pulledIds("transactions")).toEqual([booked]);
      expect(await p.rows("transactions")).toEqual([serverRow]);
      expect(await balances(p)).toEqual({ [p.defaultAccountId]: -35.5 });
    }

    expect(await runNow(user, gym)).toEqual({ status: 200, json: { transactionId: booked, nextDate } });
    expect(await processRecurring({ userIds: [user.id] })).toBe(0);
    for (const p of [p1, p2]) {
      await synced(p);
      expect(await p.rows("transactions")).toEqual([serverRow]);
      expect(await balances(p)).toEqual({ [p.defaultAccountId]: -35.5 });
    }
    expect(await serverTransactionIds(user.id)).toEqual([booked]);
    expect((await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: gym } })).nextDate).toBe(nextDate);
  }, TIMEOUT);

  test("a bank sync through a fake provider reaches both phones once, with the bank's balance", async () => {
    const user = await newUser("e2e-bank");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");
    await synced(p1);
    await synced(p2);

    // A scripted bank: the test says what it reports before each sync.
    const tag = crypto.randomUUID().slice(0, 8);
    const ext = (name: string) => `${tag}-${name}`;
    const bank: { accounts: ProviderAccount[]; pages: TransactionPage[] } = { accounts: [], pages: [] };
    const provider: BankProvider = {
      id: `fake${tag}`,
      isConfigured: () => true,
      createLinkSession: async () => ({ linkToken: "lt", hostedUrl: null, expiresAt: null }),
      exchange: async () => ({ externalId: `item_${tag}`, accessToken: "access" }),
      listAccounts: async () => bank.accounts.map((a) => ({ ...a })),
      syncTransactions: async () => bank.pages.shift() ?? { added: [], modified: [], removedExternalIds: [], cursor: "end", hasMore: false },
      removeConnection: async () => {},
      verifyWebhook: async () => ({ ok: true }),
      parseWebhook: () => ({ kind: "ignored" }),
    };
    const account = (name: string, label: string, type: string, balance: number): ProviderAccount =>
      ({ externalId: ext(name), name: label, mask: "4321", type, balance, currency: "USD" });
    const charge = (id: string, amount: number, type: "Expense" | "Income", accountName = "chk"): ProviderTransaction =>
      ({ externalId: id, accountExternalId: ext(accountName), amount, type, category: "Shopping", note: `bank ${id}`, dateISO: "2026-10-08", currency: "USD" });
    const page = (p: Partial<TransactionPage>): TransactionPage =>
      ({ added: [], modified: [], removedExternalIds: [], cursor: `c-${crypto.randomUUID()}`, hasMore: false, ...p });

    const chk = bankAccountId(provider.id, ext("chk"));
    const sav = bankAccountId(provider.id, ext("sav"));
    const tx = (id: string) => transactionId(provider.id, id);

    bank.accounts = [account("chk", "Everyday", "checking", 1000), account("sav", "Rainy Day", "savings", 2500)];
    bank.pages = [
      page({ added: [charge("t1", 50, "Expense"), charge("t2", 200, "Income")], hasMore: true }),
      page({ added: [charge("t3", 30, "Expense"), charge("s1", 100, "Income", "sav")] }),
    ];
    const item = await persistConnection(user.id, provider, { externalId: `item_${tag}`, accessToken: "access" });

    for (const p of [p1, p2]) {
      await synced(p);
      expect(ids(await p.rows("transactions"))).toEqual(sorted([tx("t1"), tx("t2"), tx("t3"), tx("s1")]));
      for (const id of ["t1", "t2", "t3", "s1"]) expect(await p.row("transactions", tx(id))).toEqual({ ...(await serverTransaction(tx(id))), dirty: 0, syncError: null });
      expect(await p.rows("accounts")).toMatchObject([
        { id: chk, name: "Everyday ••4321", type: "checking", openingBalance: 1000 - 200 + 50 + 30, balance: 1000 },
        { id: sav, name: "Rainy Day ••4321", type: "savings", openingBalance: 2400, balance: 2500 },
        { id: p.defaultAccountId, balance: 0 },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)));
    }

    // The pending 50 posts at 60, the 200 is reversed, 15 is new and 30 is
    // delivered again; the bank now reports 485.
    bank.accounts = [account("chk", "Everyday", "checking", 485), account("sav", "Rainy Day", "savings", 2500)];
    bank.pages = [page({
      added: [charge("t4", 15, "Expense"), charge("t3", 30, "Expense")],
      modified: [charge("t1", 60, "Expense")],
      removedExternalIds: ["t2"],
    })];
    expect(await syncConnectionTransactions(item.id, provider)).toBe(1);

    for (const p of [p1, p2]) {
      const r = await synced(p);
      expect(r.pulledDeletions()).toEqual([`transactions:${tx("t2")}`]);
      expect(ids(await p.rows("transactions"))).toEqual(sorted([tx("t1"), tx("t3"), tx("t4"), tx("s1")]));
      expect(await p.row("transactions", tx("t1"))).toMatchObject({ amount: 60, accountId: chk, dirty: 0 });
      expect(await p.row("transactions", tx("t4"))).toMatchObject({ amount: 15, accountId: chk, note: "bank t4" });
      expect(await balances(p)).toEqual({ [chk]: 485, [sav]: 2500, [p.defaultAccountId]: 0 });
      expect((await p.row("accounts", chk))!.openingBalance).toBe(485 + 60 + 30 + 15);
    }
    expect(await p1.view()).toEqual(await p2.view());
    expect(await serverBalances(user.id)).toEqual({ [chk]: 485, [sav]: 2500, [p1.defaultAccountId]: 0 });
    await quiet(p1);
    await quiet(p2);
  }, TIMEOUT);

  test("the job and run-now on the same day book one occurrence, in either order or at once", async () => {
    const user = await newUser("e2e-job-and-run-now");
    const p1 = await phone(user, "phone 1");
    const p2 = await phone(user, "phone 2");
    await synced(p1);
    await synced(p2);
    const today = await dbToday();
    const due = (name: string, amount: number) =>
      series(user, { accountId: p1.defaultAccountId, name, amount, frequency: "monthly", startDate: today, nextDate: today });

    // The job first, then a tap on run-now.
    const water = await due("Water", 100);
    expect(await processRecurring({ userIds: [user.id] })).toBe(1);
    expect(await runNow(user, water)).toMatchObject({ status: 200, json: { transactionId: occurrence(water, today) } });

    // A tap first, then the job.
    const power = await due("Power", 60);
    expect(await runNow(user, power)).toMatchObject({ status: 201, json: { transactionId: occurrence(power, today) } });
    expect(await processRecurring({ userIds: [user.id] })).toBe(0);

    // Both at the same moment.
    const phoneBill = await due("Phone", 35);
    const [jobBooked, tap] = await Promise.all([processRecurring({ userIds: [user.id] }), runNow(user, phoneBill)]);
    expect([200, 201]).toContain(tap.status);
    expect(tap.json.transactionId).toBe(occurrence(phoneBill, today));
    expect(jobBooked + (tap.status === 201 ? 1 : 0)).toBe(1);

    const booked = sorted([occurrence(water, today), occurrence(power, today), occurrence(phoneBill, today)]);
    expect(await serverTransactionIds(user.id)).toEqual(booked);
    for (const p of [p1, p2]) {
      await synced(p);
      expect(await p.rows("transactions")).toEqual(await Promise.all(booked.map(serverTransaction)));
      expect(await balances(p)).toEqual({ [p.defaultAccountId]: -195 });
    }
    expect(await serverBalances(user.id)).toEqual({ [p1.defaultAccountId]: -195 });
  }, TIMEOUT);
});

describe("separation", () => {
  test("two users, each with their own phone, never receive each other's rows", async () => {
    const alice = await newUser("e2e-alice");
    const bob = await newUser("e2e-bob");
    const pa = await phone(alice, "alice's phone");
    const pb = await phone(bob, "bob's phone");

    // The same category name and subscription id on both: sync ids are per user.
    const aliceChecking = await pa.write.createAccount({ name: "Checking", type: "checking", balance: 700, currency: "USD", color: "#3b82f6", icon: "bank" });
    const aliceTx = await pa.write.addTransaction(spending({ amount: 64, category: "Gym", accountId: aliceChecking, note: "alice" }));
    await pa.write.addCustomCategory({ name: "Gym", icon: "dumbbell", color: "#ef4444" });
    await pa.write.upsertSubscription(subscription("sub_shared_id", { typicalAmount: 11 }));
    await pa.write.updateSettings({ monthlyBudget: 1111, locale: "fr" });

    const bobChecking = await pb.write.createAccount({ name: "Checking", type: "checking", balance: 50, currency: "EUR", color: "#000000", icon: "bank" });
    const bobTx = await pb.write.addTransaction(spending({ amount: 7, category: "Gym", accountId: bobChecking, note: "bob" }));
    await pb.write.addCustomCategory({ name: "Gym", icon: "bike", color: "#10b981" });
    await pb.write.upsertSubscription(subscription("sub_shared_id", { typicalAmount: 22, merchantDisplay: "Bob's Netflix" }));
    await pb.write.updateSettings({ monthlyBudget: 2222, locale: "zh" });

    // A server-created row for Alice only, booked to her account once the
    // server has it.
    const aSync = [await synced(pa)];
    const today = await dbToday();
    const res = await request(app, alice.session, "POST", "/api/v1/recurring", {
      accountId: aliceChecking, name: "Rent", amount: 500, category: "Housing", type: "Expense", frequency: "monthly", startDate: today, nextDate: today,
    });
    expect(res.status).toBe(201);
    const aliceRent = occurrence(res.json.id, today);
    expect((await request(app, alice.session, "POST", `/api/v1/recurring/${res.json.id}/run`)).status).toBe(201);

    // Bob also tries to reach Alice's rows: one under her transaction's id,
    // one booked to her account.
    pb.raw
      .query(`INSERT INTO transactions (id, amount, category, type, isImpulse, note, dateISO, createdAt, accountId, currency, clientUpdatedAt, dirty)
              VALUES (?, 1, 'Food', 'Expense', 0, 'not mine', '2026-10-10', ?, NULL, 'USD', ?, 1)`)
      .run(aliceTx, pb.now(), pb.now());
    const intoAlices = await pb.write.addTransaction(spending({ amount: 13, accountId: aliceChecking, note: "into alice's account" }));

    aSync.push(await synced(pa));
    const bSync = [await synced(pb)];
    expect(bSync[0]!.statuses("transactions")).toEqual({ [aliceTx]: "forbidden", [bobTx]: "applied", [intoAlices]: "applied" });
    // Bob's first pull is a snapshot of his account: exactly his rows.
    expect(sorted(bSync[0]!.pulledIds("transactions"))).toEqual(sorted([bobTx, intoAlices]));
    expect(sorted(bSync[0]!.pulledIds("accounts"))).toEqual(sorted([bobChecking, pb.defaultAccountId]));
    aSync.push(await synced(pa));
    bSync.push(await synced(pb));

    const aliceIds = {
      transactions: sorted([aliceTx, aliceRent]),
      accounts: sorted([aliceChecking, pa.defaultAccountId]),
    };
    const bobIds = {
      transactions: sorted([aliceTx, bobTx, intoAlices]), // aliceTx here is Bob's own refused local row, never pulled
      accounts: sorted([bobChecking, pb.defaultAccountId]),
    };

    // What each phone received.
    for (const r of bSync) {
      for (const id of r.pulledIds("transactions")) expect([bobTx, intoAlices]).toContain(id);
      for (const id of r.pulledIds("accounts")) expect(bobIds.accounts).toContain(id);
      for (const row of r.pulledRows("categories")) expect(row).toMatchObject({ id: "Gym", icon: "bike" });
      for (const row of r.pulledRows("subscriptions")) expect(row).toMatchObject({ id: "sub_shared_id", typicalAmount: 22 });
      for (const row of r.pulledRows("settings")) expect(row).toMatchObject({ monthlyBudget: 2222 });
    }
    for (const r of aSync) {
      for (const id of r.pulledIds("transactions")) expect(aliceIds.transactions).toContain(id);
      for (const id of r.pulledIds("accounts")) expect(aliceIds.accounts).toContain(id);
      for (const row of r.pulledRows("categories")) expect(row).toMatchObject({ id: "Gym", icon: "dumbbell" });
      for (const row of r.pulledRows("subscriptions")) expect(row).toMatchObject({ id: "sub_shared_id", typicalAmount: 11 });
      for (const row of r.pulledRows("settings")) expect(row).toMatchObject({ monthlyBudget: 1111 });
    }

    // What each phone holds.
    expect(ids(await pa.rows("transactions"))).toEqual(aliceIds.transactions);
    expect(ids(await pa.rows("accounts"))).toEqual(aliceIds.accounts);
    expect(await pa.row("transactions", aliceTx)).toMatchObject({ amount: 64, note: "alice", accountId: aliceChecking, dirty: 0 });
    expect(await pa.rows("categories")).toMatchObject([{ id: "Gym", icon: "dumbbell", color: "#ef4444" }]);
    expect(await pa.rows("subscriptions")).toMatchObject([{ id: "sub_shared_id", typicalAmount: 11, merchantDisplay: "Netflix" }]);
    expect(await pa.row("settings", "settings")).toMatchObject({ monthlyBudget: 1111, locale: "fr" });
    expect(await balances(pa)).toEqual({ [aliceChecking]: 700 - 64 - 500, [pa.defaultAccountId]: 0 });

    expect(ids(await pb.rows("transactions"))).toEqual(bobIds.transactions);
    expect(ids(await pb.rows("accounts"))).toEqual(bobIds.accounts);
    // Bob's copy under Alice's id stays his own local row, refused and never overwritten by hers.
    expect(await pb.row("transactions", aliceTx)).toMatchObject({ amount: 1, note: "not mine", dirty: 1, syncError: "forbidden" });
    // Booked to an account that is not his: the server kept it, unlinked, and so does his phone.
    expect(await pb.row("transactions", intoAlices)).toMatchObject({ amount: 13, accountId: null, dirty: 0 });
    expect(await pb.rows("categories")).toMatchObject([{ id: "Gym", icon: "bike", color: "#10b981" }]);
    expect(await pb.rows("subscriptions")).toMatchObject([{ id: "sub_shared_id", typicalAmount: 22, merchantDisplay: "Bob's Netflix" }]);
    expect(await pb.row("settings", "settings")).toMatchObject({ monthlyBudget: 2222, locale: "zh" });
    expect(await balances(pb)).toEqual({ [bobChecking]: 43, [pb.defaultAccountId]: 0 });

    // And the server: Alice's row untouched, Bob's stray one in his own ledger.
    expect(await serverTransaction(aliceTx)).toMatchObject({ amount: 64, note: "alice", accountId: aliceChecking });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: aliceTx } })).userId).toBe(alice.id);
    expect(await serverTransactionIds(alice.id)).toEqual(aliceIds.transactions);
    expect(await serverTransactionIds(bob.id)).toEqual(sorted([bobTx, intoAlices]));
    expect(await serverBalances(alice.id)).toEqual({ [aliceChecking]: 136, [pa.defaultAccountId]: 0 });
    expect(await serverBalances(bob.id)).toEqual({ [bobChecking]: 43, [pb.defaultAccountId]: 0 });
  }, TIMEOUT);

  test("a new phone signing in to an account with server settings keeps them: its defaults lose, and there is one default account", async () => {
    const user = await newUser("e2e-returning");
    const p1 = await phone(user, "first phone");
    await p1.write.updateSettings({
      monthlyBudget: 2400, currency: "EUR", currencySymbol: "€", locale: "fr", spendingStyle: "frugal",
      primaryGoal: "reduce_debt", monthlyIncome: 3800, savingsGoal: 500,
    });
    await p1.write.updateAccount(p1.defaultAccountId, { name: "Wallet", balance: 300 });
    await p1.write.addTransaction(spending({ amount: 20 }));
    await synced(p1);
    const serverSettings = await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });
    expect(serverSettings).toMatchObject({ monthlyBudget: 2400, currency: "EUR", locale: "fr", primaryGoal: "reduce_debt" });

    // The new phone's own seed, plus the language it picked on first run —
    // a device default, still at the epoch.
    const p2 = await phone(user, "new phone");
    expect(await p2.write.applySettingsDefaults({ locale: "zh" })).toBe(true);
    expect(await p2.row("settings", "settings")).toMatchObject({ locale: "zh", monthlyBudget: 0, clientUpdatedAt: EPOCH_ISO, dirty: 1 });
    expect(await p2.rows("accounts")).toMatchObject([{ id: defaultAccountId(user.id), name: "Cash", openingBalance: 0, isDefault: 1, clientUpdatedAt: EPOCH_ISO }]);

    const r = await synced(p2);
    expect(r.statuses("settings")).toEqual({ settings: "stale" });
    expect(r.statuses("accounts")).toEqual({ [p2.defaultAccountId]: "stale" });

    expect(await p2.row("settings", "settings")).toMatchObject({
      monthlyBudget: 2400, currency: "EUR", currencySymbol: "€", locale: "fr", spendingStyle: "frugal", primaryGoal: "reduce_debt",
      monthlyIncome: 3800, savingsGoal: 500, clientUpdatedAt: serverSettings.clientUpdatedAt.toISOString(), dirty: 0, syncError: null,
    });
    const accounts = await p2.rows("accounts");
    expect(accounts.filter((a) => a.isDefault === 1)).toHaveLength(1);
    expect(accounts).toMatchObject([{ id: defaultAccountId(user.id), name: "Wallet", openingBalance: 300, isDefault: 1, balance: 280 }]);
    expect(await p2.view()).toEqual(await p1.view());

    // The server kept its settings — only re-stamped for pull order by the
    // stale answer (rev 5) — and still has one default account.
    const { serverUpdatedAt: stampedBefore, ...settingsBefore } = serverSettings;
    const { serverUpdatedAt: stampedAfter, ...settingsAfter } = await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });
    expect(settingsAfter).toEqual(settingsBefore);
    expect(stampedAfter.getTime()).toBeGreaterThan(stampedBefore.getTime());
    const serverAccounts = await prisma.bankAccount.findMany({ where: { userId: user.id }, select: { id: true, isDefault: true, name: true, balance: true } });
    expect(serverAccounts).toEqual([{ id: defaultAccountId(user.id), isDefault: true, name: "Wallet", balance: 280 }]);

    await synced(p1);
    expect(await p1.row("settings", "settings")).toMatchObject({ locale: "fr", monthlyBudget: 2400 });
    await quiet(p2);
  }, TIMEOUT);

  test("a pull cursor carried over from another user's phone yields only the caller's own snapshot", async () => {
    const alice = await newUser("e2e-cursor-alice");
    const bob = await newUser("e2e-cursor-bob");
    const pa = await phone(alice, "alice's phone");
    const pb = await phone(bob, "bob's phone");
    const aliceTx = await pa.write.addTransaction(spending({ amount: 31, note: "alice" }));
    const bobTx = await pb.write.addTransaction(spending({ amount: 17, note: "bob" }));
    await synced(pa);
    await synced(pb);
    const bobBefore = await pb.view();

    const aliceCursor = pa.raw.query(`SELECT value FROM sync_meta WHERE key = ?`).get(SYNC_META.cursor) as { value: string };
    expect(aliceCursor.value.length).toBeGreaterThan(0);
    pb.raw.query(`UPDATE sync_meta SET value = ? WHERE key = ?`).run(aliceCursor.value, SYNC_META.cursor);

    const r = await synced(pb);
    expect(r.report.pulled.fullResync).toBe(true);
    expect(r.pulledIds("transactions")).toEqual([bobTx]);
    expect(r.pulledIds("accounts")).toEqual([pb.defaultAccountId]);
    expect(r.pulledIds("transactions")).not.toContain(aliceTx);
    expect(await pb.view()).toEqual(bobBefore);
    expect(await serverTransactionIds(bob.id)).toEqual([bobTx]);
  }, TIMEOUT);
});

describe("the phone's transport against the real server", () => {
  test("a damaged cursor restarts with a snapshot, and a lost session stops the cycle with nothing lost", async () => {
    const user = await newUser("e2e-transport");
    const p = await phone(user, "phone");
    const kept = await p.write.addTransaction(spending({ amount: 6.5 }));
    await synced(p);
    const before = await p.view();

    // 400 invalid_cursor: the engine forgets the cursor and pulls a snapshot.
    p.raw.query(`UPDATE sync_meta SET value = ? WHERE key = ?`).run("not-a-cursor", SYNC_META.cursor);
    const reset = await synced(p);
    expect([reset.report.pulled.cursorReset, reset.report.pulled.fullResync]).toEqual([true, true]);
    expect(reset.pulls.map((x) => x.cursor)).toEqual([null]);
    expect(await p.view()).toEqual(before);

    // 401: the session is gone. The push fails, the pull is not tried, and
    // the new row waits, still dirty, for the next signed-in cycle.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    const waiting = await p.write.addTransaction(spending({ amount: 2 }));
    const refused = await p.sync();
    expect(refused.report.ok).toBe(false);
    expect(refused.report.errors).toHaveLength(1);
    expect(refused.report.errors[0]).toStartWith("push: push: HTTP 401");
    expect([refused.pushes.length, refused.pulls.length]).toEqual([0, 0]);
    expect(await p.pending()).toEqual({ dirty: [`transactions:${waiting}`], tombstones: [] });
    expect(await serverTransactionIds(user.id)).toEqual([kept]);
  }, TIMEOUT);
});

describe("a phone that predates the Phase 4 entities", () => {
  // The server syncs nine entities since Phase 4; phones already installed
  // know five. Their pull keeps working: rows of an entity they do not know
  // are skipped, a deletion of one is reported as an apply error (logged on
  // the phone) and passed over, and nothing of theirs changes. Once the phone
  // knows the entity (Phase 4, leaf 4.5) there is no error at all.
  test("recurring series, bills, budgets and net worth written and deleted on the server never stop its sync", async () => {
    const user = await newUser("e2e-p4-old-phone");
    const p = await phone(user, "phone");
    await p.write.addTransaction(spending({ amount: 8 }));
    await synced(p);
    const before = await p.view();

    // What the app's REST screens do today.
    const post = (path: string, body: unknown) => request(app, user.session, "POST", path, body);
    const rec = await post("/api/v1/recurring", {
      name: "Gym", amount: 30, category: "Health", type: "Expense", frequency: "weekly", startDate: "2026-10-01", nextDate: "2099-01-01",
    });
    const bill = await post("/api/v1/bill-reminders", { name: "Water", amount: 20, dueDay: 12, nextDueDate: "2099-01-12" });
    const budget = await post("/api/v1/category-budgets", { category: "Food", amount: 300 });
    const nw = await post("/api/v1/net-worth", { date: "2026-10-11", assets: 10, liabilities: 2 });
    expect([rec.status, bill.status, budget.status, nw.status]).toEqual([201, 201, 200, 201]);
    expect((await request(app, user.session, "DELETE", `/api/v1/bill-reminders/${bill.json.id}`)).status).toBe(200);
    expect((await request(app, user.session, "DELETE", `/api/v1/category-budgets/${budget.json.id}`)).status).toBe(200);

    const r = await p.sync();
    expect(r.report.pulled.complete).toBe(true);
    expect(r.report.errors.every((e) => /deletion of unknown entity (billReminders|categoryBudgets)/.test(e))).toBe(true);
    // The server did send them, under their own keys.
    expect(r.pulls.flatMap((x) => (x.response.changes as Record<string, { id: string }[]>).recurring ?? []).map((x) => x.id)).toContain(rec.json.id);
    expect(await p.view()).toEqual(before);
    expect(await p.pending()).toEqual({ dirty: [], tombstones: [] });
  }, TIMEOUT);
});
