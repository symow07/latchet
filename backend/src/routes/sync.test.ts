/**
 * The sync protocol over HTTP, through the real app (index.ts): session
 * middleware, both mounts, the error handlers and the database triggers.
 * Users and sessions are real; every id is unique to this file's users.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { app } from "../index";
import { prisma } from "../prisma";
import { EPOCH_ISO, MAX_SYNC_ROWS, PULL_SAFETY_LAG_MS, SYNC_ENTITIES } from "../lib/sync/constants";
import { CURSOR_MAX_AGE_MS, decodeCursor, encodeCursor, userTag } from "../lib/sync/cursor";
import { databaseNowMs } from "../lib/sync/sql";
import { client, createTestUser, deleteTestUsers, type TestUser } from "../lib/sync/testing";
import { processRecurring } from "../jobs/recurring-processor";
import { occurrenceId } from "../jobs/recurring-booking";
import { billReminderDeps, checkBillReminders, type BillReminderDeps } from "../jobs/bill-reminder-checker";
import { dbToday } from "../lib/distributed/clock";
import { advanceDays, anchorDayOf, computeNextDate } from "../lib/recurrence";

const users: TestUser[] = [];
async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  return { user: u, api: client(app, u), uid: (s: string) => `${s}_${u.id}` };
}
afterAll(() => deleteTestUsers(users));

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const status = (res: { json: any }, entity: string, id: string) =>
  res.json?.results?.[entity]?.find((r: { id: string }) => r.id === id)?.status;

const txRow = (id: string, cu: string, over: Record<string, unknown> = {}) => ({
  id, clientUpdatedAt: cu, amount: 20, category: "Food", type: "Expense", isImpulse: true, note: "lunch",
  dateISO: "2026-10-11", accountId: null, currency: "EUR", createdAt: cu, ...over,
});
const accRow = (id: string, cu: string, over: Record<string, unknown> = {}) => ({
  id, clientUpdatedAt: cu, name: "Wallet", type: "cash", openingBalance: 50, currency: "EUR",
  color: "#3B2A21", icon: "wallet", isDefault: false, createdAt: cu, ...over,
});
const settingsRow = (cu: string, over: Record<string, unknown> = {}) => ({
  id: "settings", clientUpdatedAt: cu, monthlyBudget: 1234, startingBalance: 0, hourlyValue: 0, showTimeCost: false,
  currency: "EUR", currencySymbol: "€", monthlyIncome: 3000, savingsGoal: 200, spendingStyle: "moderate",
  primaryGoal: "save", locale: "fr", ...over,
});
const subRow = (id: string, cu: string) => ({
  id, clientUpdatedAt: cu, merchantDisplay: "Netflix", merchantNormalized: "netflix", cadence: "monthly",
  typicalAmount: 13.99, currency: "EUR", confidenceScore: 80, lastChargedAt: "2026-10-01", nextExpectedAt: "2026-11-01",
  status: "confirmed", cancelUrl: null, cancelNotes: null, source: "transaction", createdAt: cu,
});
// The four Phase 4 entities, in their wire shape (I-WIRE-4).
const recRow = (id: string, cu: string, over: Record<string, unknown> = {}) => ({
  id, clientUpdatedAt: cu, accountId: null, name: "Rent", amount: 900, category: "Housing", type: "Expense",
  isImpulse: false, frequency: "monthly", startDate: "2026-10-01", nextDate: "2026-11-01", lastCreated: null,
  isActive: true, currency: "EUR", createdAt: cu, ...over,
});
const billRow = (id: string, cu: string, over: Record<string, unknown> = {}) => ({
  id, clientUpdatedAt: cu, name: "Power", amount: 60.5, dueDay: 5, category: "Bills", isRecurring: true,
  isPaid: false, paidAt: null, nextDueDate: "2026-11-05", createdAt: cu, ...over,
});
const budgetRow = (category: string, cu: string, over: Record<string, unknown> = {}) => ({
  id: category, clientUpdatedAt: cu, amount: 400, period: "monthly", createdAt: cu, ...over,
});
const nwRow = (id: string, cu: string, over: Record<string, unknown> = {}) => ({
  id, clientUpdatedAt: cu, date: "2026-10-11", assets: 1000, liabilities: 250, netWorth: 750,
  breakdown: '{"cash":1000,"card":-250}', createdAt: cu, ...over,
});

type Api = ReturnType<typeof client>;
/** Pull until !hasMore, returning every page. */
async function pullAll(api: Api, cursor: string | null, limit?: number) {
  const pages: any[] = [];
  let c = cursor;
  for (let i = 0; i < 500; i++) {
    const q = [limit ? `limit=${limit}` : "", c ? `cursor=${encodeURIComponent(c)}` : ""].filter(Boolean).join("&");
    const res = await api.get(`/api/v1/sync/pull${q ? `?${q}` : ""}`);
    expect(res.status).toBe(200);
    pages.push(res.json);
    c = res.json.cursor;
    if (!res.json.hasMore) return { pages, cursor: c! };
  }
  throw new Error("pull never finished");
}
const rowsOf = (pages: any[], entity: string) => pages.flatMap((p) => p.changes[entity] as any[]);
/** A resting cursor for `user` at `msAgo` before the database's now. */
const restingCursor = (user: TestUser, msAgo: number) =>
  encodeCursor({ mode: "rest", user: userTag(user.id), t: Date.now() - msAgo });

describe("mounts and auth", () => {
  test("both mounts answer, and only with a session", async () => {
    const { api } = await newUser("mounts");
    for (const base of ["/api/v1/sync", "/api/sync"]) {
      expect((await client(app).get(`${base}/pull`)).status).toBe(401);
      expect((await client(app).post(`${base}/push`, { changes: {} })).status).toBe(401);
      expect((await api.get(`${base}/pull?limit=1`)).status).toBe(200);
      expect((await api.post(`${base}/push`, { changes: {} })).status).toBe(200);
    }
  });

  test("the old bulk endpoints are gone from both mounts", async () => {
    const { api } = await newUser("oldbulk");
    for (const path of ["/api/v1/transactions/sync", "/api/transactions/sync", "/api/v1/accounts/sync", "/api/accounts/sync"]) {
      expect((await api.post(path, { transactions: [], accounts: [] })).status).toBe(404);
    }
  });
});

