import { test, expect } from "bun:test";
import {
  toProviderTransaction,
  toProviderAccount,
  toWebhookEvent,
  plaidProvider,
} from "./plaid";
import { getProvider, listProviders, DEFAULT_PROVIDER_ID } from "./index";

// ── Normalisation into the app's vocabulary ──────────────────────────────────

test("Plaid's sign convention is inverted into ours", () => {
  // Plaid signs money *out* as positive, which is the opposite of the app's
  // convention. Resolving it here means no call site has to remember.
  const spend = toProviderTransaction({
    transaction_id: "tx1",
    account_id: "acc1",
    amount: 42.5,
    date: "2026-08-18",
  });
  expect(spend).toMatchObject({ amount: 42.5, type: "Expense" });

  const income = toProviderTransaction({
    transaction_id: "tx2",
    account_id: "acc1",
    amount: -1200,
    date: "2026-08-18",
  });
  // Amount is always positive; direction is carried by `type`.
  expect(income).toMatchObject({ amount: 1200, type: "Income" });
});

test("a transaction carries no Plaid-shaped fields across the boundary", () => {
  const t = toProviderTransaction({
    transaction_id: "tx1",
    account_id: "acc1",
    amount: 10,
    date: "2026-08-18",
    iso_currency_code: "EUR",
    name: "CARREFOUR",
    category: ["Food and Drink", "Groceries"],
  });

  expect(Object.keys(t).sort()).toEqual([
    "accountExternalId",
    "amount",
    "category",
    "currency",
    "dateISO",
    "externalId",
    "note",
    "type",
  ]);
  expect(t.category).toBe("Food");
  expect(t.currency).toBe("EUR");
});

test("a missing currency falls back to USD rather than undefined", () => {
  const t = toProviderTransaction({
    transaction_id: "t",
    account_id: "a",
    amount: 1,
    date: "2026-08-18",
  });
  expect(t.currency).toBe("USD");
});

test("merchant_name is used when name is absent", () => {
  const t = toProviderTransaction({
    transaction_id: "t",
    account_id: "a",
    amount: 1,
    date: "2026-08-18",
    merchant_name: "Spotify",
  });
  expect(t.note).toBe("Spotify");
});

test("accounts are normalised to the app's type vocabulary", () => {
  const a = toProviderAccount({
    account_id: "acc1",
    name: "Everyday",
    mask: "4321",
    type: "depository",
    subtype: "checking",
    balances: { current: 812.4, iso_currency_code: "GBP" },
  });

  expect(a).toEqual({
    externalId: "acc1",
    name: "Everyday",
    mask: "4321",
    type: "checking",
    balance: 812.4,
    currency: "GBP",
  });
});

test("an account with no balance reads as zero, not undefined", () => {
  const a = toProviderAccount({ account_id: "x", name: "New", balances: {} });
  expect(a.balance).toBe(0);
  expect(a.currency).toBe("USD");
});

// ── Webhook translation ──────────────────────────────────────────────────────

test("a finished link session becomes a neutral event", () => {
  expect(
    toWebhookEvent({
      webhook_type: "LINK",
      webhook_code: "SESSION_FINISHED",
      status: "SUCCESS",
      link_token: "link-abc",
      public_tokens: ["pub-1", "pub-2"],
    })
  ).toEqual({ kind: "link-finished", linkToken: "link-abc", publicTokens: ["pub-1", "pub-2"] });
});

test("an unsuccessful link session is ignored", () => {
  expect(
    toWebhookEvent({
      webhook_type: "LINK",
      webhook_code: "SESSION_FINISHED",
      status: "EXITED",
      link_token: "link-abc",
    })
  ).toEqual({ kind: "ignored" });
});

test("both transaction-change codes map to the same event", () => {
  for (const code of ["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE"]) {
    expect(toWebhookEvent({ webhook_code: code, item_id: "item-1" })).toEqual({
      kind: "transactions-changed",
      connectionExternalId: "item-1",
    });
  }
});

test("unknown webhooks are ignored rather than throwing", () => {
  expect(toWebhookEvent({ webhook_code: "SOMETHING_NEW", item_id: "i" }).kind).toBe("ignored");
  expect(toWebhookEvent({}).kind).toBe("ignored");
  expect(toWebhookEvent(null).kind).toBe("ignored");
});

test("a transaction-change webhook with no item id is ignored", () => {
  expect(toWebhookEvent({ webhook_code: "SYNC_UPDATES_AVAILABLE" }).kind).toBe("ignored");
});

// ── Registry ─────────────────────────────────────────────────────────────────

test("the default provider is Plaid", () => {
  expect(DEFAULT_PROVIDER_ID).toBe("plaid");
  expect(getProvider()).toBe(plaidProvider);
  expect(getProvider("plaid")).toBe(plaidProvider);
});

test("an unknown provider fails loudly", () => {
  expect(() => getProvider("saltedge")).toThrow(/Unknown bank provider/);
});

test("every registered provider satisfies the interface", () => {
  for (const p of listProviders()) {
    expect(typeof p.id).toBe("string");
    for (const method of [
      "isConfigured",
      "createLinkSession",
      "exchange",
      "listAccounts",
      "syncTransactions",
      "removeConnection",
      "verifyWebhook",
      "parseWebhook",
    ]) {
      expect(typeof (p as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  }
});
