/**
 * The database triggers from the init migration, exercised against the real
 * test database (prisma/migrations/20261011120000_postgres_init).
 *
 *   serverUpdatedAt  stamped by the database clock, in UTC, on every write
 *   balance          openingBalance + Σ Income − Σ Expense, kept by trigger
 *   SyncTombstone    one per deleted synced row, however it was deleted
 *
 * These are the guarantees the sync API is built on, and none of them is
 * visible from application code: a route that forgets nothing still depends
 * on every one of them. So they are asserted here directly.
 *
 * Every row this file creates hangs off users whose ids carry a per-run
 * prefix; deleting those users (and their tombstones, which have no foreign
 * key) is the whole cleanup.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "./prisma";

const P = `trg_${Date.now().toString(36)}_`;
let seq = 0;
const id = (label: string) => `${P}${label}_${++seq}`;

async function makeUser(label: string): Promise<string> {
  const userId = id(`user_${label}`);
  await prisma.user.create({
    data: { id: userId, name: label, email: `${userId}@x.test` },
  });
  return userId;
}

async function makeAccount(userId: string, openingBalance = 0, label = "acc"): Promise<string> {
  const accountId = id(label);
  await prisma.bankAccount.create({
    data: { id: accountId, userId, name: label, type: "checking", openingBalance },
  });
  return accountId;
}

function txData(userId: string, accountId: string | null, amount: number, type: "Expense" | "Income") {
  return {
    id: id("tx"),
    userId,
    accountId,
    amount,
    category: "Food",
    type,
    dateISO: "2026-10-11",
  };
}

async function balanceOf(accountId: string): Promise<number> {
  return (await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } })).balance;
}

/** What the balance must be, computed here from the rows themselves. */
async function expectedBalance(accountId: string): Promise<number> {
  const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
  const rows = await prisma.transaction.findMany({ where: { accountId } });
  return rows.reduce((b, t) => b + (t.type === "Income" ? t.amount : -t.amount), account.openingBalance);
}

async function tombstone(userId: string, entity: string, syncId: string) {
  return prisma.syncTombstone.findUnique({
    where: { userId_entity_syncId: { userId, entity, syncId } },
  });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.syncTombstone.deleteMany({ where: { userId: { startsWith: P } } });
}

beforeAll(cleanup);
afterAll(cleanup);

// ── Balance ──────────────────────────────────────────────────────────────────

test("balance follows inserts, updates, deletes and the opening balance", async () => {
  const user = await makeUser("ledger");
  const acc = await makeAccount(user, 100);
  expect(await balanceOf(acc)).toBe(100);

  const coffee = txData(user, acc, 30, "Expense");
  const refund = txData(user, acc, 10, "Income");
  await prisma.transaction.create({ data: coffee });
  expect(await balanceOf(acc)).toBe(70);
  await prisma.transaction.create({ data: refund });
  expect(await balanceOf(acc)).toBe(80);

  await prisma.transaction.update({ where: { id: coffee.id }, data: { amount: 50 } });
  expect(await balanceOf(acc)).toBe(60);

  // Income turned out to be a charge.
  await prisma.transaction.update({ where: { id: refund.id }, data: { type: "Expense" } });
  expect(await balanceOf(acc)).toBe(40);

  await prisma.bankAccount.update({ where: { id: acc }, data: { openingBalance: 200 } });
  expect(await balanceOf(acc)).toBe(140);

  await prisma.transaction.delete({ where: { id: coffee.id } });
  expect(await balanceOf(acc)).toBe(190);
});

test("balance is derived even when the app tries to write it", async () => {
  // The phone never sends a balance; a client that does is ignored at insert.
  const user = await makeUser("forged");
  const accountId = id("acc");
  const created = await prisma.bankAccount.create({
    data: { id: accountId, userId: user, name: "Forged", type: "cash", openingBalance: 5, balance: 999_999 },
  });
  expect(created.balance).toBe(5);
});

test("an edit that moves no money leaves the account untouched", async () => {
  const user = await makeUser("noop");
  const acc = await makeAccount(user, 0);
  const t = txData(user, acc, 12, "Expense");
  await prisma.transaction.create({ data: t });
  const before = await prisma.bankAccount.findUniqueOrThrow({ where: { id: acc } });

  await Bun.sleep(5);
  await prisma.transaction.update({ where: { id: t.id }, data: { note: "lunch", category: "Other" } });

  const after = await prisma.bankAccount.findUniqueOrThrow({ where: { id: acc } });
  expect(after.balance).toBe(-12);
  // Not rewritten at all, so it does not resurface in the next pull either.
  expect(after.serverUpdatedAt.getTime()).toBe(before.serverUpdatedAt.getTime());
});