describe("push", () => {
  test("one of everything is applied and a fresh device's snapshot returns it, field for field", async () => {
    const { user, api, uid } = await newUser("everything");
    const t0 = iso(60_000);
    const push = await api.post("/api/v1/sync/push", { changes: {
      settings: [settingsRow(t0)],
      categories: [{ id: "Pets", clientUpdatedAt: t0, icon: "🐾", color: "#8A5F45", createdAt: t0 }],
      accounts: [accRow(uid("acc"), t0, { isDefault: true })],
      transactions: [txRow(uid("tx"), t0, { accountId: uid("acc") })],
      subscriptions: [subRow("sub_netflix", t0)],
      recurring: [recRow(uid("rec"), t0, { accountId: uid("acc") })],
      billReminders: [billRow(uid("bill"), t0, { isPaid: true, paidAt: "2026-10-05T09:30:00.123Z" })],
      categoryBudgets: [budgetRow("Food", t0)],
      netWorth: [nwRow(uid("nw"), t0)],
    } });
    expect(push.status).toBe(200);
    expect(push.json.results).toEqual({
      settings: [{ id: "settings", status: "applied" }],
      categories: [{ id: "Pets", status: "applied" }],
      accounts: [{ id: uid("acc"), status: "applied" }],
      transactions: [{ id: uid("tx"), status: "applied" }],
      subscriptions: [{ id: "sub_netflix", status: "applied" }],
      recurring: [{ id: uid("rec"), status: "applied" }],
      billReminders: [{ id: uid("bill"), status: "applied" }],
      categoryBudgets: [{ id: "Food", status: "applied" }],
      netWorth: [{ id: uid("nw"), status: "applied" }],
    });
    expect(push.json.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const snap = await api.get("/api/v1/sync/pull");
    expect(snap.json.fullResync).toBe(true);
    expect(snap.json.deletions).toEqual([]);
    expect(snap.json.changes.settings).toEqual([settingsRow(t0)]);
    expect(snap.json.changes.categories).toEqual([{ id: "Pets", clientUpdatedAt: t0, icon: "🐾", color: "#8A5F45", createdAt: t0 }]);
    expect(snap.json.changes.accounts).toEqual([accRow(uid("acc"), t0, { isDefault: true })]);
    expect(snap.json.changes.transactions).toEqual([txRow(uid("tx"), t0, { accountId: uid("acc") })]);
    expect(snap.json.changes.subscriptions).toEqual([subRow("sub_netflix", t0)]);
    expect(snap.json.changes.recurring).toEqual([recRow(uid("rec"), t0, { accountId: uid("acc") })]);
    expect(snap.json.changes.billReminders).toEqual([billRow(uid("bill"), t0, { isPaid: true, paidAt: "2026-10-05T09:30:00.123Z" })]);
    expect(snap.json.changes.categoryBudgets).toEqual([budgetRow("Food", t0)]);
    expect(snap.json.changes.netWorth).toEqual([nwRow(uid("nw"), t0)]);
    expect(Object.keys(snap.json.changes)).toEqual([...SYNC_ENTITIES]);
    // Accounts travel with openingBalance only; balance is derived on the server...
    expect("balance" in snap.json.changes.accounts[0]).toBe(false);
    const stored = await prisma.bankAccount.findUniqueOrThrow({ where: { id: uid("acc") } });
    expect(stored.balance).toBe(50 - 20);
    // ...and the settings row keeps the REST route's id convention.
    expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } })).id).toBe(`settings_${user.id}`);
  });

  test("last writer wins by clientUpdatedAt; a tie goes to the server", async () => {
    const { api, uid } = await newUser("lww");
    const t0 = iso(60_000);
    await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), t0)] } });
    const older = await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(120_000), { amount: 99 })] } });
    const tie = await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), t0, { amount: 98 })] } });
    const newer = await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(30_000), { amount: 25 })] } });
    expect([status(older, "transactions", uid("tx")), status(tie, "transactions", uid("tx")), status(newer, "transactions", uid("tx"))])
      .toEqual(["stale", "stale", "applied"]);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: uid("tx") } })).amount).toBe(25);
  });

  test("epoch-dated defaults never overwrite real settings or a real default account", async () => {
    const { user, api } = await newUser("epoch");
    const real = iso(60_000);
    const accId = `acc_default_${user.id}`;
    await api.post("/api/v1/sync/push", { changes: {
      settings: [settingsRow(real, { monthlyBudget: 900 })],
      accounts: [accRow(accId, real, { name: "Main", isDefault: true })],
    } });
    const fresh = await api.post("/api/v1/sync/push", { changes: {
      settings: [settingsRow(EPOCH_ISO, { monthlyBudget: 0, locale: "en" })],
      accounts: [accRow(accId, EPOCH_ISO, { name: "Cash", openingBalance: 0, isDefault: true })],
    } });
    expect(status(fresh, "settings", "settings")).toBe("stale");
    expect(status(fresh, "accounts", accId)).toBe("stale");
    const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });
    expect([settings.monthlyBudget, settings.locale]).toEqual([900, "fr"]);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: accId } })).name).toBe("Main");
  });

  test("one invalid row is reported invalid without failing the rows around it", async () => {
    const { api, uid } = await newUser("invalid");
    const res = await api.post("/api/v1/sync/push", { changes: { transactions: [
      txRow(uid("ok1"), iso()), txRow(uid("bad"), iso(), { amount: -5 }), { nonsense: true }, txRow(uid("ok2"), iso()),
    ] } });
    expect(res.status).toBe(200);
    expect(res.json.results.transactions).toEqual([
      { id: uid("ok1"), status: "applied" }, { id: uid("bad"), status: "invalid" },
      { id: "", status: "invalid" }, { id: uid("ok2"), status: "applied" },
    ]);
  });

  test("an envelope that is not a push is a 400; more than MAX_SYNC_ROWS rows is a 413", async () => {
    const { api, uid } = await newUser("limits");
    expect((await api.post("/api/v1/sync/push", { changes: { transactions: "x" } })).status).toBe(400);
    expect((await api.post("/api/v1/sync/push", { rows: [] })).status).toBe(400);
    expect((await api.post("/api/v1/sync/push", "{not json")).status).toBe(400);
    const rows = (n: number) => Array.from({ length: n }, (_, i) => txRow(uid(`h${i}`), iso()));
    // The limit is across entities, not per entity.
    const split = await api.post("/api/v1/sync/push", { changes: { transactions: rows(MAX_SYNC_ROWS), categories: [{ id: "x" }] } });
    expect(split.status).toBe(413);
    expect(await prisma.transaction.count({ where: { id: uid("h0") } })).toBe(0);
    const full = await api.post("/api/v1/sync/push", { changes: { transactions: rows(MAX_SYNC_ROWS) } });
    expect(full.status).toBe(200);
    expect(full.json.results.transactions.every((r: { status: string }) => r.status === "applied")).toBe(true);
  });
});

describe("isolation between users", () => {
  test("B sees none of A's rows and cannot write, delete or link into A's ids", async () => {
    const A = await newUser("iso-a");
    const B = await newUser("iso-b");
    const t0 = iso(60_000);
    await A.api.post("/api/v1/sync/push", { changes: {
      accounts: [accRow(A.uid("acc"), t0)], transactions: [txRow(A.uid("tx"), t0, { accountId: A.uid("acc") })],
      categories: [{ id: "Shared name", clientUpdatedAt: t0, icon: "", color: "#000000", createdAt: t0 }],
    } });

    const bRows = rowsOf((await pullAll(B.api, null)).pages, "transactions")
      .concat(rowsOf((await pullAll(B.api, null)).pages, "accounts"));
    expect(bRows.map((r) => r.id)).not.toContain(A.uid("tx"));
    expect(bRows.map((r) => r.id)).not.toContain(A.uid("acc"));

    const hijack = await B.api.post("/api/v1/sync/push", { changes: {
      accounts: [{ id: A.uid("acc"), clientUpdatedAt: iso(), deleted: true }],
      transactions: [txRow(A.uid("tx"), iso(), { amount: 1 }), txRow(B.uid("tx"), iso(), { accountId: A.uid("acc") })],
      // Category names are per user: the same name is B's own row, not A's.
      categories: [{ id: "Shared name", clientUpdatedAt: iso(), icon: "b", color: "#111111", createdAt: iso() }],
    } });
    expect(status(hijack, "accounts", A.uid("acc"))).toBe("forbidden");
    expect(status(hijack, "transactions", A.uid("tx"))).toBe("forbidden");
    expect(status(hijack, "transactions", B.uid("tx"))).toBe("applied");
    expect(status(hijack, "categories", "Shared name")).toBe("applied");

    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: A.uid("tx") } })).amount).toBe(20);
    expect(await prisma.bankAccount.count({ where: { id: A.uid("acc") } })).toBe(1);
    // B's transaction is kept, unlinked from A's account.
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: B.uid("tx") } })).accountId).toBeNull();
    expect(await prisma.customCategory.count({ where: { name: "Shared name", userId: { in: [A.user.id, B.user.id] } } })).toBe(2);
  });

  test("a cursor issued to another user does not position this user's pull", async () => {
    const A = await newUser("cur-a");
    const B = await newUser("cur-b");
    await B.api.post("/api/v1/sync/push", { changes: { transactions: [txRow(B.uid("tx"), iso(90_000))] } });
    const aCursor = (await A.api.get("/api/v1/sync/pull")).json.cursor;
    const res = await B.api.get(`/api/v1/sync/pull?cursor=${aCursor}`);
    expect(res.json.fullResync).toBe(true);
    expect(res.json.changes.transactions.map((r: any) => r.id)).toContain(B.uid("tx"));
  });
});

describe("accounts referenced by transactions", () => {
  test("own account linked, unknown one unlinked; an account in the same push links", async () => {
    const { api, uid } = await newUser("links");
    const t = iso(10_000);
    const res = await api.post("/api/v1/sync/push", { changes: {
      // Sent in the "wrong" order on purpose: accounts are applied first anyway.
      transactions: [txRow(uid("t1"), t, { accountId: uid("acc") }), txRow(uid("t2"), t, { accountId: "acc_nowhere" })],
      accounts: [accRow(uid("acc"), t, { openingBalance: 100 })],
    } });
    expect(res.json.results.transactions.map((r: any) => r.status)).toEqual(["applied", "applied"]);
    const rows = await prisma.transaction.findMany({ where: { id: { in: [uid("t1"), uid("t2")] } }, orderBy: { id: "asc" } });
    expect(rows.map((r) => r.accountId)).toEqual([uid("acc"), null]);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: uid("acc") } })).balance).toBe(80);
  });

  test("a transaction pushed before its account, in a separate request, is stored unlinked", async () => {
    // The phone pushes accounts before transactions in every cycle, so this
    // only happens when its account push failed. The server cannot hold a link
    // to a row it does not have; the transaction is kept and comes back unlinked.
    const { api, uid } = await newUser("early");
    await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(10_000), { accountId: uid("acc") })] } });
    await api.post("/api/v1/sync/push", { changes: { accounts: [accRow(uid("acc"), iso(9_000))] } });
    const tx = rowsOf((await pullAll(api, null)).pages, "transactions").find((r) => r.id === uid("tx"));
    expect(tx.accountId).toBeNull();
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: uid("acc") } })).balance).toBe(50);
  });

  test("deleting an account unlinks its transactions, and devices pull them unlinked", async () => {
    const { user, api, uid } = await newUser("unlink");
    const t = iso(20_000);
    await api.post("/api/v1/sync/push", { changes: { accounts: [accRow(uid("acc"), t)], transactions: [txRow(uid("tx"), t, { accountId: uid("acc") })] } });
    const cursor = restingCursor(user, 1_000);
    await api.post("/api/v1/sync/push", { changes: { accounts: [{ id: uid("acc"), clientUpdatedAt: iso(), deleted: true }] } });
    const { pages } = await pullAll(api, cursor);
    expect(rowsOf(pages, "transactions").find((r) => r.id === uid("tx")).accountId).toBeNull();
    expect(pages.flatMap((p) => p.deletions)).toContainEqual(expect.objectContaining({ entity: "accounts", id: uid("acc") }));
  });
});

