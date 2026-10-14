import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { createPlaidProvider } from "../lib/bank-providers/plaid";
import { decryptWith, deriveLegacyKey, deriveTokenKey, encryptWith, type CryptoKeys } from "../lib/crypto";
import { processCipher, type TokenCipher } from "../lib/bank-sync";
import { sha256Hex, type PlaidJwk } from "../lib/plaid-webhook";
import { completionRedirectFor, createPlaidRouter, isAllowedReturnUrl, type PlaidRouteDeps } from "./plaid";

/**
 * The bank-linking routes against a fake Plaid and the real database.
 *
 * The fake answers each Plaid endpoint the way Plaid's API reference says it
 * does, records every call, and never touches the network.
 */

const RUN = crypto.randomUUID().slice(0, 8);
const users: string[] = [];
const publicTokens: string[] = [];

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.syncTombstone.deleteMany({ where: { userId: { in: users } } });
  await prisma.cacheEntry.deleteMany({
    where: {
      OR: [
        { key: { contains: RUN } },
        ...publicTokens.map((t) => ({ key: `plaid:public-token:${createHash("sha256").update(t).digest("hex")}` })),
      ],
    },
  });
});

async function makeUser(label: string, currency = "USD") {
  const id = `plaidroute_${label}_${RUN}_${crypto.randomUUID().slice(0, 6)}`;
  users.push(id);
  const now = new Date();
  await prisma.user.create({ data: { id, name: label, email: `${id}@plaid.test`, createdAt: now, updatedAt: now } });
  await prisma.userSettings.create({ data: { id: `settings_${id}`, userId: id, currency } });
  return id;
}

interface Call { path: string; body: Record<string, any> }