test("a transaction moved between accounts updates both, and so does unlinking it", async () => {
  const user = await makeUser("move");
  const a = await makeAccount(user, 0, "A");
  const b = await makeAccount(user, 0, "B");
  const t = txData(user, a, 25, "Expense");
  await prisma.transaction.create({ data: t });
  expect([await balanceOf(a), await balanceOf(b)]).toEqual([-25, 0]);

  await prisma.transaction.update({ where: { id: t.id }, data: { accountId: b } });
  expect([await balanceOf(a), await balanceOf(b)]).toEqual([0, -25]);

  // No account: the money is in no balance at all.
  await prisma.transaction.update({ where: { id: t.id }, data: { accountId: null } });
  expect([await balanceOf(a), await balanceOf(b)]).toEqual([0, 0]);

  await prisma.transaction.update({ where: { id: t.id }, data: { accountId: a, amount: 40 } });
  expect([await balanceOf(a), await balanceOf(b)]).toEqual([-40, 0]);
});

test("an upsert, insert or update, keeps the balances right", async () => {
  // Prisma turns an upsert into INSERT … ON CONFLICT DO UPDATE, which fires the
  // insert and the update statement triggers with the right transition rows.
  const user = await makeUser("upsert");
  const a = await makeAccount(user, 0, "A");
  const b = await makeAccount(user, 0, "B");
  const t = txData(user, a, 15, "Expense");
  const { id: txId, ...fields } = t;

  await prisma.transaction.upsert({ where: { id: txId }, create: t, update: fields });
  expect([await balanceOf(a), await balanceOf(b)]).toEqual([-15, 0]);

  await prisma.transaction.upsert({
    where: { id: txId },
    create: t,
    update: { ...fields, accountId: b, amount: 20, type: "Income" },
  });
  expect([await balanceOf(a), await balanceOf(b)]).toEqual([0, 20]);
});

test("a bulk insert across accounts derives every balance once, correctly", async () => {
  const user = await makeUser("bulk");
  const a = await makeAccount(user, 1000, "A");
  const b = await makeAccount(user, 0, "B");
  const rows = Array.from({ length: 60 }, (_, i) =>
    txData(user, i % 3 === 0 ? b : i % 3 === 1 ? a : null, i + 1, i % 4 === 0 ? "Income" : "Expense")
  );
  await prisma.transaction.createMany({ data: rows });

  const sum = (acc: string | null) =>
    rows.filter((r) => r.accountId === acc).reduce((s, r) => s + (r.type === "Income" ? r.amount : -r.amount), 0);
  expect(await balanceOf(a)).toBe(1000 + sum(a));
  expect(await balanceOf(b)).toBe(sum(b));

  await prisma.transaction.deleteMany({ where: { accountId: a } });
  expect(await balanceOf(a)).toBe(1000);
});

test("concurrent inserts into one account lose no money", async () => {
  // Each insert runs on its own pooled connection. A trigger that summed the
  // ledger before taking the account's lock would miss rows committed while
  // it waited.
  const user = await makeUser("race");
  const acc = await makeAccount(user, 0);
  const amounts = Array.from({ length: 30 }, (_, i) => i + 1);
  await Promise.all(amounts.map((n) => prisma.transaction.create({ data: txData(user, acc, n, "Income") })));
  expect(await balanceOf(acc)).toBe(amounts.reduce((s, n) => s + n, 0));
});

test("concurrent moves in opposite directions neither deadlock nor drift", async () => {
  // Accounts are locked in id order, so A→B and B→A cannot wait on each other.
  const user = await makeUser("crossing");
  const a = await makeAccount(user, 0, "A");
  const b = await makeAccount(user, 0, "B");
  const fromA = Array.from({ length: 8 }, (_, i) => txData(user, a, 10 + i, "Expense"));
  const fromB = Array.from({ length: 8 }, (_, i) => txData(user, b, 100 + i, "Expense"));
  await prisma.transaction.createMany({ data: [...fromA, ...fromB] });

  for (let round = 0; round < 3; round++) {
    const there = round % 2 === 0;
    await Promise.all([
      ...fromA.map((t) => prisma.transaction.update({ where: { id: t.id }, data: { accountId: there ? b : a } })),
      ...fromB.map((t) => prisma.transaction.update({ where: { id: t.id }, data: { accountId: there ? a : b } })),
    ]);
  }
  expect(await balanceOf(a)).toBe(await expectedBalance(a));
  expect(await balanceOf(b)).toBe(await expectedBalance(b));
  expect(await balanceOf(a)).toBe(-fromB.reduce((s, t) => s + t.amount, 0));
});

