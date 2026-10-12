import { test, expect, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { findingRow } from "./findings";
import { gmailProvider } from "./gmail";
import { outlookProvider } from "./outlook";
import { processCipher } from "./index";
import { syncConnection, type SyncDeps } from "./sync";
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
} from "./test-fakes";
import type { EmailFinding } from "../email-parse";

/**
 * Reading a mailbox end to end against Postgres and the fake providers: the
 * backfill, its resumption, incremental passes, an expired grant, the
 * per-connection lease, and what is (not) stored and logged.
 */

const P = `esync${process.pid}${Date.now().toString(36)}`;
afterAll(() => cleanupUsers(P));

const cipher = processCipher;

async function setup(provider: "gmail" | "outlook", box: Omit<FakeMailbox, "gmailAddress" | "outlookAddress">, label: string) {
  const user = await testUser(P, label);
  const code = `code_${label}`;
  const fake = startFake({ [code]: { gmailAddress: `${label}@gmail.com`, outlookAddress: `${label}@outlook.com`, ...box } });
  const providers = {
    gmail: gmailProvider(TEST_CONFIG.google!, fake.http),
    outlook: outlookProvider(TEST_CONFIG.microsoft!, fake.http),
  };
  const grant = await providers[provider].exchangeCode({ code, codeVerifier: "v".repeat(43), redirectUri: "r" });
  const conn = await prisma.emailConnection.create({
    data: { userId: user.id, provider, email: `${label}@${provider}.test`, refreshTokenEnc: cipher.encrypt(grant.refreshToken!) },
  });
  const deps: SyncDeps = { providers, cipher, aiFor: () => null };
  return { user, fake, deps, conn, code, grant };
}

const findings = (connectionId: string) =>
  prisma.inboxEmail.findMany({ where: { connectionId }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });
const connection = (id: string) => prisma.emailConnection.findUniqueOrThrow({ where: { id } });

test("inbox sync: the one-year backfill pages through every match, skips older mail, and ends idle", async () => {
  const gmail = [
    netflixRenewal("b1", 2),
    spotifyReceipt("b2", 20),
    newsletter("b3", 30),
    netflixRenewal("b4", 100),
    spotifyReceipt("b5", 300),
    netflixRenewal("b-old", 500),
  ];
  const { fake, deps, conn } = await setup("gmail", { gmail, outlook: [] }, "backfill");
  fake.pageSize.gmail = 2;
  const out = await syncConnection(conn.id, deps);

  expect(out).toMatchObject({ ran: true, phase: "backfill", complete: true, error: null });
  const rows = await findings(conn.id);
  expect(rows.length).toBe(4);
  expect(rows.every((r) => r.source === "gmail" && r.connectionId === conn.id && r.userId === conn.userId)).toBe(true);
  // Several pages per search, every search bounded to a year.
  expect(fake.log.gmailQueries.length).toBeGreaterThan(3);
  expect(fake.log.gmailQueries.every((q) => q.startsWith("newer_than:1y "))).toBe(true);
  // Each message downloaded once, though every search lists it.
  const fetched = fake.log.rawFetches.map((f) => f.split(":")[1]);
  expect(new Set(fetched).size).toBe(fetched.length);
  expect(fetched).not.toContain("b-old");

  const c = await connection(conn.id);
  expect(c.syncState).toBe("idle");
  expect(c.status).toBe("active");
  expect(c.backfillDoneAt).not.toBeNull();
  expect(c.backfillCursor).toBeNull();
  expect(c.lastSyncedAt).not.toBeNull();
  expect(c.messagesScanned).toBe(5);
  expect(c.findingsCount).toBe(4);
  expect(Number(c.syncCursor)).toBeGreaterThan(Date.now() - 60_000);
});

