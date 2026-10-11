/**
 * Stale answers converge (I-WIRE, rev 5). A push that loses changes no data,
 * but the winner — the live row or the tombstone — must come back on the
 * losing device's next incremental pull, even when that device's cursor had
 * already passed it. Otherwise a device whose clock runs behind keeps its
 * losing version forever.
 *
 * Every case starts from a cursor settled at the database's current time, so
 * nothing written before it would be sent again by the safety lag: whatever
 * the next pull carries, it carries because of the stale answer.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { app } from "../../index";
import { prisma } from "../../prisma";
import { EPOCH_ISO } from "./constants";
import { encodeCursor, userTag } from "./cursor";
import { winnersToResend } from "./push";
import { databaseNowMs } from "./sql";
import { client, createTestUser, deleteTestUsers, type TestUser } from "./testing";

const users: TestUser[] = [];
afterAll(() => deleteTestUsers(users));

async function newUser(label: string) {
  const user = await createTestUser(label);
  users.push(user);
  const api = client(app, user);
  /** A cursor past everything written so far; asserted quiet before use. */
  const settled = async () => {
    await Bun.sleep(5);
    const cursor = encodeCursor({ mode: "rest", user: userTag(user.id), t: await databaseNowMs(prisma) });
    const quiet = await pull(cursor);
    expect([Object.values(quiet.changes).flat().length, quiet.deletions.length]).toEqual([0, 0]);
    return cursor;
  };
  const pull = async (cursor: string) => (await api.get(`/api/v1/sync/pull?cursor=${cursor}`)).json;
  const push = async (changes: unknown) => (await api.post("/api/v1/sync/push", { changes })).json;
  return { user, api, uid: (s: string) => `${s}_${user.id}`, settled, pull, push };
}

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const CREATED = iso(3_600_000);
const statuses = (res: any, entity: string) => res.results[entity].map((r: any) => `${r.id}:${r.status}`);
const tx = (id: string, cu: string, amount = 10, over: Record<string, unknown> = {}) => ({
  id, clientUpdatedAt: cu, amount, category: "Food", type: "Expense", isImpulse: false, note: null,
  dateISO: "2026-10-11", accountId: null, currency: "EUR", createdAt: CREATED, ...over,
});
const settings = (cu: string, over: Record<string, unknown> = {}) => ({
  id: "settings", clientUpdatedAt: cu, monthlyBudget: 900, startingBalance: 0, hourlyValue: 0, showTimeCost: false,
  currency: "EUR", currencySymbol: "€", monthlyIncome: 0, savingsGoal: 0, spendingStyle: "moderate",
  primaryGoal: "save", locale: "fr", ...over,
});

