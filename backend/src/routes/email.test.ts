import { test, expect, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { createEmailRouter, isPublicEmailPath, type EmailRouteDeps } from "./email";
import { gmailProvider } from "../lib/email-providers/gmail";
import { outlookProvider } from "../lib/email-providers/outlook";
import { processCipher } from "../lib/email-providers";
import { codeChallengeFor, rememberConnect, userKeyFor } from "../lib/email-providers/oauth";
import { FINDINGS_OVERLAP_MS } from "../lib/email-providers/findings";
import type { EmailConfig } from "../lib/email-providers/config";
import {
  cleanupUsers,
  netflixRenewal,
  newsletter,
  spotifyReceipt,
  startFake,
  testUser,
  TEST_CONFIG,
  type FakeMailbox,
  type FakeProviders,
} from "../lib/email-providers/test-fakes";

/**
 * The email API (I-EMAIL-API) through its real router against Postgres and
 * the fake Google and Microsoft, with the session middleware's job — setting
 * `user` — done by the test.
 */

const P = `eroute${process.pid}${Date.now().toString(36)}`;
const grantKeys: string[] = [];
afterAll(async () => {
  await cleanupUsers(P);
  await prisma.emailOAuthGrant.deleteMany({ where: { userKey: { in: grantKeys } } });
  await prisma.cacheEntry.deleteMany({ where: { value: { path: ["userId"], string_starts_with: `${P}_` } } });
});

type User = { id: string; email: string };
type TestEnv = { Variables: { user: User | null; session: unknown } };
const RETURN = "realbudget://email/connected";

function harness(mailboxes: Record<string, FakeMailbox>, over: { config?: Partial<EmailConfig>; noOutlook?: boolean; noGmail?: boolean } = {}) {
  const fake = startFake(mailboxes);
  const config: EmailConfig = { ...TEST_CONFIG, ...over.config };
  const providers = {
    gmail: over.noGmail ? null : gmailProvider(config.google!, fake.http),
    outlook: over.noOutlook ? null : outlookProvider(config.microsoft!, fake.http),
  };
  const tasks: Promise<unknown>[] = [];
  const deps: EmailRouteDeps = {
    config,
    providers,
    http: fake.http,
    cipher: processCipher,
    sync: { providers, cipher: processCipher, aiFor: () => null },
    aiFor: () => null,
    runInBackground: (t) => void tasks.push(t),
    syncWaitMs: 0,
  };
  let actingAs: User | null = null;
  const app = new Hono<TestEnv>();
  app.use("*", async (c, next) => {
    c.set("user", actingAs);
    await next();
  });
  app.route("/api/v1/email", createEmailRouter(deps) as unknown as Hono<TestEnv>);

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.fetch(
      new Request(`http://backend.test/api/v1/email${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      })
    );
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, location: res.headers.get("location") ?? "" };
  };
  return {
    fake: fake as FakeProviders,
    config,
    deps,
    tasks,
    as(user: User | null) {
      actingAs = user;
      return this;
    },
    call,
    settle: async () => {
      while (tasks.length) await tasks.shift();
    },
    /** POST /connect and follow the consent to the callback with `code`. */
    async connect(user: User, provider: "gmail" | "outlook", code: string) {
      actingAs = user;
      const r = await call("POST", `/connect/${provider}`, { returnUrl: RETURN });
      expect(r.status).toBe(200);
      const auth = new URL(r.json.authUrl);
      actingAs = null; // the browser's redirect carries no session
      const cb = await call("GET", `/oauth/${provider}/callback?code=${code}&state=${encodeURIComponent(auth.searchParams.get("state")!)}`);
      actingAs = user;
      return { auth, cb, state: auth.searchParams.get("state")! };
    },
  };
}

const box = (label: string, gmail = [netflixRenewal(`${label}-1`, 2), newsletter(`${label}-2`, 3)], outlook = [spotifyReceipt(`${label}-o1`, 1)]): FakeMailbox => ({
  gmailAddress: `${label}@gmail.com`,
  outlookAddress: `${label}@outlook.com`,
  gmail,
  outlook,
});
const user = async (label: string) => {
  const u = await testUser(P, label);
  grantKeys.push(userKeyFor(u.id));
  return u;
};
const stateRow = (state: string) =>
  prisma.cacheEntry.findUnique({ where: { key: `email-oauth:${createHash("sha256").update(state).digest("hex")}` } });

// ── OAuth ────────────────────────────────────────────────────────────────────

test("email oauth: connect keeps the state and PKCE verifier in Postgres, not in memory", async () => {
  const h = harness({ codeA: box("oa") });
  const u = await user("oa");
  const r = await h.as(u).call("POST", "/connect/gmail", { returnUrl: RETURN });
  expect(r.status).toBe(200);
  const auth = new URL(r.json.authUrl);
  expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
  expect(auth.searchParams.get("redirect_uri")).toBe("http://backend.test/api/v1/email/oauth/gmail/callback");
  const state = auth.searchParams.get("state")!;
  expect(state.length).toBeGreaterThanOrEqual(43);

  const row = await stateRow(state);
  expect(row).not.toBeNull();
  const value = row!.value as { userId: string; provider: string; codeVerifier: string; returnUrl: string };
  expect(value).toMatchObject({ userId: u.id, provider: "gmail", returnUrl: RETURN });
  expect(codeChallengeFor(value.codeVerifier)).toBe(auth.searchParams.get("code_challenge")!);
  // About ten minutes to live (database clock, UTC).
  const ttl = row!.expiresAt.getTime() - Date.now();
  expect(ttl).toBeGreaterThan(9 * 60_000);
  expect(ttl).toBeLessThan(11 * 60_000);
});

test("email oauth: the callback is single use — the state is consumed and a replay fails", async () => {
  const h = harness({ codeB: box("ob") });
  const u = await user("ob");
  const { cb, state } = await h.connect(u, "gmail", "codeB");
  expect(cb.status).toBe(302);
  expect(cb.location).toBe(`${RETURN}?provider=gmail&result=success`);
  expect(await stateRow(state)).toBeNull();

  const replay = await h.as(null).call("GET", `/oauth/gmail/callback?code=codeB&state=${encodeURIComponent(state)}`);
  expect(replay.status).toBe(302);
  expect(replay.location).toBe(`${RETURN}?provider=gmail&result=error&reason=invalid_state`);
  // The code went to the token endpoint once: the replay never reached Google.
  expect(h.fake.log.tokenForms.filter((f) => f.grant_type === "authorization_code").length).toBe(1);
  await h.settle();
});

test("email oauth: an expired state is refused, as is one for another provider", async () => {
  const h = harness({ codeC: box("oc") });
  const u = await user("oc");
  await rememberConnect("expired-state-xyz", { userId: u.id, provider: "gmail", codeVerifier: "v".repeat(43), returnUrl: RETURN });
  await prisma.$executeRaw`UPDATE "CacheEntry" SET "expiresAt" = "expiresAt" - interval '11 minutes'
    WHERE "key" = ${`email-oauth:${createHash("sha256").update("expired-state-xyz").digest("hex")}`}`;
  const r = await h.as(null).call("GET", "/oauth/gmail/callback?code=codeC&state=expired-state-xyz");
  expect(r.location).toContain("result=error&reason=invalid_state");

  await rememberConnect("outlook-state-xyz", { userId: u.id, provider: "outlook", codeVerifier: "v".repeat(43), returnUrl: RETURN });
  const wrong = await h.call("GET", "/oauth/gmail/callback?code=codeC&state=outlook-state-xyz");
  expect(wrong.location).toContain("reason=invalid_state");
  expect(h.fake.log.tokenForms.length).toBe(0);
});

test("email oauth: a foreign return URL is refused; Expo's only outside production", async () => {
  const h = harness({});
  const u = await user("od");
  for (const returnUrl of ["https://evil.example/steal", "javascript:alert(1)", "realbudgetx://x", "//evil.example"]) {
    const r = await h.as(u).call("POST", "/connect/gmail", { returnUrl });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("invalid_return_url");
  }
  expect((await h.call("POST", "/connect/gmail", { returnUrl: "exp://192.168.1.4:8081/--/email/connected" })).status).toBe(200);
  const prod = harness({}, { config: { production: true } });
  expect((await prod.as(u).call("POST", "/connect/gmail", { returnUrl: "exp://192.168.1.4:8081/--/email/connected" })).status).toBe(400);
  expect((await prod.call("POST", "/connect/gmail", { returnUrl: RETURN })).status).toBe(200);
  expect((await h.call("POST", "/connect/gmail", {})).status).toBe(400);
  expect((await h.call("POST", "/connect/yahoo", { returnUrl: RETURN })).status).toBe(404);
});

test("email oauth: a provider that is not configured answers 503 not_configured", async () => {
  const h = harness({}, { noOutlook: true, noGmail: true, config: { inbound: null } });
  const u = await user("oe");
  const r = await h.as(u).call("POST", "/connect/outlook", { returnUrl: RETURN });
  expect(r).toMatchObject({ status: 503, json: { error: "not_configured" } });
  expect((await h.call("POST", "/connect/gmail", { returnUrl: RETURN })).status).toBe(503);
  const conns = await h.call("GET", "/connections");
  expect(conns.json.providers).toEqual({
    gmail: { configured: false, verified: false, capReached: false },
    outlook: { configured: false },
    forwarding: { configured: false },
  });
  expect((await h.call("GET", "/inbox-address")).status).toBe(503);
});

test("email oauth: the Gmail cap counts the lifetime ledger, lets counted users back in, and lifts with verification", async () => {
  const before = await prisma.emailOAuthGrant.count({ where: { provider: "gmail" } });
  const h = harness({ codeF: box("of") }, { config: { gmailUserCap: before + 1 } });
  const first = await user("of1");
  const second = await user("of2");
  expect((await h.as(first).call("GET", "/connections")).json.providers.gmail.capReached).toBe(false);
  const { cb } = await h.connect(first, "gmail", "codeF");
  expect(cb.location).toContain("result=success");
  await h.settle();
  expect(await prisma.emailOAuthGrant.count({ where: { provider: "gmail", userKey: userKeyFor(first.id) } })).toBe(1);

  // The cap is reached for a new user…
  expect((await h.as(second).call("GET", "/connections")).json.providers.gmail).toEqual({ configured: true, verified: false, capReached: true });
  expect(await h.call("POST", "/connect/gmail", { returnUrl: RETURN })).toMatchObject({ status: 409, json: { error: "cap_reached" } });
  // …but Outlook is not capped,
  expect((await h.call("POST", "/connect/outlook", { returnUrl: RETURN })).status).toBe(200);
  // and someone already counted can always reconnect, even after disconnecting.
  const conn = (await h.as(first).call("GET", "/connections")).json.connections[0];
  expect((await h.call("DELETE", `/connections/${conn.id}`)).status).toBe(200);
  expect((await h.call("POST", "/connect/gmail", { returnUrl: RETURN })).status).toBe(200);
  // The ledger outlives the account: deleting the user does not free a place.
  await prisma.user.delete({ where: { id: first.id } });
  expect((await h.as(second).call("GET", "/connections")).json.providers.gmail.capReached).toBe(true);

  const verified = harness({}, { config: { gmailUserCap: before + 1, gmailVerified: true } });
  expect((await verified.as(second).call("GET", "/connections")).json.providers.gmail).toEqual({ configured: true, verified: true, capReached: false });
  expect((await verified.call("POST", "/connect/gmail", { returnUrl: RETURN })).status).toBe(200);
});

test("email oauth: denial and provider errors return to the app without the provider's words", async () => {
  const h = harness({ codeG: box("og") });
  const u = await user("og");
  const start = async () => new URL((await h.as(u).call("POST", "/connect/outlook", { returnUrl: `${RETURN}?from=settings` })).json.authUrl).searchParams.get("state")!;

  const denied = await h.as(null).call("GET", `/oauth/outlook/callback?error=access_denied&error_description=The+user+said+no&state=${await start()}`);
  expect(denied.location).toBe(`${RETURN}?from=settings&provider=outlook&result=denied`);

  const odd = await h.as(null).call("GET", `/oauth/outlook/callback?error=server_error&error_description=%3Cscript%3Eu%40x.com&state=${await start()}`);
  expect(odd.location).toBe(`${RETURN}?from=settings&provider=outlook&result=error&reason=provider_error`);

  // A code the provider refuses (expired, used): an error code, never its text.
  const bad = await h.as(null).call("GET", `/oauth/outlook/callback?code=not-a-code&state=${await start()}`);
  expect(bad.location).toBe(`${RETURN}?from=settings&provider=outlook&result=error&reason=reauth_required`);
  expect(await prisma.emailConnection.count({ where: { userId: u.id } })).toBe(0);
});

test("email oauth: a user who unticks Gmail access is not connected, and the grant is given back", async () => {
  const h = harness({ codeH: box("oh") });
  h.fake.googleScope = "openid";
  const u = await user("oh");
  const { cb } = await h.connect(u, "gmail", "codeH");
  expect(cb.location).toContain("result=error&reason=scope_denied");
  expect(h.fake.log.googleRevoked.length).toBe(1);
  expect(await prisma.emailConnection.count({ where: { userId: u.id } })).toBe(0);
  expect(await prisma.emailOAuthGrant.count({ where: { userKey: userKeyFor(u.id) } })).toBe(0);
});

test("email oauth: success stores the refresh token encrypted and starts the one-year backfill", async () => {
  const h = harness({ codeI: box("oi") });
  const u = await user("oi");
  const { cb } = await h.connect(u, "gmail", "codeI");
  expect(cb.location).toContain("result=success");
  const row = await prisma.emailConnection.findFirstOrThrow({ where: { userId: u.id, provider: "gmail" } });
  expect(row.email).toBe("oi@gmail.com");
  expect(row.refreshTokenEnc).not.toContain("refresh");
  expect(processCipher.decrypt(row.refreshTokenEnc!)).toStartWith("g-refresh-codeI-");
  expect(row.scope).toBe("https://www.googleapis.com/auth/gmail.readonly");
  await h.settle();
  const after = await prisma.emailConnection.findUniqueOrThrow({ where: { id: row.id } });
  expect(after.backfillDoneAt).not.toBeNull();
  expect(after.syncState).toBe("idle");
  expect(h.fake.log.gmailQueries.every((q) => q.startsWith("newer_than:1y "))).toBe(true);
  // The callback's own access token served the backfill: no refresh was needed.
  expect(h.fake.log.tokenForms.filter((f) => f.grant_type === "refresh_token").length).toBe(0);

  // Reconnecting the same mailbox replaces the token on the same row.
  await h.connect(u, "gmail", "codeI");
  await h.settle();
  expect(await prisma.emailConnection.count({ where: { userId: u.id } })).toBe(1);
});

test("email oauth: the callback and the inbound webhook bypass the session middleware; nothing else does", () => {
  for (const p of ["/api/v1/email/oauth/gmail/callback", "/api/email/oauth/outlook/callback", "/api/v1/email/inbound", "/api/email/inbound"]) {
    expect(isPublicEmailPath(p)).toBe(true);
  }
  for (const p of ["/api/v1/email/connections", "/api/v1/email/oauth/gmail/callback/x", "/api/v1/email/connect/gmail", "/api/v1/emailx/inbound", "/api/v1/email/findings"]) {
    expect(isPublicEmailPath(p)).toBe(false);
  }
});

test("email oauth: every other route needs a session", async () => {
  const h = harness({});
  h.as(null);
  for (const [m, p] of [["GET", "/connections"], ["POST", "/connect/gmail"], ["POST", "/sync"], ["GET", "/findings"], ["DELETE", "/connections/x"], ["POST", "/connections/x/sync"], ["GET", "/inbox-address"]] as const) {
    expect((await h.call(m, p, m === "POST" ? { returnUrl: RETURN } : undefined)).status).toBe(401);
  }
});

// ── Connections and sync ─────────────────────────────────────────────────────

test("inbox sync: GET /connections describes each mailbox; a manual sync is accepted once a minute per connection", async () => {
  const h = harness({ codeJ: box("sj") });
  const u = await user("sj");
  await h.connect(u, "gmail", "codeJ");
  await h.settle();
  const list = await h.as(u).call("GET", "/connections");
  const [c] = list.json.connections;
  expect(Object.keys(c).sort()).toEqual(
    ["id", "provider", "address", "status", "syncState", "lastSyncedAt", "backfillDoneAt", "messagesScanned", "findingsCount", "lastError"].sort()
  );
  expect(c).toMatchObject({ provider: "gmail", address: "sj@gmail.com", status: "active", syncState: "idle", messagesScanned: 2, findingsCount: 1, lastError: null });

  const s1 = await h.call("POST", "/sync");
  expect(s1).toMatchObject({ status: 202, json: { started: 1 } });
  const again = await h.call("POST", `/connections/${c.id}/sync`);
  expect(again.status).toBe(429);
  expect(again.json.retryAfter).toBeGreaterThan(0);
  expect(again.json.retryAfter).toBeLessThanOrEqual(60);
  expect((await h.call("POST", "/sync")).status).toBe(429);
  await h.settle();
  // Another user's connection is not theirs to sync.
  const other = await user("sj2");
  expect((await h.as(other).call("POST", `/connections/${c.id}/sync`)).status).toBe(404);
  expect(await h.call("POST", "/sync")).toMatchObject({ status: 202, json: { started: 0 } });
});

// ── Findings ─────────────────────────────────────────────────────────────────

const DTO_KEYS = [
  "id", "connectionId", "source", "kind", "merchant", "senderDomain", "billedVia", "amount", "currency", "cadence",
  "chargedISO", "emailDateISO", "nextChargeISO", "trialEndsISO", "previousAmount", "confidence", "receivedAt",
].sort();

async function insertFinding(userId: string, receivedAt: Date, over: Record<string, unknown> = {}) {
  return prisma.inboxEmail.create({
    data: {
      userId, source: "gmail", kind: "renewal", merchant: "Netflix", senderDomain: "netflix.com", amount: 15.49,
      currency: "USD", cadence: "monthly", confidence: 0.9, receivedAt,
      messageKey: createHash("sha256").update(`${userId}:${Math.random()}`).digest("hex"),
      ...over,
    },
  });
}

test("findings api: the DTO carries exactly the contract's fields", async () => {
  const h = harness({ codeK: box("fk") });
  const u = await user("fk");
  await h.connect(u, "gmail", "codeK");
  await h.settle();
  const r = await h.as(u).call("GET", "/findings");
  expect(r.status).toBe(200);
  expect(Object.keys(r.json).sort()).toEqual(["findings", "more", "serverTime"]);
  expect(r.json.more).toBe(false);
  const [f] = r.json.findings;
  expect(Object.keys(f).sort()).toEqual(DTO_KEYS);
  expect(f).toMatchObject({ source: "gmail", kind: "renewal", merchant: "Netflix", senderDomain: "netflix.com", amount: 15.49, currency: "USD", cadence: "monthly", billedVia: null });
  expect(typeof f.connectionId).toBe("string");
  expect(Number.isNaN(Date.parse(f.receivedAt))).toBe(false);
});

test("findings api: ?after= returns what was stored since, with a ten-minute overlap", async () => {
  const h = harness({});
  const u = await user("fl");
  const r0 = await h.as(u).call("GET", "/findings");
  const t = Date.parse(r0.json.serverTime);
  const old = await insertFinding(u.id, new Date(t - FINDINGS_OVERLAP_MS - 60_000));
  const recent = await insertFinding(u.id, new Date(t - 5 * 60_000));
  const fresh = await insertFinding(u.id, new Date(t + 1000));
  const r = await h.call("GET", `/findings?after=${encodeURIComponent(r0.json.serverTime)}`);
  expect(r.json.findings.map((f: { id: string }) => f.id)).toEqual([recent.id, fresh.id]);
  expect(r.json.more).toBe(false);
  expect(Date.parse(r.json.serverTime)).toBeGreaterThanOrEqual(t);
  const all = await h.call("GET", "/findings");
  expect(all.json.findings.map((f: { id: string }) => f.id)).toEqual([old.id, recent.id, fresh.id]);
  expect((await h.call("GET", "/findings?after=yesterday-ish")).status).toBe(400);
});

test("findings api: another user's findings are invisible", async () => {
  const h = harness({});
  const mine = await user("fm1");
  const theirs = await user("fm2");
  const a = await insertFinding(mine.id, new Date());
  await insertFinding(theirs.id, new Date());
  const r = await h.as(mine).call("GET", "/findings");
  expect(r.json.findings.map((f: { id: string }) => f.id)).toEqual([a.id]);
});

test("findings api: only billing kinds are served — not a legacy 'other' row nor a confirmation code", async () => {
  const h = harness({});
  const u = await user("fn");
  const billing = await insertFinding(u.id, new Date(), { kind: "cancellation" });
  await insertFinding(u.id, new Date(), { kind: "other" });
  await insertFinding(u.id, new Date(), { kind: "other", status: "confirmation", merchant: "123456789" });
  const r = await h.as(u).call("GET", "/findings");
  expect(r.json.findings.map((f: { id: string }) => f.id)).toEqual([billing.id]);
});

test("findings api: more than a page is paged to the end without loss or repetition", async () => {
  const h = harness({});
  const u = await user("fo");
  const base = Date.now() - 3600_000;
  // 1,005 findings stored within a minute, as a backfill does; 300 share one instant.
  const rows = Array.from({ length: 1005 }, (_, i) => ({
    userId: u.id, source: "gmail", kind: "receipt", merchant: "Starbucks", senderDomain: "starbucks.com", confidence: 0.8,
    messageKey: `${u.id}:${i}`,
    receivedAt: new Date(i >= 900 && i < 1200 ? base + 900 : base + i),
  }));
  await prisma.inboxEmail.createMany({ data: rows });
  const seen: string[] = [];
  let after: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r: any = await h.as(u).call("GET", `/findings${after ? `?after=${encodeURIComponent(after)}` : ""}`);
    expect(r.json.findings.length).toBeLessThanOrEqual(1000);
    seen.push(...r.json.findings.map((f: { id: string }) => f.id));
    after = r.json.serverTime;
    if (!r.json.more) break;
  }
  expect(new Set(seen).size).toBe(1005);
});

// ── Revocation ───────────────────────────────────────────────────────────────

test("revocation: disconnecting Gmail revokes the token at Google and deletes its findings, not the others'", async () => {
  const h = harness({ codeR: box("rv") });
  const u = await user("rv");
  await h.connect(u, "gmail", "codeR");
  await h.connect(u, "outlook", "codeR");
  await h.settle();
  const conns = (await h.as(u).call("GET", "/connections")).json.connections as { id: string; provider: string }[];
  const gmail = conns.find((c) => c.provider === "gmail")!;
  const token = processCipher.decrypt((await prisma.emailConnection.findUniqueOrThrow({ where: { id: gmail.id } })).refreshTokenEnc!);
  expect(await prisma.inboxEmail.count({ where: { connectionId: gmail.id } })).toBe(1);

  const del = await h.call("DELETE", `/connections/${gmail.id}`);
  expect(del).toMatchObject({ status: 200, json: { ok: true, revoked: true } });
  expect(h.fake.log.googleRevoked).toEqual([token]);
  expect(await prisma.emailConnection.count({ where: { id: gmail.id } })).toBe(0);
  expect(await prisma.inboxEmail.count({ where: { connectionId: gmail.id } })).toBe(0);
  const left = (await h.call("GET", "/findings")).json.findings;
  expect(left.length).toBe(1);
  expect(left[0].source).toBe("outlook");
  expect((await h.call("DELETE", `/connections/${gmail.id}`)).status).toBe(404);
});

test("revocation: disconnecting Outlook deletes the token and names the page to remove the consent", async () => {
  const h = harness({ codeS: box("rw") });
  const u = await user("rw");
  await h.connect(u, "outlook", "codeS");
  await h.settle();
  const [c] = (await h.as(u).call("GET", "/connections")).json.connections;
  const del = await h.call("DELETE", `/connections/${c.id}`);
  expect(del.json).toEqual({ ok: true, revoked: false, manualRevokeUrl: "https://account.live.com/consent/Manage" });
  expect(await prisma.emailConnection.count({ where: { userId: u.id } })).toBe(0);
  expect(await prisma.inboxEmail.count({ where: { userId: u.id } })).toBe(0);
  // Another user cannot disconnect it.
  const other = await user("rw2");
  expect((await h.as(other).call("DELETE", `/connections/${c.id}`)).status).toBe(404);
});

test("revocation: when Google cannot be reached the mailbox is still disconnected and the page is named", async () => {
  const h = harness({ codeT: box("rx") });
  const u = await user("rx");
  await h.connect(u, "gmail", "codeT");
  await h.settle();
  const [c] = (await h.as(u).call("GET", "/connections")).json.connections;
  h.fake.failNext(/oauth2\.googleapis\.com\/revoke/, 503, 3);
  const del = await h.call("DELETE", `/connections/${c.id}`);
  expect(del.json).toEqual({ ok: true, revoked: false, manualRevokeUrl: "https://myaccount.google.com/permissions" });
  expect(await prisma.emailConnection.count({ where: { id: c.id } })).toBe(0);
});

// ── Forwarding ───────────────────────────────────────────────────────────────

const SECRET = TEST_CONFIG.inbound!.secret;
const inbound = (h: ReturnType<typeof harness>, body: unknown, secret = SECRET) =>
  h.as(null).call("POST", "/inbound", body, { "x-inbound-secret": secret });

test("forwarding: /inbound reads the raw message with the same parser and stores a forwarding finding once", async () => {
  const h = harness({});
  const u = await user("fw");
  const addr = await h.as(u).call("GET", "/inbox-address");
  expect(addr.json).toMatchObject({ verified: false, confirmationCode: null });
  expect(addr.json.address).toMatch(/^u_[0-9a-f]{18}@in\.budget\.test$/);

  const raw = Buffer.from(netflixRenewal("fw1", 1).raw).toString("base64");
  expect(await inbound(h, { to: addr.json.address, raw })).toEqual({ status: 200, json: { received: true }, location: "" });
  // A retried delivery is stored once.
  expect((await inbound(h, { to: addr.json.address, raw })).status).toBe(200);
  const rows = await prisma.inboxEmail.findMany({ where: { userId: u.id } });
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({ source: "forwarding", kind: "renewal", merchant: "Netflix", amount: 15.49, currency: "USD", label: "" });
  const conns = (await h.as(u).call("GET", "/connections")).json.connections;
  expect(conns[0]).toMatchObject({ provider: "forwarding", address: addr.json.address, forwardingVerified: true, findingsCount: 1 });
  expect(rows[0]!.connectionId).toBe(conns[0].id);

  // Not a bill: acknowledged, nothing stored.
  const news = Buffer.from(newsletter("fw2", 1).raw).toString("base64");
  expect((await inbound(h, { to: addr.json.address, raw: news })).status).toBe(200);
  expect(await prisma.inboxEmail.count({ where: { userId: u.id } })).toBe(1);
});

test("forwarding: /inbound needs the secret, and answers 404 unknown_recipient for an address that is not ours", async () => {
  const h = harness({});
  const raw = Buffer.from(netflixRenewal("fx1", 1).raw).toString("base64");
  expect((await inbound(h, { to: "u_abcdef123456@in.budget.test", raw }, "wrong")).status).toBe(401);
  expect((await h.as(null).call("POST", "/inbound", { to: "u_abcdef123456@in.budget.test", raw })).status).toBe(401);
  expect(await inbound(h, { to: "u_abcdef123456@in.budget.test", raw })).toMatchObject({ status: 404, json: { error: "unknown_recipient" } });
  expect(await inbound(h, { to: "postmaster@in.budget.test", raw })).toMatchObject({ status: 404, json: { error: "unknown_recipient" } });
  expect((await inbound(h, { to: "u_abcdef123456@in.budget.test", raw: "%%%not base64%%%" })).status).toBe(400);
  expect((await inbound(h, { raw })).status).toBe(400);
  const off = harness({}, { config: { inbound: null } });
  expect((await inbound(off, { to: "u_x@in.budget.test", raw })).status).toBe(503);
});

test("forwarding: Gmail's confirmation code is recognised and shown with the address, not stored as a finding", async () => {
  const h = harness({});
  const u = await user("fy");
  const addr = (await h.as(u).call("GET", "/inbox-address")).json.address as string;
  const confirm = [
    "From: Gmail Team <forwarding-noreply@google.com>",
    `To: ${addr}`,
    "Subject: (#612345789) Gmail Forwarding Confirmation - Receive Mail from fy@gmail.com",
    "Message-ID: <confirm-1@google.com>",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "fy@gmail.com has requested to automatically forward mail to your email address.",
    "Confirmation code: 612345789",
  ].join("\r\n");
  expect((await inbound(h, { to: addr, raw: Buffer.from(confirm).toString("base64") })).status).toBe(200);
  const shown = (await h.as(u).call("GET", "/inbox-address")).json;
  expect(shown.confirmationCode).toBe("612345789");
  expect(shown.verified).toBe(false);
  expect((await h.call("GET", "/findings")).json.findings).toEqual([]);
  const row = await prisma.inboxEmail.findFirstOrThrow({ where: { userId: u.id } });
  expect(row.label).not.toContain("fy@gmail.com");
});

test("forwarding: a message from a worker deployed before the raw format is still read", async () => {
  const h = harness({});
  const u = await user("fz");
  const addr = (await h.as(u).call("GET", "/inbox-address")).json.address as string;
  const legacy = { to: addr, from: "Spotify <no-reply@spotify.com>", subject: "Your Spotify Premium receipt", text: "Thanks for your payment.\nSpotify Premium — monthly subscription\nTotal paid: €10.99" };
  expect((await inbound(h, legacy)).status).toBe(200);
  const rows = await prisma.inboxEmail.findMany({ where: { userId: u.id } });
  expect(rows.map((r) => [r.merchant, r.amount, r.currency])).toEqual([["Spotify", 10.99, "EUR"]]);
});