describe("deletes, tombstones and resurrection", () => {
  test("a delete travels as a tombstone with its own time; an older upsert cannot resurrect, a newer one does", async () => {
    const { user, api, uid } = await newUser("tomb");
    await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(30_000))] } });
    const cursor = (await api.get("/api/v1/sync/pull")).json.cursor;

    const deleteAt = iso(10_000);
    const del = await api.post("/api/v1/sync/push", { changes: { transactions: [{ id: uid("tx"), clientUpdatedAt: deleteAt, deleted: true }] } });
    expect(status(del, "transactions", uid("tx"))).toBe("applied");
    const inc = await api.get(`/api/v1/sync/pull?cursor=${cursor}`);
    expect(inc.json.fullResync).toBe(false);
    expect(inc.json.deletions).toContainEqual({ entity: "transactions", id: uid("tx"), clientUpdatedAt: deleteAt });
    expect(inc.json.changes.transactions.map((r: any) => r.id)).not.toContain(uid("tx"));

    const zombie = await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(15_000))] } });
    expect(status(zombie, "transactions", uid("tx"))).toBe("stale");
    const back = await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(5_000), { amount: 7 })] } });
    expect(status(back, "transactions", uid("tx"))).toBe("applied");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: uid("tx") } })).amount).toBe(7);
    // Resurrected: the tombstone is gone, so no pull can delete it again.
    expect(await prisma.syncTombstone.count({ where: { userId: user.id, syncId: uid("tx") } })).toBe(0);
  });

  test("deleting a row the server never had records a tombstone, so a late older upsert loses", async () => {
    const { api, uid } = await newUser("unseen");
    const del = await api.post("/api/v1/sync/push", { changes: { categories: [{ id: "Ghost", clientUpdatedAt: iso(1_000), deleted: true }] } });
    expect(status(del, "categories", "Ghost")).toBe("applied");
    const late = await api.post("/api/v1/sync/push", { changes: {
      categories: [{ id: "Ghost", clientUpdatedAt: iso(5_000), icon: "", color: "#000000", createdAt: iso(5_000) }],
    } });
    expect(status(late, "categories", "Ghost")).toBe("stale");
    void uid;
  });

  test("an edit and a delete of the same row in one push end where the later one says", async () => {
    const { api, uid } = await newUser("editdel");
    await api.post("/api/v1/sync/push", { changes: { subscriptions: [subRow(uid("s1"), iso(60_000)), subRow(uid("s2"), iso(60_000))] } });
    const res = await api.post("/api/v1/sync/push", { changes: { subscriptions: [
      { ...subRow(uid("s1"), iso(20_000)), status: "canceled" }, { id: uid("s1"), clientUpdatedAt: iso(10_000), deleted: true },
      { id: uid("s2"), clientUpdatedAt: iso(10_000), deleted: true }, { ...subRow(uid("s2"), iso(20_000)), status: "canceled" },
    ] } });
    expect(res.json.results.subscriptions.map((r: any) => r.status)).toEqual(["applied", "applied", "applied", "stale"]);
    expect(await prisma.subscription.count({ where: { syncId: { in: [uid("s1"), uid("s2")] } } })).toBe(0);
  });

  test("a row deleted then re-created with the same id outside sync reaches devices live, not deleted", async () => {
    const { user, api, uid } = await newUser("recreate");
    const cursor = restingCursor(user, 1_000);
    await api.post("/api/v1/sync/push", { changes: { accounts: [accRow(uid("acc"), iso(30_000))] } });
    await api.post("/api/v1/sync/push", { changes: { accounts: [{ id: uid("acc"), clientUpdatedAt: iso(20_000), deleted: true }] } });
    // The server re-creates it (a bank mirror does exactly this), leaving the tombstone behind.
    await prisma.bankAccount.create({ data: { id: uid("acc"), userId: user.id, name: "Again", type: "checking", clientUpdatedAt: new Date() } });
    expect(await prisma.syncTombstone.count({ where: { userId: user.id, syncId: uid("acc") } })).toBe(1);

    const { pages } = await pullAll(api, cursor, 1);
    expect(pages.flatMap((p) => p.deletions).map((d: any) => d.id)).not.toContain(uid("acc"));
    expect(rowsOf(pages, "accounts").map((a) => a.name)).toEqual(["Again"]);
    // The live row is also what a push is judged against.
    const older = await api.post("/api/v1/sync/push", { changes: { accounts: [{ id: uid("acc"), clientUpdatedAt: iso(10_000), deleted: true }] } });
    expect(status(older, "accounts", uid("acc"))).toBe("stale");
  });
});

