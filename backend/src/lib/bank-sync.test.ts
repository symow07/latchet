import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "../prisma";
import {
  bankAccountId, mirrorBankAccount, persistConnection, syncConnectionTransactions, transactionId,
} from "./bank-sync";
import type { BankProvider, ProviderAccount, ProviderTransaction, TransactionPage } from "./bank-providers";

test("local ids are namespaced by provider", () => {
  expect(transactionId("saltedge", "abc")).toBe("saltedge_abc");
  expect(bankAccountId("saltedge", "abc")).toBe("acc_saltedge_abc");
});

test("Plaid ids keep the exact format rows were already written with", () => {
  // The refactor must not orphan existing rows: before the abstraction these
  // were built inline as `plaid_${transaction_id}` and `acc_plaid_${account_id}`.
  expect(transactionId("plaid", "tx_123")).toBe("plaid_tx_123");
  expect(bankAccountId("plaid", "acct_123")).toBe("acc_plaid_acct_123");
});

test("two providers cannot collide on the same external id", () => {
  expect(transactionId("plaid", "1")).not.toBe(transactionId("truelayer", "1"));
});

// ─── Booking against a provider, through the database ───────────────────────
// A scripted provider: the test sets what the "bank" reports before each sync.

interface Bank {
  accounts: ProviderAccount[];
  pages: TransactionPage[];
  failAccounts?: boolean;
}

const users: string[] = [];
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.syncTombstone.deleteMany({ where: { userId: { in: users } } });
});

/** A user, a provider id unique to the test, and the bank it talks to. */
async function setup(label: string) {
  const tag = `${label}${crypto.randomUUID().slice(0, 8)}`;
  const userId = `banksync_${tag}`;
  users.push(userId);
  const now = new Date();
  await prisma.user.create({ data: { id: userId, name: label, email: `${userId}@bank.test`, createdAt: now, updatedAt: now } });

  const bank: Bank = { accounts: [], pages: [] };
  const provider: BankProvider = {
    id: `fake${tag}`,
    isConfigured: () => true,
    createLinkSession: async () => ({ linkToken: "lt", hostedUrl: null, expiresAt: null }),
    exchange: async () => ({ externalId: `item_${tag}`, accessToken: "access" }),
    listAccounts: async () => {
      if (bank.failAccounts) throw new Error("provider unreachable");
      return bank.accounts.map((a) => ({ ...a }));
    },
    syncTransactions: async () => bank.pages.shift() ?? { added: [], modified: [], removedExternalIds: [], cursor: "end", hasMore: false },
    removeConnection: async () => {},
    verifyWebhook: async () => ({ ok: true }),
    parseWebhook: () => ({ kind: "ignored" }),
  };
  // Provider account ids are unique across every connection (PlaidAccount has
  // a unique key on them), so each test gets its own.
  const ext = (name: string) => `${tag}-${name}`;
  const account = (name: string, balance: number): ProviderAccount =>
    ({ externalId: ext(name), name: "Checking", mask: "1234", type: "checking", balance, currency: "USD" });
  const tx = (externalId: string, amount: number, type: "Expense" | "Income", accountName = "chk"): ProviderTransaction =>
    ({ externalId, accountExternalId: ext(accountName), amount, type, category: "Food", note: "Coffee", dateISO: "2026-10-10", currency: "USD" });
  const page = (p: Partial<TransactionPage>): TransactionPage =>
    ({ added: [], modified: [], removedExternalIds: [], cursor: `c${Math.random()}`, hasMore: false, ...p });
  const localAccount = (name = "chk") =>
    prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId(provider.id, ext(name)) } });
  const link = () => persistConnection(userId, provider, { externalId: `item_${tag}`, accessToken: "access" });

  return { userId, bank, provider, ext, account, tx, page, localAccount, link };
}