test("inbox sync: a backfill cut short by the provider resumes from its saved cursor without re-reading", async () => {
  const gmail = Array.from({ length: 6 }, (_, i) => netflixRenewal(`r${i}`, 2 + i * 10));
  const { fake, deps, conn } = await setup("gmail", { gmail, outlook: [] }, "resume");
  fake.pageSize.gmail = 2;
  // The third listing call fails through every retry: the pass stops there.
  let calls = 0;
  const realFetch = fake.http.fetch;
  fake.http.fetch = async (url, init) => {
    if (url.includes("/gmail/v1/users/me/messages?") && ++calls === 3) {
      fake.failNext(/gmail\/v1\/users\/me\/messages$/, 503, 3);
    }
    return realFetch(url, init);
  };
  const first = await syncConnection(conn.id, deps);
  expect(first).toMatchObject({ ran: true, phase: "backfill", complete: false, error: "provider_busy" });
  const mid = await connection(conn.id);
  expect(mid.backfillDoneAt).toBeNull();
  expect(mid.backfillCursor).not.toBeNull();
  expect(mid.syncState).toBe("idle");
  expect(mid.status).toBe("active");
  const storedFirst = (await findings(conn.id)).length;
  expect(storedFirst).toBe(4);
  const fetchedFirst = fake.log.rawFetches.length;

  fake.http.fetch = realFetch;
  const second = await syncConnection(conn.id, deps);
  expect(second).toMatchObject({ ran: true, phase: "backfill", complete: true });
  expect((await findings(conn.id)).length).toBe(6);
  // The resumed pass started at the page it stopped on.
  const again = fake.log.rawFetches.slice(fetchedFirst).map((f) => f.split(":")[1]);
  expect(again.sort()).toEqual(["r4", "r5"]);
  expect((await connection(conn.id)).backfillDoneAt).not.toBeNull();
});

test("inbox sync: an incremental pass reads only mail since the last one and stores nothing twice", async () => {
  const gmail = [netflixRenewal("i1", 3), spotifyReceipt("i2", 5), newsletter("i3", 4)];
  const { fake, deps, conn } = await setup("gmail", { gmail, outlook: [] }, "incr");
  await syncConnection(conn.id, deps);
  expect((await findings(conn.id)).length).toBe(2);
  const fetchedBefore = fake.log.rawFetches.length;
  const queriesBefore = fake.log.gmailQueries.length;

  gmail.push(spotifyReceipt("i4", 0));
  const out = await syncConnection(conn.id, deps);
  expect(out).toMatchObject({ ran: true, phase: "incremental", complete: true, stored: 1 });
  const queries = fake.log.gmailQueries.slice(queriesBefore);
  expect(queries.every((q) => /^after:\d+ /.test(q))).toBe(true);
  // after: is the previous pass's start less a day.
  const after = Number(/^after:(\d+)/.exec(queries[0]!)![1]) * 1000;
  expect(after).toBeLessThan(Date.now() - 23 * 3600_000);
  expect(after).toBeGreaterThan(Date.now() - 25 * 3600_000);
  expect(fake.log.rawFetches.slice(fetchedBefore).map((f) => f.split(":")[1])).toEqual(["i4"]);

  // Nothing new: nothing downloaded, nothing stored.
  const third = await syncConnection(conn.id, deps);
  expect(third).toMatchObject({ ran: true, phase: "incremental", stored: 0 });
  const rows = await findings(conn.id);
  expect(rows.length).toBe(3);
  expect(new Set(rows.map((r) => r.messageKey)).size).toBe(3);
});

test("inbox sync: an expired grant marks the connection for reconnection and nothing more is tried", async () => {
  const { fake, deps, conn, code } = await setup("gmail", { gmail: [netflixRenewal("x1", 1)], outlook: [] }, "expired");
  fake.revokeAll(code);
  const out = await syncConnection(conn.id, deps);
  expect(out).toMatchObject({ ran: true, complete: false, error: "reauth_required" });
  const c = await connection(conn.id);
  expect(c.status).toBe("needs_reauth");
  expect(c.lastError).toBe("reauth_required");
  expect(c.syncState).toBe("idle");

  const requests = fake.log.requests.length;
  expect(await syncConnection(conn.id, deps)).toEqual({ ran: false, reason: "not_syncable" });
  expect(fake.log.requests.length).toBe(requests);
});

