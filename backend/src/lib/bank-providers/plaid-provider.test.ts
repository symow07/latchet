import { test, expect } from "bun:test";
import {
  toProviderTransaction,
  toProviderAccount,
  toWebhookEvent,
  toLinkSessionResult,
  plaidError,
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
    "movement",
    "note",
    "type",
  ]);
  expect(t.category).toBe("Food");
  expect(t.currency).toBe("EUR");
});

test("a card payment is marked as money that only moves, in the app's words", () => {
  const pay = toProviderTransaction({
    transaction_id: "tx3",
    account_id: "acc1",
    amount: 300,
    date: "2026-08-18",
    personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
  });
  expect(pay.movement).toBe("card_payment");
  const coffee = toProviderTransaction({
    transaction_id: "tx4",
    account_id: "acc1",
    amount: 4,
    date: "2026-08-18",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
  });
  expect(coffee.movement).toBeNull();
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

test("the cleaned merchant name is preferred to Plaid's deprecated name", () => {
  const t = toProviderTransaction({
    transaction_id: "t",
    account_id: "a",
    amount: 15.99,
    date: "2026-10-01",
    name: "NETFLIX.COM 866-579-7172 CA",
    merchant_name: "Netflix",
  });
  expect(t.note).toBe("Netflix");
});

test("plaid category: a transaction is categorised from personal_finance_category", () => {
  const t = toProviderTransaction({
    transaction_id: "t",
    account_id: "a",
    amount: 9.99,
    date: "2026-10-01",
    merchant_name: "Spotify",
    category: ["Shops", "Digital Purchase"],
    personal_finance_category: { primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO", confidence_level: "VERY_HIGH" },
  });
  expect(t.category).toBe("Subscriptions");
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

test("ITEM_ADD_RESULT carries its one public token as a finished link", () => {
  expect(
    toWebhookEvent({
      webhook_type: "LINK",
      webhook_code: "ITEM_ADD_RESULT",
      link_token: "link-abc",
      public_token: "pub-1",
    })
  ).toEqual({ kind: "link-finished", linkToken: "link-abc", publicTokens: ["pub-1"] });
});

test("SESSION_FINISHED's status is read whatever its case, and its tokens de-duplicated", () => {
  expect(
    toWebhookEvent({
      webhook_type: "LINK",
      webhook_code: "SESSION_FINISHED",
      status: "success",
      link_token: "link-abc",
      public_token: "pub-1",
      public_tokens: ["pub-1"],
    })
  ).toEqual({ kind: "link-finished", linkToken: "link-abc", publicTokens: ["pub-1"] });
  // No token, no link: nothing to exchange.
  expect(
    toWebhookEvent({ webhook_type: "LINK", webhook_code: "SESSION_FINISHED", status: "SUCCESS", link_token: "l", public_tokens: [] }).kind
  ).toBe("ignored");
});

test("a Hosted Link session's result is read from /link/token/get", () => {
  expect(
    toLinkSessionResult({
      link_sessions: [
        { finished_at: "x", results: { item_add_results: [{ public_token: "pub-1" }, { public_token: "pub-2" }] } },
        { on_success: { public_token: "pub-1" } },
      ],
    })
  ).toEqual({ status: "success", publicTokens: ["pub-1", "pub-2"], exit: null });

  expect(
    toLinkSessionResult({
      link_sessions: [{ finished_at: "x", exit: { status: "institution_not_found", error: { error_code: "INSTITUTION_NOT_RESPONDING" } } }],
    })
  ).toEqual({ status: "exited", publicTokens: [], exit: { code: "INSTITUTION_NOT_RESPONDING", status: "institution_not_found" } });

  expect(toLinkSessionResult({ link_sessions: [{ finished_at: "x", results: { item_add_results: [] } }] }).status).toBe("exited");
  expect(toLinkSessionResult({ link_sessions: [] })).toEqual({ status: "pending", publicTokens: [], exit: null });
  expect(toLinkSessionResult(null).status).toBe("pending");
});

test("Plaid errors are classified for the caller, and never carry the request", () => {
  expect(plaidError("/item/remove", 400, { error_type: "ITEM_ERROR", error_code: "ITEM_NOT_FOUND" }).kind).toBe("gone");
  expect(plaidError("/item/remove", 400, { error_type: "INVALID_INPUT", error_code: "INVALID_ACCESS_TOKEN" }).kind).toBe("gone");
  expect(plaidError("/link/token/create", 400, { error_type: "INVALID_INPUT", error_code: "INVALID_API_KEYS" }).kind).toBe("config");
  expect(plaidError("/link/token/create", 400, { error_type: "INVALID_REQUEST", error_code: "INVALID_FIELD" }).kind).toBe("config");
  expect(plaidError("/transactions/sync", 400, { error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" }).kind).toBe("unavailable");
  expect(plaidError("/transactions/sync", 429, { error_type: "RATE_LIMIT_EXCEEDED", error_code: "TRANSACTIONS_LIMIT" }).kind).toBe("unavailable");
  expect(plaidError("/accounts/get", 502, null).kind).toBe("unavailable");
  const e = plaidError("/accounts/get", 400, { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", display_message: "Sign in again" });
  expect([e.kind, e.providerCode, e.displayMessage]).toEqual(["rejected", "ITEM_LOGIN_REQUIRED", "Sign in again"]);
  expect(e.message).not.toContain("secret");
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
      "getLinkSessionResult",
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