describe("a stale answer sends the winner back", () => {
  test("an older edit of a live row: the row comes back unchanged, data and clientUpdatedAt included", async () => {
    const { user, uid, settled, pull, push } = await newUser("stale-live");
    const won = iso(30_000);
    const account = {
      id: uid("acc"), clientUpdatedAt: won, name: "Wallet", type: "cash", openingBalance: 50, currency: "EUR",
      color: "#000000", icon: "wallet", isDefault: false, createdAt: won,
    };
    await push({ accounts: [account], transactions: [tx(uid("tx"), won, 10, { accountId: uid("acc") })] });
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id: uid("tx") } });
    const accountBefore = await prisma.bankAccount.findUniqueOrThrow({ where: { id: uid("acc") } });
    const cursor = await settled();

    const lost = await push({
      accounts: [{ ...account, clientUpdatedAt: iso(600_000), name: "Skewed", openingBalance: 999 }],
      transactions: [tx(uid("tx"), iso(600_000), 99, { accountId: uid("acc") })],
    });
    expect([...statuses(lost, "accounts"), ...statuses(lost, "transactions")])
      .toEqual([`${uid("acc")}:stale`, `${uid("tx")}:stale`]);

    const back = await pull(cursor);
    expect(back.changes.transactions).toEqual([tx(uid("tx"), won, 10, { accountId: uid("acc") })]);
    expect(back.changes.accounts).toEqual([account]);

    // Only the pull position moved: no data, no client time, no derived balance.
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: uid("tx") } });
    expect({ ...after, serverUpdatedAt: null }).toEqual({ ...before, serverUpdatedAt: null });
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    const accountAfter = await prisma.bankAccount.findUniqueOrThrow({ where: { id: uid("acc") } });
    expect([accountAfter.name, accountAfter.openingBalance, accountAfter.balance, accountAfter.clientUpdatedAt])
      .toEqual([accountBefore.name, accountBefore.openingBalance, accountBefore.balance, accountBefore.clientUpdatedAt]);
    void user;
  });

  test("an older edit of a deleted row: the deletion comes back, with the delete's own time", async () => {
    const { user, uid, settled, pull, push } = await newUser("stale-tomb");
    await push({ transactions: [tx(uid("tx"), iso(60_000))] });
    const deletedAt = iso(20_000);
    await push({ transactions: [{ id: uid("tx"), clientUpdatedAt: deletedAt, deleted: true }] });
    const tombBefore = await prisma.syncTombstone.findUniqueOrThrow({
      where: { userId_entity_syncId: { userId: user.id, entity: "transactions", syncId: uid("tx") } },
    });
    const cursor = await settled();

    const lost = await push({ transactions: [tx(uid("tx"), iso(600_000), 77)] });
    expect(statuses(lost, "transactions")).toEqual([`${uid("tx")}:stale`]);
    expect(await prisma.transaction.count({ where: { id: uid("tx") } })).toBe(0);

    const back = await pull(cursor);
    expect(back.deletions).toEqual([{ entity: "transactions", id: uid("tx"), clientUpdatedAt: deletedAt }]);
    const tombAfter = await prisma.syncTombstone.findUniqueOrThrow({ where: { id: tombBefore.id } });
    expect(tombAfter.clientUpdatedAt).toEqual(tombBefore.clientUpdatedAt);
    expect(tombAfter.deletedAt.getTime()).toBeGreaterThan(tombBefore.deletedAt.getTime());
  });

  test("an older delete of a newer row: the live row comes back, not a deletion", async () => {
    const { uid, settled, pull, push } = await newUser("stale-delete");
    const won = iso(10_000);
    await push({ transactions: [tx(uid("tx"), won, 42)] });
    const cursor = await settled();
    const lost = await push({ transactions: [{ id: uid("tx"), clientUpdatedAt: iso(600_000), deleted: true }] });
    expect(statuses(lost, "transactions")).toEqual([`${uid("tx")}:stale`]);
    const back = await pull(cursor);
    expect([back.changes.transactions, back.deletions]).toEqual([[tx(uid("tx"), won, 42)], []]);
  });

  test("a fresh device's epoch-dated settings: the real settings come back to it", async () => {
    const { user, settled, pull, push } = await newUser("stale-epoch");
    const real = iso(60_000);
    await push({ settings: [settings(real)] });
    const cursor = await settled();
    const fresh = await push({ settings: [settings(EPOCH_ISO, { monthlyBudget: 0, locale: "en", primaryGoal: "track" })] });
    expect(statuses(fresh, "settings")).toEqual(["settings:stale"]);
    const back = await pull(cursor);
    expect(back.changes.settings).toEqual([settings(real)]);
    const stored = await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });
    expect([stored.monthlyBudget, stored.locale, stored.clientUpdatedAt.toISOString()]).toEqual([900, "fr", real]);
  });

  test("in a batch with applied rows, only the stale rows' winners are re-sent, and once", async () => {
    const { uid, settled, pull, push } = await newUser("stale-batch");
    const t = iso(60_000);
    await push({
      transactions: [tx(uid("winner"), iso(5_000), 1), tx(uid("untouched"), t, 2), tx(uid("edited"), t, 3), tx(uid("both"), t, 4)],
      categories: [{ id: "Gone", clientUpdatedAt: t, icon: "", color: "#000000", createdAt: t }],
    });
    await push({ categories: [{ id: "Gone", clientUpdatedAt: iso(30_000), deleted: true }] });
    const cursor = await settled();

    const res = await push({
      transactions: [
        tx(uid("new"), iso(), 5),                 // applied: inserted
        tx(uid("winner"), iso(600_000), 6),       // stale against a live row
        tx(uid("edited"), iso(), 7),              // applied: updated
        tx(uid("both"), iso(600_000), 8),         // stale first...
        tx(uid("both"), iso(), 9),                // ...then applied: its own write sends it
      ],
      categories: [{ id: "Gone", clientUpdatedAt: iso(600_000), icon: "", color: "#111111", createdAt: t }], // stale against a tombstone
    });
    expect(statuses(res, "transactions")).toEqual([
      `${uid("new")}:applied`, `${uid("winner")}:stale`, `${uid("edited")}:applied`, `${uid("both")}:stale`, `${uid("both")}:applied`,
    ]);
    expect(statuses(res, "categories")).toEqual(["Gone:stale"]);

    const back = await pull(cursor);
    const sent = back.changes.transactions.map((r: any) => `${r.id}=${r.amount}`).sort();
    expect(sent).toEqual([`${uid("both")}=9`, `${uid("edited")}=7`, `${uid("new")}=5`, `${uid("winner")}=1`].sort());
    expect(back.deletions.map((d: any) => `${d.entity}/${d.id}`)).toEqual(["categories/Gone"]);
    // A row the push did not name stays where it was.
    expect(sent.some((s: string) => s.startsWith(uid("untouched")))).toBe(false);
  });
});

test("winnersToResend: stale ids not written anyway, split by what they lost to", () => {
  const initial = new Map([
    ["row", { live: { owner: "me", cu: 10 }, tomb: null }],
    ["both", { live: { owner: "me", cu: 10 }, tomb: 50 }],
    ["tomb", { live: null, tomb: 10 }],
    ["rewritten", { live: { owner: "me", cu: 10 }, tomb: null }],
  ]);
  const plan = {
    results: [
      { id: "tomb", status: "stale" as const }, { id: "row", status: "stale" as const }, { id: "both", status: "stale" as const },
      { id: "rewritten", status: "stale" as const }, { id: "rewritten", status: "applied" as const },
      { id: "theirs", status: "forbidden" as const }, { id: "bad", status: "invalid" as const },
    ],
    ops: [{ kind: "update" as const, id: "rewritten", cu: 20, values: {}, dropTombstone: false }],
  };
  // The live row is the current state when a row and a tombstone coexist.
  expect(winnersToResend(plan, initial)).toEqual({ rows: ["both", "row"], tombstones: ["tomb"] });
});