describe("pull", () => {
  test("snapshot vs incremental: a snapshot carries no deletions, an incremental pull does", async () => {
    const { user, api, uid } = await newUser("modes");
    await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("keep"), iso(9_000)), txRow(uid("gone"), iso(9_000))] } });
    await api.post("/api/v1/sync/push", { changes: { transactions: [{ id: uid("gone"), clientUpdatedAt: iso(), deleted: true }] } });
    const snap = await api.get("/api/v1/sync/pull");
    expect([snap.json.fullResync, snap.json.deletions]).toEqual([true, []]);
    expect(snap.json.changes.transactions.map((r: any) => r.id)).toEqual([uid("keep")]);
    const inc = await api.get(`/api/v1/sync/pull?cursor=${restingCursor(user, 60_000)}`);
    expect(inc.json.fullResync).toBe(false);
    expect(inc.json.deletions.map((d: any) => d.id)).toEqual([uid("gone")]);
  });

  test("a cursor older than tombstones are kept gets a full resync", async () => {
    const { user, api, uid } = await newUser("expired");
    await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso(1_000))] } });
    const old = await api.get(`/api/v1/sync/pull?cursor=${restingCursor(user, CURSOR_MAX_AGE_MS + 60_000)}`);
    expect(old.json.fullResync).toBe(true);
    const recent = await api.get(`/api/v1/sync/pull?cursor=${restingCursor(user, CURSOR_MAX_AGE_MS - 60_000)}`);
    expect(recent.json.fullResync).toBe(false);
  });

  test("pagination crosses entities and tombstones without losing or repeating an item", async () => {
    const { user, api, uid } = await newUser("pages");
    const cursor = restingCursor(user, 1_000);
    const t = iso(5_000);
    await api.post("/api/v1/sync/push", { changes: {
      settings: [settingsRow(t)],
      categories: ["A", "B", "C"].map((n) => ({ id: n, clientUpdatedAt: t, icon: "", color: "#000000", createdAt: t })),
      accounts: [accRow(uid("a1"), t), accRow(uid("a2"), t)],
      transactions: Array.from({ length: 10 }, (_, i) => txRow(uid(`t${i}`), t, { accountId: uid("a1") })),
      subscriptions: [subRow(uid("s1"), t)],
    } });
    await api.post("/api/v1/sync/push", { changes: {
      categories: [{ id: "B", clientUpdatedAt: iso(), deleted: true }],
      transactions: [0, 1, 2].map((i) => ({ id: uid(`t${i}`), clientUpdatedAt: iso(), deleted: true })),
    } });

    const expectLive = new Set(["settings", "A", "C", uid("a1"), uid("a2"), uid("s1"), ...[3, 4, 5, 6, 7, 8, 9].map((i) => uid(`t${i}`))]);
    const expectGone = new Set(["B", uid("t0"), uid("t1"), uid("t2")]);
    for (const limit of [1, 2, 3, 7, 1000]) {
      const { pages } = await pullAll(api, cursor, limit);
      const live = pages.flatMap((p) => Object.values(p.changes).flat().map((r: any) => r.id));
      const gone = pages.flatMap((p) => p.deletions.map((d: any) => d.id));
      expect(pages.every((p) => Object.values(p.changes).flat().length + p.deletions.length <= limit)).toBe(true);
      expect(new Set(live)).toEqual(expectLive);
      expect(live).toHaveLength(expectLive.size);
      expect(new Set(gone)).toEqual(expectGone);
      expect(gone).toHaveLength(expectGone.size);
      // 17 items: a small limit really pages, across every entity boundary.
      expect(pages.length).toBeGreaterThanOrEqual(Math.ceil(17 / limit));
    }
  });

  test("items sharing one millisecond page in (entity, id) byte order across tables and tombstones", async () => {
    const { user, api, uid } = await newUser("sametime");
    const t = iso(20_000);
    await api.post("/api/v1/sync/push", { changes: {
      settings: [settingsRow(t)],
      categories: ["b", "B", "é", "a"].map((n) => ({ id: n, clientUpdatedAt: t, icon: "", color: "#000000", createdAt: t })),
      accounts: [accRow(uid("acc"), t)],
      transactions: ["x", "y", "z"].map((k) => txRow(uid(k), t)),
      subscriptions: [subRow(uid("s"), t)],
    } });
    await api.post("/api/v1/sync/push", { changes: {
      transactions: [{ id: uid("y"), clientUpdatedAt: iso(10_000), deleted: true }],
      categories: [{ id: "é", clientUpdatedAt: iso(10_000), deleted: true }],
    } });
    // Every item of this user at the same instant: possible in production
    // (stamps are milliseconds), forced here with the triggers bypassed.
    const sameMs = Math.floor(Date.now() / 1000) * 1000 - 3_600_000 + 123;
    const same = new Date(sameMs).toISOString().replace("T", " ").replace("Z", "");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      for (const table of ["UserSettings", "CustomCategory", "BankAccount", "Transaction", "Subscription"]) {
        await tx.$executeRawUnsafe(`UPDATE "${table}" SET "serverUpdatedAt" = '${same}' WHERE "userId" = $1`, user.id);
      }
      await tx.$executeRawUnsafe(`UPDATE "SyncTombstone" SET "deletedAt" = '${same}' WHERE "userId" = $1`, user.id);
    });

    const cursor = encodeCursor({ mode: "rest", user: userTag(user.id), t: sameMs - 60_000 });
    const order: string[] = [];
    let c = cursor;
    for (let i = 0; i < 50; i++) {
      const page = (await api.get(`/api/v1/sync/pull?limit=1&cursor=${c}`)).json;
      for (const [entity, rows] of Object.entries(page.changes)) for (const r of rows as any[]) order.push(`${entity}/${r.id}`);
      for (const d of page.deletions) order.push(`${d.entity}/${d.id}/deleted`);
      c = page.cursor;
      if (!page.hasMore) break;
    }
    expect(order).toEqual([
      "accounts/" + uid("acc"), "categories/B", "categories/a", "categories/b", "categories/é/deleted", "settings/settings",
      "subscriptions/" + uid("s"), "transactions/" + uid("x"), "transactions/" + uid("y") + "/deleted", "transactions/" + uid("z"),
    ]);
  });

  test("rows written just now are sent again; the cursor stays behind the database clock by the lag", async () => {
    const { api, uid } = await newUser("lag");
    await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("tx"), iso())] } });
    const first = await api.get("/api/v1/sync/pull");
    const again = await api.get(`/api/v1/sync/pull?cursor=${first.json.cursor}`);
    expect(again.json.changes.transactions.map((r: any) => r.id)).toContain(uid("tx"));
    for (const page of [first.json, again.json]) {
      const c = decodeCursor(page.cursor)!;
      expect(c.mode).toBe("rest");
      expect((c as { t: number }).t).toBeLessThanOrEqual(Date.parse(page.serverTime) - PULL_SAFETY_LAG_MS);
    }
  });

  for (const mode of ["snapshot", "incremental"] as const) {
    test(`a row stamped before a pull but committed after it is not skipped (${mode})`, async () => {
      const { user, api, uid } = await newUser(`late-${mode}`);
      const startCursor = mode === "snapshot" ? null : restingCursor(user, 1_000);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let stamped!: () => void;
      const written = new Promise<void>((r) => (stamped = r));
      // A slow writer: its row is stamped now and committed only after a pull
      // has already returned a row stamped later.
      const writer = prisma.$transaction(async (tx) => {
        await tx.transaction.create({ data: {
          id: uid("slow"), userId: user.id, amount: 3, category: "Food", type: "Expense", dateISO: "2026-10-11",
          clientUpdatedAt: new Date(),
        } });
        stamped();
        await held;
      }, { timeout: 20_000 });
      await written;
      await api.post("/api/v1/sync/push", { changes: { transactions: [txRow(uid("fast"), iso())] } });

      const during = await pullAll(api, startCursor);
      expect(rowsOf(during.pages, "transactions").map((r) => r.id)).toEqual([uid("fast")]);
      release();
      await writer;
      const after = await pullAll(api, during.cursor);
      expect(rowsOf(after.pages, "transactions").map((r) => r.id)).toContain(uid("slow"));
    });
  }

  test("a deletion made while a snapshot is paging reaches the device on the next pull", async () => {
    const { api, uid } = await newUser("snapdel");
    const t = iso(60_000);
    await api.post("/api/v1/sync/push", { changes: { transactions: [1, 2, 3, 4].map((i) => txRow(uid(`t${i}`), t)) } });
    const first = await api.get("/api/v1/sync/pull?limit=2");
    expect(first.json.hasMore).toBe(true);
    const sentEarly = first.json.changes.transactions[0].id;
    await api.post("/api/v1/sync/push", { changes: { transactions: [{ id: sentEarly, clientUpdatedAt: iso(), deleted: true }] } });
    const rest = await pullAll(api, first.json.cursor, 2);
    expect(rest.pages.every((p) => p.fullResync && p.deletions.length === 0)).toBe(true);
    const next = await pullAll(api, rest.cursor);
    expect(next.pages[0].fullResync).toBe(false);
    expect(next.pages.flatMap((p) => p.deletions).map((d: any) => d.id)).toContain(sentEarly);
  });

  test("a malformed cursor or limit is a 400, not a crash", async () => {
    const { api } = await newUser("badq");
    const bad = await api.get("/api/v1/sync/pull?cursor=garbage!!");
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("invalid_cursor");
    const forged = Buffer.from(JSON.stringify([1, "i", "x", 1, "widgets", "k", null])).toString("base64url");
    expect((await api.get(`/api/v1/sync/pull?cursor=${forged}`)).status).toBe(400);
    for (const limit of ["0", "1001", "abc", "2.5", "-1"]) {
      expect((await api.get(`/api/v1/sync/pull?limit=${limit}`)).status).toBe(400);
    }
    expect((await api.get("/api/v1/sync/pull?limit=1000")).status).toBe(200);
  });
});

describe("REST writes follow the sync model", () => {
  test("setting an account's balance sets the openingBalance that produces it", async () => {
    const { api, uid } = await newUser("rest-acc");
    const created = await api.post("/api/v1/accounts", { id: uid("acc"), name: "Checking", type: "checking", balance: 100 });
    expect([created.status, created.json.openingBalance, created.json.balance]).toEqual([201, 100, 100]);
    await api.post("/api/v1/transactions", { amount: 30, category: "Food", type: "Expense", dateISO: "2026-10-11", accountId: uid("acc") });
    const put = await api.put(`/api/v1/accounts/${uid("acc")}`, { balance: 500 });
    expect([put.status, put.json.balance, put.json.openingBalance]).toEqual([200, 500, 530]);
    // The derived balance holds as the ledger moves on.
    await api.post("/api/v1/transactions", { amount: 20, category: "Pay", type: "Income", dateISO: "2026-10-11", accountId: uid("acc") });
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: uid("acc") } })).balance).toBe(520);
    expect((await api.put(`/api/v1/accounts/acc_not_mine`, { balance: 1 })).status).toBe(404);
  });

  test("PUT /transactions changes only what it is sent; an account it names must be the caller's", async () => {
    const A = await newUser("rest-put");
    const B = await newUser("rest-put-b");
    await A.api.post("/api/v1/accounts", { id: A.uid("acc"), name: "A", type: "cash" });
    await B.api.post("/api/v1/accounts", { id: B.uid("acc"), name: "B", type: "cash" });
    const created = await A.api.post("/api/v1/transactions", {
      amount: 5, category: "Food", type: "Expense", dateISO: "2026-10-11", isImpulse: true, currency: "EUR",
    });
    const id = created.json.id;
    const linked = await A.api.put(`/api/v1/transactions/${id}`, { note: "edited", accountId: A.uid("acc") });
    expect([linked.json.note, linked.json.isImpulse, linked.json.currency, linked.json.accountId])
      .toEqual(["edited", true, "EUR", A.uid("acc")]);
    expect(Date.parse(linked.json.clientUpdatedAt)).toBeGreaterThan(Date.parse(created.json.clientUpdatedAt) - 1);
    const foreign = await A.api.put(`/api/v1/transactions/${id}`, { accountId: B.uid("acc") });
    expect(foreign.json.accountId).toBeNull();
    expect((await A.api.put(`/api/v1/transactions/${id}`, { amount: 0 })).status).toBe(400);
    expect((await B.api.put(`/api/v1/transactions/${id}`, { note: "theirs" })).status).toBe(404);
  });

  test("REST writes stamp clientUpdatedAt now, refuse foreign accounts, and deletes leave a stamped tombstone", async () => {
    const A = await newUser("rest-a");
    const B = await newUser("rest-b");
    await B.api.post("/api/v1/accounts", { id: B.uid("acc"), name: "B", type: "cash" });
    const before = Date.now();
    const tx = await A.api.post("/api/v1/transactions", {
      amount: 5, category: "Food", type: "Expense", dateISO: "2026-10-11", accountId: B.uid("acc"),
    });
    expect(tx.status).toBe(201);
    expect(tx.json.accountId).toBeNull();
    expect(Date.parse(tx.json.clientUpdatedAt)).toBeGreaterThanOrEqual(before - 5);

    // An older device edit made before the REST delete must not bring the row back.
    const deviceEdit = iso(0);
    await Bun.sleep(5);
    expect((await A.api.del(`/api/v1/transactions/${tx.json.id}`)).status).toBe(200);
    const tomb = await prisma.syncTombstone.findUniqueOrThrow({
      where: { userId_entity_syncId: { userId: A.user.id, entity: "transactions", syncId: tx.json.id } },
    });
    expect(tomb.clientUpdatedAt.getTime()).toBeGreaterThan(Date.parse(deviceEdit));
    const res = await A.api.post("/api/v1/sync/push", { changes: { transactions: [txRow(tx.json.id, deviceEdit)] } });
    expect(status(res, "transactions", tx.json.id)).toBe("stale");
  });
});

// ─── Phase 4: recurring, bill reminders, category budgets, net worth ─────────