test("truncating the ledger returns every account to its opening balance", async () => {
  // TRUNCATE fires no delete trigger of its own. Run inside a transaction that
  // is rolled back, so the shared test database keeps its other rows.
  const user = await makeUser("truncate");
  const acc = await makeAccount(user, 50);
  await prisma.transaction.create({ data: txData(user, acc, 20, "Expense") });
  expect(await balanceOf(acc)).toBe(30);

  class Rollback extends Error {}
  let seen = null as number | null;
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe('TRUNCATE "Transaction"');
      seen = (await tx.bankAccount.findUniqueOrThrow({ where: { id: acc } })).balance;
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  expect(seen).toBe(50);
  expect(await balanceOf(acc)).toBe(30);
});

// ── serverUpdatedAt ──────────────────────────────────────────────────────────

test("serverUpdatedAt is the database's UTC clock, advances on every write, and cannot be forged", async () => {
  const user = await makeUser("stamp");
  const acc = await makeAccount(user, 0);
  const t = txData(user, acc, 1, "Expense");

  const start = Date.now();
  // A client-supplied value is overwritten: the cursor must not be steerable.
  const created = await prisma.transaction.create({ data: { ...t, serverUpdatedAt: new Date(0) } });
  const first = created.serverUpdatedAt.getTime();
  // UTC, whatever the session time zone (Prisma stores DateTime as UTC wall
  // time; a stamp converted with a local zone would be hours off).
  expect(Math.abs(first - start)).toBeLessThan(60_000);

  await Bun.sleep(5);
  const updated = await prisma.transaction.update({ where: { id: t.id }, data: { note: "edited" } });
  expect(updated.serverUpdatedAt.getTime()).toBeGreaterThan(first);

  // The other synced tables are stamped too.
  const settings = await prisma.userSettings.create({ data: { id: id("settings"), userId: user } });
  const category = await prisma.customCategory.create({ data: { userId: user, name: "Pets" } });
  const subscription = await prisma.subscription.create({
    data: { userId: user, syncId: "sub_1", merchantDisplay: "Netflix", merchantNormalized: "netflix" },
  });
  const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: acc } });
  for (const row of [settings, category, subscription, account]) {
    expect(Math.abs(row.serverUpdatedAt.getTime() - start)).toBeLessThan(60_000);
  }

  await Bun.sleep(5);
  const renamed = await prisma.customCategory.update({ where: { id: category.id }, data: { color: "#000000" } });
  expect(renamed.serverUpdatedAt.getTime()).toBeGreaterThan(category.serverUpdatedAt.getTime());
});

// ── Tombstones ───────────────────────────────────────────────────────────────

test("deleting each synced entity leaves a tombstone keyed by its sync id", async () => {
  const user = await makeUser("tomb");
  const acc = await makeAccount(user, 0);
  const t = txData(user, acc, 3, "Expense");
  const clientTime = new Date("2026-10-01T12:00:00.000Z");
  await prisma.transaction.create({ data: { ...t, clientUpdatedAt: clientTime } });
  await prisma.userSettings.create({ data: { id: id("settings"), userId: user } });
  await prisma.customCategory.create({ data: { userId: user, name: "Pets" } });
  await prisma.subscription.create({
    data: { userId: user, syncId: "sub_netflix", merchantDisplay: "Netflix", merchantNormalized: "netflix" },
  });

  const before = Date.now();
  await prisma.transaction.delete({ where: { id: t.id } });
  await prisma.userSettings.delete({ where: { userId: user } });
  await prisma.customCategory.delete({ where: { userId_name: { userId: user, name: "Pets" } } });
  await prisma.subscription.delete({ where: { userId_syncId: { userId: user, syncId: "sub_netflix" } } });
  await prisma.bankAccount.delete({ where: { id: acc } });

  const txTomb = await tombstone(user, "transactions", t.id);
  expect(txTomb).not.toBeNull();
  // The deleted row's client time travels with it, for last-writer-wins.
  expect(txTomb!.clientUpdatedAt.toISOString()).toBe(clientTime.toISOString());
  expect(Math.abs(txTomb!.deletedAt.getTime() - before)).toBeLessThan(60_000);

  expect(await tombstone(user, "settings", "settings")).not.toBeNull();
  expect(await tombstone(user, "categories", "Pets")).not.toBeNull();
  expect(await tombstone(user, "subscriptions", "sub_netflix")).not.toBeNull();
  expect(await tombstone(user, "accounts", acc)).not.toBeNull();
  expect(await prisma.syncTombstone.count({ where: { userId: user } })).toBe(5);
});