test("inbox sync: one connection never syncs twice at once", async () => {
  const { fake, deps, conn } = await setup("gmail", { gmail: [netflixRenewal("l1", 1), spotifyReceipt("l2", 2)], outlook: [] }, "lease");
  const hold = fake.holdListings();
  const first = syncConnection(conn.id, deps);
  for (let i = 0; i < 100 && !fake.log.requests.some((r) => r.includes("/messages")); i++) await Bun.sleep(10);

  // A second pass (another instance's job tick, a manual sync) is refused.
  expect(await syncConnection(conn.id, deps)).toEqual({ ran: false, reason: "busy" });
  hold.release();
  expect(await first).toMatchObject({ ran: true, complete: true });
  expect((await findings(conn.id)).length).toBe(2);
  // Free again once it finished.
  expect(await syncConnection(conn.id, deps)).toMatchObject({ ran: true, phase: "incremental" });
});

test("inbox sync: Microsoft's rotated refresh token is stored at once and used by the next pass", async () => {
  const outlook = [netflixRenewal("m1", 2), newsletter("m2", 3)];
  const { deps, conn, grant } = await setup("outlook", { gmail: [], outlook }, "rotate");
  const first = await syncConnection(conn.id, deps);
  expect(first).toMatchObject({ ran: true, complete: true });
  const stored = cipher.decrypt((await connection(conn.id)).refreshTokenEnc!);
  expect(stored).not.toBe(grant.refreshToken);
  expect(stored).toStartWith("m-refresh-");
  // The old token is dead at the fake (as at Microsoft); the pass works with the new one.
  outlook.push(spotifyReceipt("m3", 0));
  expect(await syncConnection(conn.id, deps)).toMatchObject({ ran: true, complete: true, stored: 1 });
});

test("inbox sync: an access token the provider refuses is refreshed once and the pass carries on", async () => {
  const { fake, deps, conn } = await setup("gmail", { gmail: [netflixRenewal("t1", 1)], outlook: [] }, "refresh");
  const out = await syncConnection(conn.id, deps, { accessToken: "g-access-stale" });
  expect(out).toMatchObject({ ran: true, complete: true, stored: 1 });
  expect(fake.log.tokenForms.filter((f) => f.grant_type === "refresh_token").length).toBe(1);
});

test("full message: what the sync stores was read from the body, not the subject or a snippet", async () => {
  // Neither subject carries an amount; only the full body does.
  const gmail = [netflixRenewal("f1", 1)];
  const outlook = [spotifyReceipt("f2", 1)];
  const g = await setup("gmail", { gmail, outlook: [] }, "fullg");
  await syncConnection(g.conn.id, g.deps);
  const [nf] = await findings(g.conn.id);
  expect(nf).toMatchObject({ kind: "renewal", merchant: "Netflix", amount: 15.49, currency: "USD", cadence: "monthly" });
  expect(g.fake.log.rawFetches).toEqual(["gmail:f1:raw"]);

  const o = await setup("outlook", { gmail: [], outlook }, "fullo");
  await syncConnection(o.conn.id, o.deps);
  const [sp] = await findings(o.conn.id);
  expect(sp).toMatchObject({ kind: "receipt", merchant: "Spotify", amount: 10.99, currency: "EUR", source: "outlook" });
  expect(o.fake.log.rawFetches).toEqual(["outlook:f2:$value"]);
});

// ── No raw mail ──────────────────────────────────────────────────────────────

/** Every column of every finding of a connection, as text. */
async function storedText(connectionId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ j: string }[]>`
    SELECT row_to_json(e)::text AS j FROM "InboxEmail" e WHERE e."connectionId" = ${connectionId}`;
  const conn = await prisma.$queryRaw<{ j: string }[]>`
    SELECT row_to_json(c)::text AS j FROM "EmailConnection" c WHERE c."id" = ${connectionId}`;
  return [...rows, ...conn].map((r) => r.j).join("\n");
}