/** A resting cursor past everything written so far: a pull from it carries only what changes next. */
async function settled(user: TestUser): Promise<string> {
  await Bun.sleep(5);
  return encodeCursor({ mode: "rest", user: userTag(user.id), t: await databaseNowMs(prisma) });
}

type RowMaker = (id: string, cu: string, over?: Record<string, unknown>) => Record<string, unknown>;

/**
 * One entity's life on a phone, seen by a second device that is in sync:
 * create, edit, delete, each pulled exactly; an older copy loses to each;
 * a newer one resurrects the deleted row.
 */
async function roundTrip(label: string, entity: string, idOf: (uid: (s: string) => string) => string, make: RowMaker, edit: Record<string, unknown>) {
  const { user, api, uid } = await newUser(label);
  const id = idOf(uid);
  const push = (rows: unknown[]) => api.post("/api/v1/sync/push", { changes: { [entity]: rows } });
  const pull = async (cursor: string) => (await pullAll(api, cursor)).pages;

  const c0 = await settled(user);
  const t1 = iso(30_000);
  expect(status(await push([make(id, t1)]), entity, id)).toBe("applied");
  const created = await pull(c0);
  expect(rowsOf(created, entity)).toEqual([make(id, t1)]);
  // Only this entity moved; the other eight carry nothing.
  expect(SYNC_ENTITIES.filter((e) => e !== entity).flatMap((e) => created.flatMap((p) => p.changes[e]))).toEqual([]);

  const c1 = await settled(user);
  const t2 = iso(20_000);
  expect(status(await push([make(id, t2, edit)]), entity, id)).toBe("applied");
  expect(rowsOf(await pull(c1), entity)).toEqual([make(id, t2, edit)]);
  expect(status(await push([make(id, iso(25_000))]), entity, id)).toBe("stale");

  const c2 = await settled(user);
  const t3 = iso(10_000);
  expect(status(await push([{ id, clientUpdatedAt: t3, deleted: true }]), entity, id)).toBe("applied");
  const deleted = await pull(c2);
  expect(rowsOf(deleted, entity)).toEqual([]);
  expect(deleted.flatMap((p) => p.deletions)).toEqual([{ entity, id, clientUpdatedAt: t3 }]);
  expect(await prisma.syncTombstone.count({ where: { userId: user.id, entity, syncId: id } })).toBe(1);

  // An edit made before the delete cannot bring it back; one made after does.
  expect(status(await push([make(id, iso(15_000), edit)]), entity, id)).toBe("stale");
  const t4 = iso(5_000);
  expect(status(await push([make(id, t4, edit)]), entity, id)).toBe("applied");
  expect(await prisma.syncTombstone.count({ where: { userId: user.id, entity, syncId: id } })).toBe(0);
  return { user, api, uid, id, t4 };
}

describe("phase4 sync: each new entity both ways", () => {
  test("recurring: a series created, edited and deleted on a phone reaches the other device, the delete as a tombstone", async () => {
    const { user, id } = await roundTrip("p4-rec", "recurring", (uid) => uid("rec"), recRow,
      { name: "Rent (new flat)", amount: 950.25, frequency: "weekly", isActive: false, isImpulse: true, lastCreated: "2026-10-01" });
    expect(await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } })).toMatchObject({
      userId: user.id, name: "Rent (new flat)", amount: 950.25, frequency: "weekly", isActive: false, lastCreated: "2026-10-01",
    });
  });

  test("billReminders: a bill created, paid and deleted on a phone reaches the other device; paidAt travels as ISO", async () => {
    const { id } = await roundTrip("p4-bill", "billReminders", (uid) => uid("bill"), billRow,
      { isPaid: true, paidAt: "2026-10-06T10:00:00.250Z", nextDueDate: "2026-12-05", amount: 61 });
    const stored = await prisma.billReminder.findUniqueOrThrow({ where: { id } });
    expect([stored.isPaid, stored.paidAt?.toISOString(), stored.nextDueDate]).toEqual([true, "2026-10-06T10:00:00.250Z", "2026-12-05"]);
  });

  test("categoryBudgets: a budget is keyed by its category; created, changed and deleted it reaches the other device", async () => {
    const { user } = await roundTrip("p4-budget", "categoryBudgets", () => "Food", budgetRow, { amount: 450, period: "weekly" });
    const rows = await prisma.categoryBudget.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => [r.category, r.amount, r.period])).toEqual([["Food", 450, "weekly"]]);
    // The row id is the server's own and never travels.
    expect(rows[0]!.id).toStartWith("catbud_");
  });

  test("netWorth: a snapshot created, corrected and deleted reaches the other device; breakdown is JSON text", async () => {
    const { id } = await roundTrip("p4-nw", "netWorth", (uid) => uid("nw"), nwRow,
      { assets: 2000, liabilities: 300, netWorth: 1700, breakdown: null });
    const stored = await prisma.netWorthEntry.findUniqueOrThrow({ where: { id } });
    expect([stored.assets, stored.netWorth, stored.breakdown]).toEqual([2000, 1700, null]);
  });
});