test("deleting an account unlinks its transactions and marks them changed", async () => {
  const user = await makeUser("unlink");
  const acc = await makeAccount(user, 10);
  const t = txData(user, acc, 4, "Expense");
  const created = await prisma.transaction.create({ data: t });

  await Bun.sleep(5);
  await prisma.bankAccount.delete({ where: { id: acc } });

  const after = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } });
  expect(after.accountId).toBeNull();
  // The unlink is a change the phones must pull.
  expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(created.serverUpdatedAt.getTime());
  expect(await tombstone(user, "accounts", acc)).not.toBeNull();
  expect(await tombstone(user, "transactions", t.id)).toBeNull();
});

test("delete, re-create, delete the same row: one tombstone, moved forward, never backward", async () => {
  const user = await makeUser("again");
  const t = txData(user, null, 9, "Expense");
  const t1 = new Date("2026-10-01T00:00:00.000Z");
  const t2 = new Date("2026-10-02T00:00:00.000Z");

  await prisma.transaction.create({ data: { ...t, clientUpdatedAt: t1 } });
  await prisma.transaction.delete({ where: { id: t.id } });
  const first = await tombstone(user, "transactions", t.id);
  expect(first!.clientUpdatedAt.toISOString()).toBe(t1.toISOString());

  // Re-creating does not remove the tombstone: that is the sync push's call.
  await prisma.transaction.create({ data: { ...t, clientUpdatedAt: t2 } });
  expect(await tombstone(user, "transactions", t.id)).not.toBeNull();

  await Bun.sleep(5);
  await prisma.transaction.delete({ where: { id: t.id } });
  const second = await tombstone(user, "transactions", t.id);
  expect(await prisma.syncTombstone.count({ where: { userId: user, entity: "transactions", syncId: t.id } })).toBe(1);
  expect(second!.id).toBe(first!.id);
  expect(second!.deletedAt.getTime()).toBeGreaterThan(first!.deletedAt.getTime());
  expect(second!.clientUpdatedAt.toISOString()).toBe(t2.toISOString());

  // A copy carrying an older client time cannot pull the tombstone back.
  await prisma.transaction.create({ data: { ...t, clientUpdatedAt: t1 } });
  await prisma.transaction.delete({ where: { id: t.id } });
  expect((await tombstone(user, "transactions", t.id))!.clientUpdatedAt.toISOString()).toBe(t2.toISOString());
});

test("deleting a user cascades through every synced table without failing", async () => {
  // The tombstone trigger fires inside the user's own cascade. With a foreign
  // key from SyncTombstone to User this delete would fail.
  const user = await makeUser("gone");
  const acc = await makeAccount(user, 100);
  await prisma.transaction.createMany({
    data: [txData(user, acc, 5, "Expense"), txData(user, null, 6, "Income")],
  });
  await prisma.userSettings.create({ data: { id: id("settings"), userId: user } });
  await prisma.customCategory.create({ data: { userId: user, name: "Pets" } });
  await prisma.subscription.create({
    data: { userId: user, syncId: "sub_x", merchantDisplay: "X", merchantNormalized: "x" },
  });

  await prisma.user.delete({ where: { id: user } });

  const left = await Promise.all([
    prisma.transaction.count({ where: { userId: user } }),
    prisma.bankAccount.count({ where: { userId: user } }),
    prisma.userSettings.count({ where: { userId: user } }),
    prisma.customCategory.count({ where: { userId: user } }),
    prisma.subscription.count({ where: { userId: user } }),
  ]);
  expect(left).toEqual([0, 0, 0, 0, 0]);
  // Orphaned tombstones, one per deleted row; retention purges them.
  const entities = (await prisma.syncTombstone.findMany({ where: { userId: user }, select: { entity: true } }))
    .map((r) => r.entity)
    .sort();
  expect(entities).toEqual(["accounts", "categories", "settings", "subscriptions", "transactions", "transactions"]);
});