/** A fake Plaid: scripted sessions and banks, every call recorded. */
function fakePlaid() {
  const calls: Call[] = [];
  let n = 0;
  const state = {
    /** link_token → what /link/token/get reports. */
    sessions: new Map<string, any[]>(),
    /** Public tokens already exchanged: Plaid refuses a second exchange. */
    exchanged: new Set<string>(),
    /** access_token → accounts. */
    accounts: new Map<string, any[]>(),
    /** The error /item/remove answers with, if any. */
    removeError: null as null | { status: number; body: Record<string, unknown> },
    jwk: null as PlaidJwk | null,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetch = async (url: string, init: { body?: unknown }): Promise<Response> => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ path, body });
    switch (path) {
      case "/link/token/create": {
        n++;
        const linkToken = `link-sandbox-${RUN}-${n}-${crypto.randomUUID().slice(0, 6)}`;
        return json(200, {
          link_token: linkToken,
          expiration: "2026-10-12T16:00:00Z",
          hosted_link_url: `https://hosted.plaid.test/link/${linkToken}`,
          request_id: "req",
        });
      }
      case "/link/token/get":
        return json(200, { link_token: body.link_token, link_sessions: state.sessions.get(body.link_token) ?? [] });
      case "/item/public_token/exchange": {
        if (state.exchanged.has(body.public_token)) {
          return json(400, { error_type: "INVALID_INPUT", error_code: "INVALID_PUBLIC_TOKEN", error_message: "already used", display_message: null });
        }
        state.exchanged.add(body.public_token);
        const tag = crypto.randomUUID().slice(0, 8);
        const accessToken = `access-sandbox-${tag}`;
        state.accounts.set(accessToken, [
          { account_id: `acc-${tag}-chk`, name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", balances: { current: 110, iso_currency_code: "USD" } },
          { account_id: `acc-${tag}-sav`, name: "Plaid Saving", mask: "1111", type: "depository", subtype: "savings", balances: { current: 210, iso_currency_code: "USD" } },
        ]);
        return json(200, { access_token: accessToken, item_id: `item-${tag}`, request_id: "req" });
      }
      case "/item/get":
        return json(200, { item: { institution_id: "ins_109508" } });
      case "/institutions/get_by_id":
        return json(200, { institution: { name: "First Platypus Bank" } });
      case "/accounts/get":
        return json(200, { accounts: state.accounts.get(body.access_token) ?? [] });
      case "/transactions/sync": {
        const accounts = state.accounts.get(body.access_token) ?? [];
        const chk = accounts[0]?.account_id;
        if (body.cursor || !chk) return json(200, { added: [], modified: [], removed: [], next_cursor: "c2", has_more: false });
        return json(200, {
          added: [
            { transaction_id: `${chk}-t1`, account_id: chk, amount: 15.99, date: "2026-10-01", iso_currency_code: "USD", merchant_name: "Netflix", personal_finance_category: { primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES" } },
            { transaction_id: `${chk}-t2`, account_id: chk, amount: 4.5, date: "2026-10-02", iso_currency_code: "USD", merchant_name: "Starbucks", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" } },
          ],
          modified: [],
          removed: [],
          next_cursor: "c1",
          has_more: false,
        });
      }
      case "/item/remove":
        if (state.removeError) return json(state.removeError.status, state.removeError.body);
        return json(200, { request_id: "req" });
      case "/webhook_verification_key/get":
        return state.jwk ? json(200, { key: state.jwk }) : json(400, { error_code: "INVALID_INPUT" });
      default:
        return json(404, { error_type: "INVALID_REQUEST", error_code: "NOT_FOUND", error_message: path });
    }
  };

  /** Script a finished Hosted Link session that linked one bank. */
  const linkOneBank = (linkToken: string) => {
    const publicToken = `public-sandbox-${RUN}-${crypto.randomUUID()}`;
    publicTokens.push(publicToken);
    state.sessions.set(linkToken, [{
      link_session_id: crypto.randomUUID(),
      started_at: "2026-10-12T15:00:00Z",
      finished_at: "2026-10-12T15:02:00Z",
      results: { item_add_results: [{ public_token: publicToken, institution: { name: "First Platypus Bank", institution_id: "ins_109508" }, accounts: [] }] },
      exit: null,
    }]);
    return publicToken;
  };

  const count = (path: string) => calls.filter((c) => c.path === path).length;
  return { fetch, calls, state, linkOneBank, count };
}

/** A cipher holding a TOKEN_ENCRYPTION_KEY, as production does. */
function v2Cipher(): { cipher: TokenCipher; keys: CryptoKeys } {
  const keys: CryptoKeys = {
    legacy: deriveLegacyKey(process.env.BETTER_AUTH_SECRET!),
    current: deriveTokenKey(`token-encryption-key-for-tests-${"x".repeat(16)}`),
  };
  return { keys, cipher: { encrypt: (s) => encryptWith(s, keys), decrypt: (s) => decryptWith(s, keys) } };
}

type SessionVars = { Variables: { user: { id: string; email: string } | null; session: unknown } };

/** A router wired to a fake Plaid, and a way to call it as any user. */
function setup(over: Partial<PlaidRouteDeps> & { configured?: boolean } = {}) {
  const plaid = fakePlaid();
  const background: Promise<unknown>[] = [];
  const provider = createPlaidProvider({
    clientId: over.configured === false ? undefined : "client",
    secret: over.configured === false ? undefined : "secret",
    environment: "sandbox",
    countryCodes: "US,CA,GB,FR,DE,IE,ES",
    baseUrl: "https://plaid.fake",
    fetch: plaid.fetch,
  });
  const router = createPlaidRouter({
    provider,
    isPro: async () => true,
    backendUrl: "https://api.latchet.test",
    production: true,
    runInBackground: (task) => void background.push(task),
    ...over,
  });
  const as = (userId: string | null) => {
    const app = new Hono<SessionVars>();
    app.use("*", async (c, next) => {
      c.set("user", userId ? { id: userId, email: `${userId}@plaid.test` } : null);
      c.set("session", null);
      await next();
    });
    app.route("/", router as never);
    return app;
  };
  const post = (userId: string, path: string, body: unknown) =>
    as(userId).request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const settle = () => Promise.all(background.splice(0));
  return { plaid, router, as, post, settle, provider };
}

const linkTokenBody = (over: Record<string, unknown> = {}) => ({
  region: "FR", currency: "EUR", language: "fr", returnUrl: "latchet://bank/linked", ...over,
});

describe("plaid link", () => {
  test("plaid link: the link-token request carries Hosted Link, a completion redirect back into the app, and the region's country", async () => {
    const s = setup();
    const user = await makeUser("create", "EUR");
    const res = await s.post(user, "/link-token", linkTokenBody());
    expect(res.status).toBe(200);
    const out = (await res.json()) as { linkToken: string; hostedLinkUrl: string; returnUrl: string };
    expect(out.hostedLinkUrl).toStartWith("https://hosted.plaid.test/link/");
    expect(out.returnUrl).toBe("latchet://bank/linked");

    const sent = s.plaid.calls.find((c) => c.path === "/link/token/create")!.body;
    expect(sent.country_codes).toEqual(["FR"]);
    expect(sent.language).toBe("fr");
    expect(sent.products).toEqual(["transactions"]);
    expect(sent.user).toEqual({ client_user_id: user });
    expect(sent.webhook).toBe("https://api.latchet.test/api/plaid/webhook");
    expect(sent.hosted_link.url_lifetime_seconds).toBe(1800);
    const completion = sent.hosted_link.completion_redirect_uri as string;
    expect(completion).toMatch(/^https:\/\/api\.latchet\.test\/api\/plaid\/link\/return\/[A-Za-z0-9_-]{16,64}$/);

    // The browser following the completion redirect is sent back into the app.
    const back = await s.as(null).request(new URL(completion).pathname.replace(/^\/api\/plaid/, ""));
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("latchet://bank/linked?result=done");
    await s.settle();

    // Without a region, the app's currency decides; the settings' when the
    // phone sends none.
    await s.post(user, "/link-token", { returnUrl: "latchet://bank/linked" });
    const second = s.plaid.calls.filter((c) => c.path === "/link/token/create")[1]!.body;
    expect(second.country_codes).toEqual(["FR", "DE", "IE", "ES"]);
    expect(second.language).toBe("en");
  });

  test("plaid link: the exchange stores the token encrypted (v2 with TOKEN_ENCRYPTION_KEY) and bound to the session's user", async () => {
    const { cipher, keys } = v2Cipher();
    const s = setup({ cipher });
    const user = await makeUser("exchange");
    const { linkToken } = (await (await s.post(user, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    s.plaid.linkOneBank(linkToken);

    const res = await s.post(user, "/link/complete", { linkToken });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", linked: 1, inProgress: 0, exit: null });
    // The first transaction sync runs after the answer, not before it.
    await s.settle();

    const items = await prisma.plaidItem.findMany({ where: { userId: user } });
    expect(items).toHaveLength(1);
    const stored = items[0]!.accessTokenEnc;
    const accessToken = [...s.plaid.state.accounts.keys()][0]!;
    expect(stored).toStartWith("v2.");
    expect(stored).not.toContain(accessToken);
    expect(decryptWith(stored, keys)).toBe(accessToken);
    expect(items[0]!.institutionName).toBe("First Platypus Bank");

    // The process's own cipher writes v2 exactly when the key is configured.
    expect(processCipher.encrypt("x").startsWith("v2.")).toBe(!!process.env.TOKEN_ENCRYPTION_KEY);

    // Accounts are mirrored and the first transactions booked, categorised
    // from personal_finance_category.
    const txs = await prisma.transaction.findMany({ where: { userId: user }, orderBy: { dateISO: "asc" } });
    expect(txs.map((t) => [t.note, t.category])).toEqual([["Netflix", "Subscriptions"], ["Starbucks", "Food"]]);
    expect(await prisma.bankAccount.count({ where: { userId: user } })).toBe(2);

    // The account list never carries the encrypted token.
    const listed = JSON.stringify(await (await s.as(user).request("/accounts")).json());
    expect(listed).not.toContain(stored);
    expect(listed).not.toContain("accessTokenEnc");
  });

  test("plaid link: a link token from another user's session is refused", async () => {
    const s = setup();
    const alice = await makeUser("alice");
    const mallory = await makeUser("mallory");
    const { linkToken } = (await (await s.post(alice, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    const publicToken = s.plaid.linkOneBank(linkToken);

    expect((await s.post(mallory, "/link/complete", { linkToken })).status).toBe(404);
    expect((await s.post(mallory, "/exchange", { linkToken, publicToken })).status).toBe(404);

    // Nor can Alice's public token be passed off under Mallory's own session.
    const own = (await (await s.post(mallory, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    expect((await s.post(mallory, "/exchange", { linkToken: own.linkToken, publicToken })).status).toBe(403);

    expect(s.plaid.count("/item/public_token/exchange")).toBe(0);
    expect(await prisma.plaidItem.count({ where: { userId: { in: [alice, mallory] } } })).toBe(0);

    // Alice's own completion still works afterwards.
    expect((await s.post(alice, "/link/complete", { linkToken })).status).toBe(200);
    await s.settle();
    expect(await prisma.plaidItem.count({ where: { userId: alice } })).toBe(1);
  });

  test("plaid link: completing is idempotent across the browser's return, the app and repeated webhooks", async () => {
    const s = setup();
    const user = await makeUser("idempotent");
    const created = await s.post(user, "/link-token", linkTokenBody());
    const { linkToken } = (await created.json()) as { linkToken: string };
    s.plaid.linkOneBank(linkToken);
    const completion = s.plaid.calls.find((c) => c.path === "/link/token/create")!.body.hosted_link
      .completion_redirect_uri as string;

    // The browser comes back, and the app asks, at the same moment.
    const [ret, first] = await Promise.all([
      s.as(null).request(new URL(completion).pathname.replace(/^\/api\/plaid/, "")),
      s.post(user, "/link/complete", { linkToken }),
    ]);
    expect(ret.status).toBe(302);
    expect(first.status).toBe(200);
    await s.settle();

    // And again, twice.
    for (let i = 0; i < 2; i++) {
      const again = await s.post(user, "/link/complete", { linkToken });
      expect(await again.json()).toEqual({ status: "success", linked: 1, inProgress: 0, exit: null });
    }

    await s.settle();
    expect(s.plaid.count("/item/public_token/exchange")).toBe(1);
    expect(await prisma.plaidItem.count({ where: { userId: user } })).toBe(1);
    expect(await prisma.bankAccount.count({ where: { userId: user } })).toBe(2);
    expect(await prisma.transaction.count({ where: { userId: user } })).toBe(2);
  });

  test("plaid link: a signed webhook links the bank for the session's user even if the app never returns", async () => {
    const s = setup();
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const kid = `kid-${RUN}`;
    s.plaid.state.jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as PlaidJwk), kid, alg: "ES256" };
    const b64 = (v: string | Uint8Array) =>
      Buffer.from(typeof v === "string" ? new TextEncoder().encode(v) : v).toString("base64url");
    const deliver = async (payload: Record<string, unknown>) => {
      const raw = JSON.stringify(payload);
      const input = `${b64(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }))}.${b64(JSON.stringify({ iat: Math.floor(Date.now() / 1000), request_body_sha256: await sha256Hex(raw) }))}`;
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(input)));
      return s.as(null).request("/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Plaid-Verification": `${input}.${b64(sig)}` }, body: raw });
    };

    const user = await makeUser("webhook");
    const { linkToken } = (await (await s.post(user, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    const publicToken = s.plaid.linkOneBank(linkToken);

    // Plaid sends ITEM_ADD_RESULT, then SESSION_FINISHED, and retries one.
    const itemAdded = { webhook_type: "LINK", webhook_code: "ITEM_ADD_RESULT", link_token: linkToken, public_token: publicToken, environment: "sandbox" };
    const finished = { webhook_type: "LINK", webhook_code: "SESSION_FINISHED", status: "SUCCESS", link_token: linkToken, public_tokens: [publicToken], environment: "sandbox" };
    for (const payload of [itemAdded, finished, finished]) expect((await deliver(payload)).status).toBe(200);
    await s.settle();

    expect(s.plaid.count("/item/public_token/exchange")).toBe(1);
    const items = await prisma.plaidItem.findMany({ where: { userId: user } });
    expect(items).toHaveLength(1);

    // A link token nobody here issued exchanges nothing.
    const stray = { ...finished, link_token: `link-sandbox-unknown-${RUN}`, public_tokens: [`public-sandbox-stray-${RUN}`] };
    expect((await deliver(stray)).status).toBe(200);
    expect(s.plaid.count("/item/public_token/exchange")).toBe(1);
  });

  test("plaid link: a user who leaves Plaid without linking is told why", async () => {
    const s = setup();
    const user = await makeUser("exited");
    const { linkToken } = (await (await s.post(user, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    s.plaid.state.sessions.set(linkToken, [{
      link_session_id: "s", finished_at: "2026-10-12T15:02:00Z", results: { item_add_results: [] },
      exit: { status: "requires_credentials", error: { error_code: "INSTITUTION_DOWN", error_type: "INSTITUTION_ERROR" } },
    }]);
    expect(await (await s.post(user, "/link/complete", { linkToken })).json()).toEqual({
      status: "exited", linked: 0, inProgress: 0, exit: { code: "INSTITUTION_DOWN", status: "requires_credentials" },
    });

    // Still in the browser: nothing to report yet.
    const pending = (await (await s.post(user, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    expect(await (await s.post(user, "/link/complete", { linkToken: pending.linkToken })).json()).toMatchObject({ status: "pending" });
  });

  test("plaid link: a development server without https sends Plaid straight back to the app", async () => {
    expect(completionRedirectFor("https://api.latchet.test", "S".repeat(32), "latchet://bank/linked"))
      .toBe(`https://api.latchet.test/api/plaid/link/return/${"S".repeat(32)}`);
    expect(completionRedirectFor("http://localhost:3000", "S".repeat(32), "latchet://bank/linked"))
      .toBe("latchet://bank/linked");

    const s = setup({ backendUrl: "http://localhost:3000", production: false });
    const user = await makeUser("localdev");
    const res = await s.post(user, "/link-token", linkTokenBody({ returnUrl: "exp://192.168.1.4:8081/--/bank/linked" }));
    expect(res.status).toBe(200);
    const sent = s.plaid.calls.find((c) => c.path === "/link/token/create")!.body;
    expect(sent.hosted_link.completion_redirect_uri).toBe("exp://192.168.1.4:8081/--/bank/linked");
  });

  test("plaid link: only the app's own scheme may be the return address in production", async () => {
    expect(isAllowedReturnUrl("latchet://bank/linked", true)).toBe(true);
    expect(isAllowedReturnUrl("exp://192.168.1.4:8081/--/bank/linked", true)).toBe(false);
    expect(isAllowedReturnUrl("exp://192.168.1.4:8081/--/bank/linked", false)).toBe(true);
    expect(isAllowedReturnUrl("https://evil.example/steal", false)).toBe(false);

    const s = setup();
    const user = await makeUser("returnurl");
    const res = await s.post(user, "/link-token", linkTokenBody({ returnUrl: "https://evil.example/steal" }));
    expect(res.status).toBe(400);
    expect(s.plaid.count("/link/token/create")).toBe(0);

    // An unknown state goes back to the app as expired, not to an error page.
    const stale = await s.as(null).request("/link/return/AAAAAAAAAAAAAAAAAAAAAAAA");
    expect(stale.headers.get("location")).toBe("latchet://bank/linked?result=expired");
  });

  test("plaid link: a Plaid refusal reaches the phone as a code it can explain", async () => {
    const s = setup();
    const user = await makeUser("refused");
    const original = s.plaid.fetch;
    const router = createPlaidRouter({
      provider: createPlaidProvider({
        clientId: "client", secret: "wrong", environment: "sandbox", countryCodes: "US", baseUrl: "https://plaid.fake",
        fetch: async (url, init) =>
          new URL(url).pathname === "/link/token/create"
            ? new Response(JSON.stringify({ error_type: "INVALID_INPUT", error_code: "INVALID_API_KEYS", error_message: "invalid client_id or secret provided", display_message: null }), { status: 400 })
            : original(url, init as never),
      }),
      isPro: async () => true, backendUrl: "https://api.latchet.test", production: true,
    });
    const app = new Hono<SessionVars>();
    app.use("*", async (c, next) => { c.set("user", { id: user, email: "x" }); await next(); });
    app.route("/", router as never);
    const res = await app.request("/link-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "provider_config", providerCode: "INVALID_API_KEYS" });
  });
});

describe("plaid disconnect", () => {
  async function linked(s: ReturnType<typeof setup>, label: string) {
    const user = await makeUser(label);
    const { linkToken } = (await (await s.post(user, "/link-token", linkTokenBody())).json()) as { linkToken: string };
    s.plaid.linkOneBank(linkToken);
    await s.post(user, "/link/complete", { linkToken });
    await s.settle();
    const item = await prisma.plaidItem.findFirstOrThrow({ where: { userId: user } });
    const accessToken = [...s.plaid.state.accounts.keys()].at(-1)!;
    return { user, item, accessToken };
  }

  test("plaid disconnect: keep removes the item at Plaid and leaves the accounts and transactions as ordinary data", async () => {
    const s = setup();
    const { user, item, accessToken } = await linked(s, "keep");
    const before = await prisma.transaction.count({ where: { userId: user } });
    expect(before).toBe(2);

    const res = await s.as(user).request(`/items/${item.id}?data=keep`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, kept: true });

    expect(s.plaid.calls.filter((c) => c.path === "/item/remove").map((c) => c.body.access_token)).toEqual([accessToken]);
    expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(0);
    expect(await prisma.plaidAccount.count({ where: { itemId: item.id } })).toBe(0);
    expect(await prisma.bankAccount.count({ where: { userId: user } })).toBe(2);
    expect(await prisma.transaction.count({ where: { userId: user } })).toBe(before);
    expect(await prisma.syncTombstone.count({ where: { userId: user } })).toBe(0);
  });

  test("plaid disconnect: delete removes the item at Plaid, the mirrored accounts and their transactions, with tombstones", async () => {
    const s = setup();
    const { user, item } = await linked(s, "delete");
    const accountIds = (await prisma.bankAccount.findMany({ where: { userId: user }, select: { id: true } })).map((a) => a.id);
    const txIds = (await prisma.transaction.findMany({ where: { userId: user }, select: { id: true } })).map((t) => t.id);
    // A hand-made account elsewhere is not the bank's, and stays.
    await prisma.bankAccount.create({ data: { id: `cash_${user}`, userId: user, name: "Cash", type: "cash" } });

    const res = await s.as(user).request(`/items/${item.id}?data=delete`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, kept: false, removed: { accounts: 2, transactions: 2 } });

    expect(s.plaid.count("/item/remove")).toBe(1);
    expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(0);
    expect((await prisma.bankAccount.findMany({ where: { userId: user } })).map((a) => a.id)).toEqual([`cash_${user}`]);
    expect(await prisma.transaction.count({ where: { userId: user } })).toBe(0);
    const tombs = await prisma.syncTombstone.findMany({ where: { userId: user }, select: { entity: true, syncId: true } });
    expect(tombs.filter((t) => t.entity === "accounts").map((t) => t.syncId).sort()).toEqual([...accountIds].sort());
    expect(tombs.filter((t) => t.entity === "transactions").map((t) => t.syncId).sort()).toEqual([...txIds].sort());
  });

  test("plaid disconnect: when Plaid cannot be reached nothing is deleted, and an already-removed item still disconnects", async () => {
    const s = setup();
    const { user, item } = await linked(s, "unreachable");

    s.plaid.state.removeError = { status: 500, body: { error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR", error_message: "unexpected" } };
    const down = await s.as(user).request(`/items/${item.id}?data=delete`, { method: "DELETE" });
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ code: "provider_unavailable" });
    expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId: user } })).toBe(2);

    // Removed already, at my.plaid.com: what was asked for is true.
    s.plaid.state.removeError = { status: 400, body: { error_type: "ITEM_ERROR", error_code: "ITEM_NOT_FOUND", error_message: "not found" } };
    const gone = await s.as(user).request(`/items/${item.id}`, { method: "DELETE" });
    expect(gone.status).toBe(200);
    expect(await gone.json()).toMatchObject({ kept: true });
    expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(0);
  });

  test("plaid disconnect: another user's bank cannot be disconnected", async () => {
    const s = setup();
    const { item } = await linked(s, "owner");
    const other = await makeUser("intruder");
    expect((await s.as(other).request(`/items/${item.id}?data=delete`, { method: "DELETE" })).status).toBe(404);
    expect(s.plaid.count("/item/remove")).toBe(0);
    expect(await prisma.plaidItem.count({ where: { id: item.id } })).toBe(1);
  });
});

describe("bank linking configuration", () => {
  test("the phone can read what this server links, without secrets, Pro or not", async () => {
    const s = setup({ isPro: async () => false });
    const user = await makeUser("config");
    const res = await s.as(user).request("/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ configured: true, countries: ["US", "CA", "GB", "FR", "DE", "IE", "ES"], env: "sandbox" });
    expect(JSON.stringify(body)).not.toContain("secret");

    // Linking itself stays Pro.
    expect((await s.post(user, "/link-token", linkTokenBody())).status).toBe(402);
  });

  test("an unconfigured server says so plainly", async () => {
    const s = setup({ configured: false });
    const user = await makeUser("unconfigured");
    expect(await (await s.as(user).request("/config")).json()).toEqual({ configured: false, countries: [], env: "sandbox" });
    const res = await s.post(user, "/link-token", linkTokenBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect((await s.as(null).request("/config")).status).toBe(401);
  });
});
