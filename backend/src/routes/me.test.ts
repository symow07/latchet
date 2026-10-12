import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { meRouter, deletionDeps } from "./me";
import { deleteAccount } from "../lib/account-deletion";
import { processCipher } from "../lib/email-providers";
import { gmailProvider } from "../lib/email-providers/gmail";
import { recordGrant, userKeyFor } from "../lib/email-providers/oauth";
import { startFake, TEST_CONFIG } from "../lib/email-providers/test-fakes";

/**
 * PUT /me/timezone (Phase 5 decision 1): the time zone the user's phone
 * reports, which the server's "today" for them is read in. Through the real
 * router against Postgres, with the session middleware's job — setting
 * `user` — done by the test.
 */

const U = `metz_${process.pid}${Date.now().toString(36)}`;

let actingAs = "";
type TestEnv = { Variables: { user: { id: string; email: string } | null; session: unknown } };
const app = new Hono<TestEnv>();
app.use("*", async (c, next) => {
  c.set("user", actingAs ? { id: actingAs, email: `${actingAs}@x.test` } : null);
  await next();
});
app.route("/me", meRouter as unknown as Hono<TestEnv>);

async function putZone(body: unknown) {
  const res = await app.fetch(
    new Request("http://t/me/timezone", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    // A body that is not JSON is refused before the handler, as plain text.
  }
  return { status: res.status, json };
}
const storedZone = async () => (await prisma.user.findUniqueOrThrow({ where: { id: U } })).timezone;

beforeAll(async () => {
  const now = new Date();
  await prisma.user.create({ data: { id: U, name: U, email: `${U}@x.test`, createdAt: now, updatedAt: now } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: U } });
});

test("user's local day: a user starts with no time zone (UTC), and PUT /me/timezone stores the one the phone reports", async () => {
  actingAs = U;
  expect(await storedZone()).toBeNull();
  expect(await putZone({ timeZone: "Pacific/Kiritimati" })).toEqual({ status: 200, json: { timeZone: "Pacific/Kiritimati" } });
  expect(await storedZone()).toBe("Pacific/Kiritimati");
  // Reporting a new zone replaces it; the same one again is harmless.
  expect((await putZone({ timeZone: "Europe/Paris" })).status).toBe(200);
  expect((await putZone({ timeZone: "Europe/Paris" })).status).toBe(200);
  expect(await storedZone()).toBe("Europe/Paris");
});

test("user's local day: the zone is stored in its canonical spelling", async () => {
  actingAs = U;
  expect(await putZone({ timeZone: "asia/shanghai" })).toEqual({ status: 200, json: { timeZone: "Asia/Shanghai" } });
  expect(await storedZone()).toBe("Asia/Shanghai");
});

test("user's local day: a zone that is not a known IANA name is a 400 and leaves the stored one alone", async () => {
  actingAs = U;
  await putZone({ timeZone: "Africa/Casablanca" });
  for (const timeZone of ["Mars/Olympus_Mons", "+01:00", "Europe/Paris; DROP TABLE", " ", "x".repeat(65)]) {
    const res = await putZone({ timeZone });
    expect(res.status).toBe(400);
  }
  expect(await putZone({ timeZone: "Mars/Olympus_Mons" })).toEqual({
    status: 400, json: { error: "Unknown time zone", code: "invalid_timezone" },
  });
  // Not the right shape at all: the validator's 400.
  for (const body of [{}, { timeZone: 5 }, { timeZone: null }, { tz: "Europe/Paris" }, "not json"]) {
    expect((await putZone(body)).status).toBe(400);
  }
  expect(await storedZone()).toBe("Africa/Casablanca");
});

test("user's local day: setting the time zone requires a session", async () => {
  actingAs = "";
  expect((await putZone({ timeZone: "Europe/Paris" })).status).toBe(401);
  expect(await storedZone()).toBe("Africa/Casablanca");
});

// ── Account deletion's real steps, with mailboxes ────────────────────────────

test("revocation: deleting the account revokes Gmail at Google, names Outlook, and keeps only the lifetime Gmail ledger", async () => {
  const id = `${U}_del`;
  const now = new Date();
  await prisma.user.create({ data: { id, name: id, email: `${id}@x.test`, createdAt: now, updatedAt: now } });
  const fake = startFake({ codeD: { gmailAddress: "del@gmail.com", gmail: [], outlook: [] } });
  const grant = await gmailProvider(TEST_CONFIG.google!, fake.http).exchangeCode({ code: "codeD", codeVerifier: "v".repeat(43), redirectUri: "r" });
  const gmail = await prisma.emailConnection.create({
    data: { userId: id, provider: "gmail", email: "del@gmail.com", refreshTokenEnc: processCipher.encrypt(grant.refreshToken!) },
  });
  await prisma.emailConnection.create({
    data: { userId: id, provider: "outlook", email: "del@outlook.com", refreshTokenEnc: processCipher.encrypt("m-refresh-x") },
  });
  await prisma.inboxEmail.create({ data: { userId: id, connectionId: gmail.id, source: "gmail", kind: "renewal", messageKey: `${id}-k` } });
  await recordGrant("gmail", id);

  try {
    const result = await deleteAccount(id, deletionDeps({ http: fake.http, cipher: processCipher }));
    expect(fake.log.googleRevoked).toEqual([grant.refreshToken!]);
    expect(result).toEqual({
      deleted: true,
      revoked: { banks: 0, inboxes: 1 },
      unrevoked: [{ kind: "email", label: "del@outlook.com", manualRevokeUrl: "https://account.live.com/consent/Manage" }],
    });
    expect(await prisma.user.count({ where: { id } })).toBe(0);
    expect(await prisma.emailConnection.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.inboxEmail.count({ where: { userId: id } })).toBe(0);
    // Google counts the user for life; so does the cap's ledger.
    expect(await prisma.emailOAuthGrant.count({ where: { provider: "gmail", userKey: userKeyFor(id) } })).toBe(1);
  } finally {
    await prisma.user.deleteMany({ where: { id } });
    await prisma.emailOAuthGrant.deleteMany({ where: { userKey: userKeyFor(id) } });
  }
});