describe("phase4 sync: ownership and keys", () => {
  test("another user's recurring, bill and net-worth ids are forbidden, to edit and to delete", async () => {
    const A = await newUser("p4-iso-a");
    const B = await newUser("p4-iso-b");
    const t0 = iso(60_000);
    await A.api.post("/api/v1/sync/push", { changes: {
      recurring: [recRow(A.uid("rec"), t0)], billReminders: [billRow(A.uid("bill"), t0)], netWorth: [nwRow(A.uid("nw"), t0)],
    } });

    const hijack = await B.api.post("/api/v1/sync/push", { changes: {
      recurring: [recRow(A.uid("rec"), iso(), { amount: 1 })],
      billReminders: [{ id: A.uid("bill"), clientUpdatedAt: iso(), deleted: true }],
      netWorth: [nwRow(A.uid("nw"), iso(), { assets: 1, liabilities: 0, netWorth: 1 })],
    } });
    expect([status(hijack, "recurring", A.uid("rec")), status(hijack, "billReminders", A.uid("bill")), status(hijack, "netWorth", A.uid("nw"))])
      .toEqual(["forbidden", "forbidden", "forbidden"]);
    expect((await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: A.uid("rec") } })).amount).toBe(900);
    expect(await prisma.billReminder.count({ where: { id: A.uid("bill") } })).toBe(1);
    expect((await prisma.netWorthEntry.findUniqueOrThrow({ where: { id: A.uid("nw") } })).assets).toBe(1000);
    expect(await prisma.syncTombstone.count({ where: { userId: B.user.id } })).toBe(0);

    // B's snapshot holds none of A's rows.
    const { pages } = await pullAll(B.api, null);
    for (const entity of ["recurring", "billReminders", "netWorth"]) expect(rowsOf(pages, entity)).toEqual([]);
  });

  test("category budgets are per user by category: the same category is each user's own row", async () => {
    const A = await newUser("p4-cat-a");
    const B = await newUser("p4-cat-b");
    await A.api.post("/api/v1/sync/push", { changes: { categoryBudgets: [budgetRow("Food", iso(60_000), { amount: 100 })] } });
    const b = await B.api.post("/api/v1/sync/push", { changes: { categoryBudgets: [budgetRow("Food", iso(), { amount: 999 })] } });
    expect(status(b, "categoryBudgets", "Food")).toBe("applied");
    expect(await prisma.categoryBudget.findMany({ where: { userId: { in: [A.user.id, B.user.id] } }, orderBy: { amount: "asc" } }))
      .toMatchObject([{ userId: A.user.id, category: "Food", amount: 100 }, { userId: B.user.id, category: "Food", amount: 999 }]);

    // B deleting "Food" deletes B's, and only B's devices hear of it.
    await B.api.post("/api/v1/sync/push", { changes: { categoryBudgets: [{ id: "Food", clientUpdatedAt: iso(), deleted: true }] } });
    expect(await prisma.categoryBudget.count({ where: { userId: A.user.id, category: "Food" } })).toBe(1);
    expect(rowsOf((await pullAll(A.api, null)).pages, "categoryBudgets").map((r) => [r.id, r.amount])).toEqual([["Food", 100]]);
    const aIncremental = await pullAll(A.api, restingCursor(A.user, 60_000));
    expect(aIncremental.pages.flatMap((p) => p.deletions)).toEqual([]);

    // REST and sync write the one row per category: a REST upsert of the
    // same category updates the synced row, and sync answers for it.
    await A.api.post("/api/v1/category-budgets", { category: "Food", amount: 150 });
    expect(await prisma.categoryBudget.count({ where: { userId: A.user.id } })).toBe(1);
    await Bun.sleep(5);
    const again = await A.api.post("/api/v1/sync/push", { changes: { categoryBudgets: [budgetRow("Food", iso(), { amount: 175 })] } });
    expect(status(again, "categoryBudgets", "Food")).toBe("applied");
    expect(await prisma.categoryBudget.findMany({ where: { userId: A.user.id } })).toMatchObject([{ category: "Food", amount: 175 }]);
  });

  test("a series names only the caller's accounts: its own (even one in the same push) linked, any other stored null", async () => {
    const A = await newUser("p4-acc-a");
    const B = await newUser("p4-acc-b");
    await B.api.post("/api/v1/sync/push", { changes: { accounts: [accRow(B.uid("acc"), iso(60_000))] } });
    const t = iso(30_000);
    const res = await A.api.post("/api/v1/sync/push", { changes: {
      // Sent before the account on purpose: accounts are applied first anyway.
      recurring: [
        recRow(A.uid("own"), t, { accountId: A.uid("acc") }),
        recRow(A.uid("theirs"), t, { accountId: B.uid("acc") }),
        recRow(A.uid("nowhere"), t, { accountId: "acc_nowhere" }),
      ],
      accounts: [accRow(A.uid("acc"), t)],
    } });
    expect(res.json.results.recurring.map((r: any) => r.status)).toEqual(["applied", "applied", "applied"]);
    const stored = await prisma.recurringTransaction.findMany({ where: { userId: A.user.id }, orderBy: { id: "asc" } });
    expect(Object.fromEntries(stored.map((r) => [r.id, r.accountId])))
      .toEqual({ [A.uid("own")]: A.uid("acc"), [A.uid("theirs")]: null, [A.uid("nowhere")]: null });
    // The phone pulls what was stored.
    const pulled = rowsOf((await pullAll(A.api, null)).pages, "recurring");
    expect(Object.fromEntries(pulled.map((r) => [r.id, r.accountId])))
      .toEqual({ [A.uid("own")]: A.uid("acc"), [A.uid("theirs")]: null, [A.uid("nowhere")]: null });

    // Deleting the account unlinks the series, and devices pull it unlinked.
    const c = await settled(A.user);
    await A.api.post("/api/v1/sync/push", { changes: { accounts: [{ id: A.uid("acc"), clientUpdatedAt: iso(), deleted: true }] } });
    const after = await pullAll(A.api, c);
    expect(rowsOf(after.pages, "recurring")).toEqual([expect.objectContaining({ id: A.uid("own"), accountId: null })]);
    expect(after.pages.flatMap((p) => p.deletions)).toContainEqual(expect.objectContaining({ entity: "accounts", id: A.uid("acc") }));
  });

  test("invalid rows of the new entities are answered invalid and write nothing", async () => {
    const { user, api, uid } = await newUser("p4-invalid");
    const t = iso();
    const res = await api.post("/api/v1/sync/push", { changes: {
      recurring: [recRow(uid("r1"), t, { nextDate: "2026-02-30" }), recRow("r".repeat(101), t), recRow(uid("r2"), t, { frequency: "hourly" })],
      billReminders: [billRow(uid("b1"), t, { dueDay: 0 }), billRow(uid("b2"), t, { paidAt: "yesterday" }), billRow(uid("b3"), t, { isPaid: "yes" })],
      categoryBudgets: [budgetRow("Food", t, { period: "daily" }), budgetRow("x".repeat(51), t), budgetRow("Fun", t, { amount: -5 })],
      netWorth: [nwRow(uid("n1"), t, { breakdown: '{"cash":"lots"}' }), nwRow(uid("n2"), t, { breakdown: { cash: 1 } }), nwRow(uid("n3"), t, { date: "11/10/2026" })],
    } });
    expect(res.status).toBe(200);
    for (const entity of ["recurring", "billReminders", "categoryBudgets", "netWorth"]) {
      expect(res.json.results[entity].map((r: any) => r.status)).toEqual(["invalid", "invalid", "invalid"]);
    }
    const counts = await Promise.all([
      prisma.recurringTransaction.count({ where: { userId: user.id } }), prisma.billReminder.count({ where: { userId: user.id } }),
      prisma.categoryBudget.count({ where: { userId: user.id } }), prisma.netWorthEntry.count({ where: { userId: user.id } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  test("a REST breakdown must fit the 10,000 characters a push accepts, so every snapshot a phone pulls it can push back", async () => {
    const { api } = await newUser("p4-nw-cap");
    // {"k0000":1,"k0001":1,…}: 10 characters an entry with its comma, plus
    // the braces less one comma, so 999 entries are 9,991 characters; a last
    // amount of 1.23456789 (9 more characters than 1) makes exactly 10,000.
    const atCap: Record<string, number> = Object.fromEntries(Array.from({ length: 999 }, (_, i) => [`k${String(i).padStart(4, "0")}`, 1]));
    atCap.k0998 = 1.23456789;
    expect(JSON.stringify(atCap).length).toBe(10_000);
    const over = { ...atCap, k0998: 1.234567891 };
    expect(JSON.stringify(over).length).toBe(10_001);

    const refused = await api.post("/api/v1/net-worth", { date: "2026-10-11", assets: 1, liabilities: 0, breakdown: over });
    expect(refused.status).toBe(400);
    const kept = await api.post("/api/v1/net-worth", { date: "2026-10-11", assets: 1, liabilities: 0, breakdown: atCap });
    expect(kept.status).toBe(201);

    const pulled = rowsOf((await pullAll(api, null)).pages, "netWorth");
    expect(pulled.map((r) => r.breakdown.length)).toEqual([10_000]);
    await Bun.sleep(5);
    const back = await api.post("/api/v1/sync/push", { changes: { netWorth: [{ ...pulled[0], assets: 2, netWorth: 2, clientUpdatedAt: iso() }] } });
    expect(status(back, "netWorth", kept.json.id)).toBe("applied");
  });

  test("netWorth is stored as assets − liabilities whatever the phone computed, and pulled as stored", async () => {
    const { api, uid } = await newUser("p4-nw-math");
    await api.post("/api/v1/sync/push", { changes: { netWorth: [nwRow(uid("nw"), iso(), { assets: 1200.5, liabilities: 200.25, netWorth: 7 })] } });
    expect((await prisma.netWorthEntry.findUniqueOrThrow({ where: { id: uid("nw") } })).netWorth).toBe(1000.25);
    expect(rowsOf((await pullAll(api, null)).pages, "netWorth")[0].netWorth).toBe(1000.25);
  });
});

describe("phase4 sync: rows written outside the sync", () => {
  test("rows written through the old REST routes appear in the pull, in the wire shape", async () => {
    const { user, api, uid } = await newUser("p4-rest");
    const c0 = await settled(user);
    await api.post("/api/v1/accounts", { id: uid("acc"), name: "Main", type: "checking" });
    const rec = (await api.post("/api/v1/recurring", {
      accountId: uid("acc"), name: "Gym", amount: 30, category: "Health", type: "Expense", frequency: "weekly",
      startDate: "2026-10-01", nextDate: "2026-10-15",
    })).json;
    const bill = (await api.post("/api/v1/bill-reminders", { name: "Water", amount: 20, dueDay: 12, nextDueDate: "2026-10-12" })).json;
    const budget = (await api.post("/api/v1/category-budgets", { category: "Food", amount: 300 })).json;
    const nw = (await api.post("/api/v1/net-worth", {
      date: "2026-10-11", assets: 5000, liabilities: 1200, breakdown: { savings: 5000, card: -1200 },
    })).json;

    const { pages } = await pullAll(api, c0);
    expect(rowsOf(pages, "recurring")).toEqual([{
      id: rec.id, clientUpdatedAt: rec.clientUpdatedAt, accountId: uid("acc"), name: "Gym", amount: 30, category: "Health",
      type: "Expense", isImpulse: false, frequency: "weekly", startDate: "2026-10-01", nextDate: "2026-10-15",
      lastCreated: null, isActive: true, currency: "USD", createdAt: rec.createdAt,
    }]);
    expect(rowsOf(pages, "billReminders")).toEqual([{
      id: bill.id, clientUpdatedAt: bill.clientUpdatedAt, name: "Water", amount: 20, dueDay: 12, category: "Other",
      isRecurring: true, isPaid: false, paidAt: null, nextDueDate: "2026-10-12", createdAt: bill.createdAt,
    }]);
    expect(rowsOf(pages, "categoryBudgets")).toEqual([
      { id: "Food", clientUpdatedAt: budget.clientUpdatedAt, amount: 300, period: "monthly", createdAt: budget.createdAt },
    ]);
    expect(rowsOf(pages, "netWorth")).toEqual([{
      id: nw.id, clientUpdatedAt: nw.clientUpdatedAt, date: "2026-10-11", assets: 5000, liabilities: 1200, netWorth: 3800,
      breakdown: JSON.stringify({ savings: 5000, card: -1200 }), createdAt: nw.createdAt,
    }]);

    // A REST edit reaches devices too: paid, with the server's paidAt.
    const c1 = await settled(user);
    const paid = (await api.put(`/api/v1/bill-reminders/${bill.id}`, { isPaid: true })).json;
    const after = rowsOf((await pullAll(api, c1)).pages, "billReminders");
    expect(after).toEqual([expect.objectContaining({ id: bill.id, isPaid: true, paidAt: paid.paidAt, clientUpdatedAt: paid.clientUpdatedAt })]);
    expect("lastNotifiedAt" in after[0]).toBe(false);
  });

  test("REST deletes reach devices as tombstones carrying the delete's time, so an older phone edit cannot undo them", async () => {
    const { user, api } = await newUser("p4-rest-del");
    const rec = (await api.post("/api/v1/recurring", {
      name: "Gym", amount: 30, category: "Health", type: "Expense", frequency: "weekly", startDate: "2026-10-01", nextDate: "2026-10-15",
    })).json;
    const bill = (await api.post("/api/v1/bill-reminders", { name: "Water", amount: 20, dueDay: 12, nextDueDate: "2026-10-12" })).json;
    const budget = (await api.post("/api/v1/category-budgets", { category: "Food", amount: 300 })).json;

    const c = await settled(user);
    const deviceEdit = iso();
    await Bun.sleep(5);
    expect((await api.del(`/api/v1/recurring/${rec.id}`)).status).toBe(200);
    expect((await api.del(`/api/v1/bill-reminders/${bill.id}`)).status).toBe(200);
    expect((await api.del(`/api/v1/category-budgets/${budget.id}`)).status).toBe(200);
    expect((await api.del(`/api/v1/category-budgets/${budget.id}`)).status).toBe(404);

    const deletions = (await pullAll(api, c)).pages.flatMap((p) => p.deletions);
    expect(deletions.map((d: any) => `${d.entity}:${d.id}`).sort())
      .toEqual([`billReminders:${bill.id}`, "categoryBudgets:Food", `recurring:${rec.id}`]);
    for (const d of deletions) expect(Date.parse(d.clientUpdatedAt)).toBeGreaterThan(Date.parse(deviceEdit));

    const late = await api.post("/api/v1/sync/push", { changes: {
      recurring: [recRow(rec.id, deviceEdit)], billReminders: [billRow(bill.id, deviceEdit)], categoryBudgets: [budgetRow("Food", deviceEdit)],
    } });
    expect([status(late, "recurring", rec.id), status(late, "billReminders", bill.id), status(late, "categoryBudgets", "Food")])
      .toEqual(["stale", "stale", "stale"]);
  });

  test("a budget moved to another category reaches devices as the new category and the old one's deletion", async () => {
    const { user, api } = await newUser("p4-rekey");
    await api.post("/api/v1/sync/push", { changes: { categoryBudgets: [budgetRow("Food", iso(60_000))] } });
    const c = await settled(user);
    // No route does this today; whatever does, the old key must not linger on phones.
    await prisma.categoryBudget.update({
      where: { userId_category: { userId: user.id, category: "Food" } },
      data: { category: "Groceries", clientUpdatedAt: new Date() },
    });
    const { pages } = await pullAll(api, c);
    expect(rowsOf(pages, "categoryBudgets").map((r) => r.id)).toEqual(["Groceries"]);
    expect(pages.flatMap((p) => p.deletions).map((d: any) => `${d.entity}:${d.id}`)).toEqual(["categoryBudgets:Food"]);
  });

  test("a snapshot and an incremental pull page across all nine entities without losing or repeating an item", async () => {
    const { user, api, uid } = await newUser("p4-pages");
    const cursor = restingCursor(user, 1_000);
    const t = iso(5_000);
    await api.post("/api/v1/sync/push", { changes: {
      settings: [settingsRow(t)],
      transactions: [txRow(uid("t1"), t), txRow(uid("t2"), t)],
      recurring: [1, 2, 3].map((i) => recRow(uid(`r${i}`), t)),
      billReminders: [1, 2, 3].map((i) => billRow(uid(`b${i}`), t)),
      categoryBudgets: ["Food", "Fun", "Gym"].map((c) => budgetRow(c, t)),
      netWorth: [1, 2, 3].map((i) => nwRow(uid(`n${i}`), t)),
    } });
    await api.post("/api/v1/sync/push", { changes: {
      recurring: [{ id: uid("r2"), clientUpdatedAt: iso(), deleted: true }],
      billReminders: [{ id: uid("b1"), clientUpdatedAt: iso(), deleted: true }],
      categoryBudgets: [{ id: "Fun", clientUpdatedAt: iso(), deleted: true }],
      netWorth: [{ id: uid("n3"), clientUpdatedAt: iso(), deleted: true }],
    } });

    const live = new Set(["settings", uid("t1"), uid("t2"), uid("r1"), uid("r3"), uid("b2"), uid("b3"), "Food", "Gym", uid("n1"), uid("n2")]);
    const gone = new Set([`recurring:${uid("r2")}`, `billReminders:${uid("b1")}`, "categoryBudgets:Fun", `netWorth:${uid("n3")}`]);
    for (const limit of [1, 2, 5, 1000]) {
      const inc = (await pullAll(api, cursor, limit)).pages;
      const ids = inc.flatMap((p) => Object.values(p.changes).flat().map((r: any) => r.id));
      const dels = inc.flatMap((p) => p.deletions.map((d: any) => `${d.entity}:${d.id}`));
      expect([new Set(ids), ids.length]).toEqual([live, live.size]);
      expect([new Set(dels), dels.length]).toEqual([gone, gone.size]);

      const snap = (await pullAll(api, null, limit)).pages;
      const snapIds = snap.flatMap((p) => Object.values(p.changes).flat().map((r: any) => r.id));
      expect([new Set(snapIds), snapIds.length]).toEqual([live, live.size]);
      expect(snap.every((p) => p.fullResync && p.deletions.length === 0)).toBe(true);
    }
  });
});

// ─── Server writes win (Phase 4 decision 4) ─────────────────────────────────

/**
 * A server write's stamp: the database clock at the write, so at most the
 * row's own serverUpdatedAt (the trigger reads the same clock moments later),
 * and later than the phone edit it must beat.
 */
function expectServerStamp(row: { clientUpdatedAt: Date; serverUpdatedAt: Date }, beats: string) {
  const cu = row.clientUpdatedAt.getTime();
  expect(cu).toBeGreaterThan(Date.parse(beats));
  expect(cu).toBeLessThanOrEqual(row.serverUpdatedAt.getTime());
  expect(row.serverUpdatedAt.getTime() - cu).toBeLessThan(5_000);
  expect(Math.abs(cu - Date.now())).toBeLessThan(60_000);
}

/** The bill checker's real deps, scoped to one user (the database is shared), pushes recorded. */
function checkerFor(userId: string, sent: string[]): BillReminderDeps {
  return {
    ...billReminderDeps,
    findDueBills: async (t, s) => (await billReminderDeps.findDueBills(t, s)).filter((b) => b.userId === userId),
    sendPush: async (_u, _title, body) => {
      sent.push(body);
    },
  };
}

describe("server writes win", () => {
  test("the recurring job's claim stamps the database clock: an older phone edit is stale and the pull returns the booked series", async () => {
    const { user, api, uid } = await newUser("sw-job");
    const today = await dbToday();
    const id = uid("rec");
    const t0 = iso(60_000);
    await api.post("/api/v1/sync/push", { changes: { recurring: [recRow(id, t0, { startDate: today, nextDate: today })] } });
    // Edited on a phone before the booking, pushed after it.
    const phoneEdit = recRow(id, iso(30_000), { name: "Rent (edited)", startDate: today, nextDate: today, createdAt: t0 });

    expect(await processRecurring({ userIds: [user.id] })).toBe(1);
    const booked = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } });
    expect([booked.lastCreated, booked.nextDate]).toEqual([today, computeNextDate(today, "monthly", anchorDayOf(today))]);
    expectServerStamp(booked, phoneEdit.clientUpdatedAt);

    const c = await settled(user);
    expect(status(await api.post("/api/v1/sync/push", { changes: { recurring: [phoneEdit] } }), "recurring", id)).toBe("stale");
    const { pages } = await pullAll(api, c);
    expect(rowsOf(pages, "recurring")).toEqual([recRow(id, booked.clientUpdatedAt.toISOString(), {
      startDate: today, nextDate: booked.nextDate, lastCreated: today, createdAt: t0,
    })]);
    expect((await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } })).name).toBe("Rent");
  });

  test("run-now stamps the database clock the same way, booking and finishing an overdue series' move alike", async () => {
    const { user, api, uid } = await newUser("sw-run");
    const today = await dbToday();
    const notDue = uid("gym");
    const overdue = uid("old");
    const past = advanceDays(today, -45);
    await api.post("/api/v1/sync/push", { changes: { recurring: [
      recRow(notDue, iso(60_000), { frequency: "weekly", startDate: today, nextDate: advanceDays(today, 3) }),
      recRow(overdue, iso(60_000), { frequency: "weekly", startDate: past, nextDate: past }),
    ] } });
    const edits = [
      recRow(notDue, iso(30_000), { name: "edited", frequency: "weekly", startDate: today, nextDate: advanceDays(today, 3) }),
      recRow(overdue, iso(30_000), { name: "edited", frequency: "weekly", startDate: past, nextDate: past }),
    ];

    expect((await api.post(`/api/v1/recurring/${notDue}/run`)).status).toBe(201);
    // The job books the overdue one a step; run-now then only moves it on (200).
    await processRecurring({ userIds: [user.id] });
    await Bun.sleep(5);
    const beforeMove = Date.now();
    const moved = await api.post(`/api/v1/recurring/${overdue}/run`);
    expect([moved.status, moved.json.nextDate]).toEqual([200, advanceDays(today, 7)]);

    for (const id of [notDue, overdue]) {
      expectServerStamp(await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } }), edits[0]!.clientUpdatedAt as string);
    }
    expect((await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: overdue } })).clientUpdatedAt.getTime())
      .toBeGreaterThanOrEqual(beforeMove - 5);

    const c = await settled(user);
    const res = await api.post("/api/v1/sync/push", { changes: { recurring: edits } });
    expect([status(res, "recurring", notDue), status(res, "recurring", overdue)]).toEqual(["stale", "stale"]);
    const pulled = rowsOf((await pullAll(api, c)).pages, "recurring");
    expect(Object.fromEntries(pulled.map((r) => [r.id, [r.name, r.lastCreated, r.nextDate]]))).toEqual({
      [notDue]: ["Rent", today, advanceDays(today, 7)],
      [overdue]: ["Rent", today, advanceDays(today, 7)],
    });
    expect(await prisma.transaction.count({ where: { id: { in: [occurrenceId(notDue, today), occurrenceId(overdue, today)] } } })).toBe(2);
  });

  test("the bill checker's claim stamps the database clock: an older phone edit is stale and the pull returns the moved bill", async () => {
    const { user, api, uid } = await newUser("sw-bill");
    const today = new Date().toISOString().slice(0, 10);
    const id = uid("bill");
    const due = { nextDueDate: today, dueDay: Number(today.slice(8, 10)), isRecurring: true };
    await api.post("/api/v1/sync/push", { changes: { billReminders: [billRow(id, iso(60_000), due)] } });
    const phoneEdit = billRow(id, iso(30_000), { ...due, name: "Power (edited)" });

    const sent: string[] = [];
    await checkBillReminders(checkerFor(user.id, sent));
    expect(sent).toHaveLength(1);
    const claimed = await prisma.billReminder.findUniqueOrThrow({ where: { id } });
    expect(claimed.nextDueDate > today).toBe(true);
    expectServerStamp(claimed, phoneEdit.clientUpdatedAt as string);

    const c = await settled(user);
    expect(status(await api.post("/api/v1/sync/push", { changes: { billReminders: [phoneEdit] } }), "billReminders", id)).toBe("stale");
    const pulled = rowsOf((await pullAll(api, c)).pages, "billReminders");
    expect(pulled).toEqual([expect.objectContaining({
      id, name: "Power", nextDueDate: claimed.nextDueDate, clientUpdatedAt: claimed.clientUpdatedAt.toISOString(),
    })]);
    expect("lastNotifiedAt" in pulled[0]).toBe(false);
  });

  test("REST writes of all four stamp the database clock: older phone edits are stale and the pull returns the server's rows", async () => {
    const { user, api, uid } = await newUser("sw-rest");
    const t0 = iso(60_000);
    await api.post("/api/v1/sync/push", { changes: {
      recurring: [recRow(uid("rec"), t0)], billReminders: [billRow(uid("bill"), t0)], categoryBudgets: [budgetRow("Food", t0)],
    } });
    const before = iso(30_000);

    expect((await api.put(`/api/v1/recurring/${uid("rec")}`, { name: "Rent (REST)" })).status).toBe(200);
    expect((await api.put(`/api/v1/bill-reminders/${uid("bill")}`, { amount: 70 })).status).toBe(200);
    expect((await api.post("/api/v1/category-budgets", { category: "Food", amount: 500 })).status).toBe(200);
    const nw = await api.post("/api/v1/net-worth", { date: "2026-10-11", assets: 10, liabilities: 0 });
    expect(nw.status).toBe(201);

    const [rec, bill, budget, snapshot] = await Promise.all([
      prisma.recurringTransaction.findUniqueOrThrow({ where: { id: uid("rec") } }),
      prisma.billReminder.findUniqueOrThrow({ where: { id: uid("bill") } }),
      prisma.categoryBudget.findUniqueOrThrow({ where: { userId_category: { userId: user.id, category: "Food" } } }),
      prisma.netWorthEntry.findUniqueOrThrow({ where: { id: nw.json.id } }),
    ]);
    for (const row of [rec, bill, budget, snapshot]) expectServerStamp(row, before);

    const c = await settled(user);
    const res = await api.post("/api/v1/sync/push", { changes: {
      recurring: [recRow(uid("rec"), before, { name: "phone" })], billReminders: [billRow(uid("bill"), before, { amount: 1 })],
      categoryBudgets: [budgetRow("Food", before, { amount: 1 })], netWorth: [nwRow(nw.json.id, before, { assets: 1, liabilities: 0, netWorth: 1 })],
    } });
    expect([status(res, "recurring", uid("rec")), status(res, "billReminders", uid("bill")),
      status(res, "categoryBudgets", "Food"), status(res, "netWorth", nw.json.id)]).toEqual(["stale", "stale", "stale", "stale"]);
    const { pages } = await pullAll(api, c);
    expect([rowsOf(pages, "recurring")[0].name, rowsOf(pages, "billReminders")[0].amount,
      rowsOf(pages, "categoryBudgets")[0].amount, rowsOf(pages, "netWorth")[0].assets]).toEqual(["Rent (REST)", 70, 500, 10]);
  });

  test("a pushed bill update re-arms the notifier only when it moves nextDueDate later; REST follows the same rule", async () => {
    const { user, api, uid } = await newUser("sw-rearm");
    const today = new Date().toISOString().slice(0, 10);
    const id = uid("bill");
    const oneOff = { nextDueDate: today, dueDay: Number(today.slice(8, 10)), isRecurring: false };
    await api.post("/api/v1/sync/push", { changes: { billReminders: [billRow(id, iso(60_000), oneOff)] } });
    const sent: string[] = [];
    const check = () => checkBillReminders(checkerFor(user.id, sent));
    await check();
    expect(sent).toHaveLength(1);
    const notifiedAt = (await prisma.billReminder.findUniqueOrThrow({ where: { id } })).lastNotifiedAt;
    expect(notifiedAt).not.toBeNull();
    const armed = async () => (await prisma.billReminder.findUniqueOrThrow({ where: { id } })).lastNotifiedAt === null;

    const push = async (over: Record<string, unknown>) => {
      await Bun.sleep(5);
      const res = await api.post("/api/v1/sync/push", { changes: { billReminders: [billRow(id, iso(), { ...oneOff, ...over })] } });
      expect(status(res, "billReminders", id)).toBe("applied");
    };
    // The same date (a rename, marking it unpaid again): still spent.
    await push({ name: "Power (renamed)" });
    expect(await armed()).toBe(false);
    // An earlier date, one it already fired for: still spent.
    await push({ nextDueDate: advanceDays(today, -1) });
    expect(await armed()).toBe(false);
    await check();
    expect(sent).toHaveLength(1);
    // A later date: re-armed for it.
    await push({ nextDueDate: advanceDays(today, 30) });
    expect(await armed()).toBe(true);

    // REST: notified again for today, then the same rule.
    await prisma.billReminder.update({ where: { id }, data: { nextDueDate: today, lastNotifiedAt: notifiedAt } });
    expect((await api.put(`/api/v1/bill-reminders/${id}`, { isPaid: false, nextDueDate: today })).status).toBe(200);
    expect(await armed()).toBe(false);
    expect((await api.put(`/api/v1/bill-reminders/${id}`, { nextDueDate: advanceDays(today, -2) })).status).toBe(200);
    expect(await armed()).toBe(false);
    expect((await api.put(`/api/v1/bill-reminders/${id}`, { nextDueDate: advanceDays(today, 31) })).status).toBe(200);
    expect(await armed()).toBe(true);
  });

  test("a newer edit that has not seen the latest booking keeps the server's nextDate and lastCreated, by push and by REST", async () => {
    const { user, api, uid } = await newUser("sw-stale-next");
    const today = await dbToday();
    const id = uid("rec");
    const series = { startDate: today, nextDate: today, lastCreated: null };
    await api.post("/api/v1/sync/push", { changes: { recurring: [recRow(id, iso(60_000), series)] } });
    expect(await processRecurring({ userIds: [user.id] })).toBe(1);
    const next = computeNextDate(today, "monthly", anchorDayOf(today));

    // An old copy edited after the booking (so it wins) but read before it.
    await Bun.sleep(5);
    const res = await api.post("/api/v1/sync/push", { changes: { recurring: [recRow(id, iso(), { ...series, name: "Renamed" })] } });
    expect(status(res, "recurring", id)).toBe("applied");
    const kept = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } });
    expect([kept.name, kept.lastCreated, kept.nextDate]).toEqual(["Renamed", today, next]);
    // So the job does not book again, and the phone pulls the merged row.
    expect(await processRecurring({ userIds: [user.id] })).toBe(0);
    expect(rowsOf((await pullAll(api, null)).pages, "recurring")[0]).toMatchObject({ name: "Renamed", lastCreated: today, nextDate: next });

    // A copy that has seen the booking moves nextDate as asked.
    await Bun.sleep(5);
    const later = advanceDays(next, 3);
    await api.post("/api/v1/sync/push", { changes: { recurring: [recRow(id, iso(), { ...series, lastCreated: today, nextDate: later })] } });
    expect((await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } })).nextDate).toBe(later);

    // REST: the whole row read before the booking (lastCreated null) keeps it;
    // a PUT that names only nextDate means it.
    const stale = await api.put(`/api/v1/recurring/${id}`, { ...series, isActive: false });
    expect([stale.status, stale.json.isActive, stale.json.lastCreated, stale.json.nextDate]).toEqual([200, false, today, later]);
    const meant = await api.put(`/api/v1/recurring/${id}`, { nextDate: next });
    expect([meant.json.lastCreated, meant.json.nextDate]).toEqual([today, next]);
  });
});