test("no raw mail: a stored finding holds extracted fields only — no body, subject, sender address or message id", async () => {
  const m = netflixRenewal("secret-id-1", 1);
  const { conn, deps, grant } = await setup("gmail", { gmail: [m], outlook: [] }, "noraw");
  await syncConnection(conn.id, deps);
  const [row] = await findings(conn.id);
  expect(row!.merchant).toBe("Netflix");
  expect(row!.senderDomain).toBe("netflix.com");
  expect(row!.label).toBe("");
  expect(row!.messageKey).toBe(createHash("sha256").update("gmail:secret-id-1").digest("hex"));

  const text = await storedText(conn.id);
  const messageIdHeader = /Message-ID: <([^>]+)>/.exec(Buffer.from(m.raw).toString("latin1"))![1]!;
  for (const secret of [
    "Your Netflix membership has been renewed", "Amount charged", "Plan: Standard", "The Netflix team",
    "info@account.netflix.com", "someone@example.test", "secret-id-1", messageIdHeader,
    grant.refreshToken!, grant.accessToken,
  ]) {
    expect(text).not.toContain(secret);
  }
});

test("no raw mail: the subject remnant is kept only when no merchant was found, and other kinds are not stored", () => {
  const base: EmailFinding = {
    kind: "receipt", merchant: "Spotify", senderDomain: "spotify.com", billedVia: null, amount: 9.99, currency: "EUR",
    cadence: "monthly", chargedISO: null, emailDateISO: "2026-10-01", nextChargeISO: null, trialEndsISO: null,
    previousAmount: null, confidence: 0.9, parser: "rules", label: "Your Spotify receipt",
  };
  const ctx = { userId: "u", connectionId: "c", source: "gmail" as const, messageKey: "k", receivedAt: new Date() };
  expect(findingRow(base, ctx)!.label).toBe("");
  expect(findingRow({ ...base, merchant: null }, ctx)!.label).toBe("Your Spotify receipt");
  expect(findingRow({ ...base, kind: "other" }, ctx)).toBeNull();
  expect(findingRow(null, ctx)).toBeNull();
});

test("no raw mail: nothing about the mail or the tokens reaches the log, even when a pass fails", async () => {
  const lines: string[] = [];
  const spied = ["log", "info", "warn", "error", "debug"] as const;
  const originals = spied.map((k) => console[k]);
  for (const k of spied) console[k] = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  let fakes: FakeProviders[] = [];
  let tokens: string[] = [];
  try {
    const ok = await setup("gmail", { gmail: [netflixRenewal("log-id-1", 1), newsletter("log-id-2", 2)], outlook: [] }, "logok");
    await syncConnection(ok.conn.id, ok.deps);
    const bad = await setup("outlook", { gmail: [], outlook: [spotifyReceipt("log-id-3", 1)] }, "logbad");
    bad.fake.failNext(/graph\.microsoft\.com\/v1\.0\/me\/messages$/, 500, 3);
    await syncConnection(bad.conn.id, bad.deps);
    const gone = await setup("gmail", { gmail: [netflixRenewal("log-id-4", 1)], outlook: [] }, "loggone");
    gone.fake.revokeAll(gone.code);
    await syncConnection(gone.conn.id, gone.deps);
    fakes = [ok.fake, bad.fake, gone.fake];
    tokens = [ok.grant.refreshToken!, ok.grant.accessToken, bad.grant.refreshToken!, gone.grant.refreshToken!];
  } finally {
    spied.forEach((k, i) => (console[k] = originals[i]!));
  }
  expect(fakes.length).toBe(3);
  expect(lines.length).toBeGreaterThan(0); // the failures were reported…
  const log = lines.join("\n");
  for (const secret of [
    "Netflix membership", "Amount charged", "Spotify Premium", "Total paid", "gadgets", "Unsubscribe",
    "info@account.netflix.com", "no-reply@spotify.com", "@gmail.com", "@outlook.com",
    "log-id-1", "log-id-2", "log-id-3", "log-id-4", "g-refresh-", "g-access-", "m-refresh-", "m-access-", ...tokens,
  ]) {
    expect(log).not.toContain(secret); // …without a word of the mail
  }
});