describe("bank sync and the derived balance", () => {
  test("after the first link, the mirrored account's derived balance is the provider's balance", async () => {
    const s = await setup("first");
    s.bank.accounts = [s.account("chk", 1000)];
    s.bank.pages = [s.page({ added: [s.tx("t1", 50, "Expense"), s.tx("t2", 200, "Income"), s.tx("t3", 30, "Expense")] })];
    await s.link();

    const acc = await s.localAccount();
    expect(acc.balance).toBeCloseTo(1000, 9);
    // The ledger explains +120 of it; the opening balance is the rest.
    expect(acc.openingBalance).toBeCloseTo(880, 9);
    const booked = await prisma.transaction.findMany({ where: { userId: s.userId }, orderBy: { id: "asc" } });
    expect(booked.map((t) => [t.id, t.accountId])).toEqual(
      ["t1", "t2", "t3"].map((e) => [transactionId(s.provider.id, e), acc.id])
    );
  });

  test("modified and removed charges move the ledger, and the balance still matches the bank", async () => {
    const s = await setup("changes");
    s.bank.accounts = [s.account("chk", 500)];
    s.bank.pages = [s.page({ added: [s.tx("t1", 50, "Expense"), s.tx("t2", 30, "Expense")] })];
    const item = await s.link();
    expect((await s.localAccount()).balance).toBeCloseTo(500, 9);

    // The pending 50 posts at 60, the 30 is reversed, a new 15 arrives, and the
    // bank now reports 485.
    s.bank.accounts = [s.account("chk", 485)];
    s.bank.pages = [s.page({ added: [s.tx("t3", 15, "Expense")], modified: [s.tx("t1", 60, "Expense")], removedExternalIds: ["t2"] })];
    await syncConnectionTransactions(item.id, s.provider);

    const acc = await s.localAccount();
    expect(acc.balance).toBeCloseTo(485, 9);
    expect(acc.openingBalance).toBeCloseTo(485 + 75, 9);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId(s.provider.id, "t1") } })).amount).toBe(60);
    expect(await prisma.transaction.count({ where: { id: transactionId(s.provider.id, "t2") } })).toBe(0);
  });

  test("a hand-entered transaction on a linked account does not move it off the bank's balance", async () => {
    const s = await setup("manual");
    s.bank.accounts = [s.account("chk", 300)];
    const item = await s.link();
    const acc = await s.localAccount();
    await prisma.transaction.create({ data: {
      id: `manual_${s.userId}`, userId: s.userId, accountId: acc.id, amount: 40, category: "Food", type: "Expense", dateISO: "2026-10-10",
    } });
    await syncConnectionTransactions(item.id, s.provider);
    expect((await s.localAccount()).balance).toBeCloseTo(300, 9);
  });

  test("booked rows carry the server's time, and a removal's tombstone too", async () => {
    const s = await setup("stamps");
    s.bank.accounts = [s.account("chk", 100)];
    s.bank.pages = [s.page({ added: [s.tx("t1", 10, "Expense")] })];
    const before = Date.now();
    const item = await s.link();
    const id = transactionId(s.provider.id, "t1");
    const booked = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(booked.clientUpdatedAt.getTime()).toBeGreaterThanOrEqual(before - 5);
    expect((await s.localAccount()).clientUpdatedAt.getTime()).toBeGreaterThanOrEqual(before - 5);

    // An old device edit cannot outlive the bank removing the charge.
    await prisma.transaction.update({ where: { id }, data: { clientUpdatedAt: new Date(0) } });
    const removedAt = Date.now();
    s.bank.pages = [s.page({ removedExternalIds: ["t1"] })];
    await syncConnectionTransactions(item.id, s.provider);
    const tomb = await prisma.syncTombstone.findUniqueOrThrow({
      where: { userId_entity_syncId: { userId: s.userId, entity: "transactions", syncId: id } },
    });
    expect(tomb.clientUpdatedAt.getTime()).toBeGreaterThanOrEqual(removedAt - 5);
  });

  test("a re-delivered or unchanged row is not rewritten, so devices are not sent it again", async () => {
    const s = await setup("idempotent");
    s.bank.accounts = [s.account("chk", 100)];
    s.bank.pages = [s.page({ added: [s.tx("t1", 10, "Expense")] })];
    const item = await s.link();
    const id = transactionId(s.provider.id, "t1");
    const tx1 = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    const acc1 = await s.localAccount();

    s.bank.pages = [s.page({ added: [s.tx("t1", 10, "Expense")] })];
    expect(await syncConnectionTransactions(item.id, s.provider)).toBe(0);
    const tx2 = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    const acc2 = await s.localAccount();
    expect(tx2.serverUpdatedAt).toEqual(tx1.serverUpdatedAt);
    expect(acc2.serverUpdatedAt).toEqual(acc1.serverUpdatedAt);
    expect(acc2.balance).toBeCloseTo(100, 9);
  });

  test("when the provider cannot report balances after booking, the last reported one is kept", async () => {
    const s = await setup("offline");
    s.bank.accounts = [s.account("chk", 250)];
    const item = await s.link();
    s.bank.failAccounts = true;
    s.bank.pages = [s.page({ added: [s.tx("t1", 25, "Expense")] })];
    await syncConnectionTransactions(item.id, s.provider);
    // Not 225: the booked charge is already inside the balance the bank reported.
    expect((await s.localAccount()).balance).toBeCloseTo(250, 9);
  });

  test("a mirrored account the user deleted is re-created before booking, instead of failing the sync", async () => {
    const s = await setup("deleted");
    s.bank.accounts = [s.account("chk", 400)];
    const item = await s.link();
    // Deleted on a phone and pushed: the link is still active.
    await prisma.bankAccount.delete({ where: { id: (await s.localAccount()).id } });
    s.bank.pages = [s.page({ added: [s.tx("t1", 40, "Expense")] })];
    expect(await syncConnectionTransactions(item.id, s.provider)).toBe(1);
    const acc = await s.localAccount();
    expect(acc.balance).toBeCloseTo(400, 9);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId(s.provider.id, "t1") } })).accountId).toBe(acc.id);
  });

  test("transactions of an account the user switched off are not booked", async () => {
    const s = await setup("disabled");
    s.bank.accounts = [s.account("chk", 100), s.account("sav", 900)];
    const item = await s.link();
    await prisma.plaidAccount.update({ where: { plaidAccountId: s.ext("sav") }, data: { isEnabled: false } });
    s.bank.pages = [s.page({ added: [s.tx("t1", 5, "Expense", "chk"), s.tx("t2", 5, "Expense", "sav")] })];
    expect(await syncConnectionTransactions(item.id, s.provider)).toBe(1);
    expect((await s.localAccount("sav")).balance).toBeCloseTo(900, 9);
  });

  test("an account id held by another user is never mirrored into", async () => {
    const owner = await setup("owner");
    const other = await setup("other");
    const id = `acc_taken_${owner.userId}`;
    await prisma.bankAccount.create({ data: { id, userId: owner.userId, name: "Mine", type: "cash", openingBalance: 7 } });
    expect(await mirrorBankAccount(other.userId, id, { name: "Theirs", type: "checking", currency: "USD", balance: 1 })).toBe(false);
    const acc = await prisma.bankAccount.findUniqueOrThrow({ where: { id } });
    expect([acc.userId, acc.name, acc.openingBalance]).toEqual([owner.userId, "Mine", 7]);
  });
});
