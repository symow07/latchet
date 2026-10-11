/**
 * The sync protocol over HTTP, through the real app (index.ts): session
 * middleware, both mounts, the error handlers and the database triggers.
 * Users and sessions are real; every id is unique to this file's users.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { app } from "../index";
import { prisma } from "../prisma";
import { EPOCH_ISO, MAX_SYNC_ROWS, PULL_SAFETY_LAG_MS } from "../lib/sync/constants";
import { CURSOR_MAX_AGE_MS, decodeCursor, encodeCursor, userTag } from "../lib/sync/cursor";
import { client, createTestUser, deleteTestUsers, type TestUser } from "../lib/sync/testing";

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
    } });
    expect(push.status).toBe(200);
    expect(push.json.results).toEqual({
      settings: [{ id: "settings", status: "applied" }],
      categories: [{ id: "Pets", status: "applied" }],
      accounts: [{ id: uid("acc"), status: "applied" }],
      transactions: [{ id: uid("tx"), status: "applied" }],
      subscriptions: [{ id: "sub_netflix", status: "applied" }],
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
