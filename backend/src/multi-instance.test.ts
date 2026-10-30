import { test, expect, beforeAll, afterAll } from "bun:test";
import type { Context } from "hono";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { withDefaultUser } from "./lib/database-url";
import { createRateLimiter } from "./auth";
import { allowUsageTiered } from "./lib/usage-limit";
import { aiAllowance, FREE_AI_CALLS_PER_DAY } from "./lib/entitlement";
import { makeJoinRateLimiter, JOIN_MAX } from "./lib/group-invites";
import { consumeLinkSession, rememberLinkSession } from "./routes/plaid";
import { createRatesRouter, type RatesPayload } from "./routes/rates";
import { readFile, rm, writeFile } from "./lib/distributed/files";
import { withJobLease } from "./lib/distributed/lease";
import { processRecurring } from "./jobs/recurring-processor";
import { occurrenceId, runRecurringNow } from "./jobs/recurring-booking";
import { dbToday } from "./lib/distributed/clock";

/**
 * Two instances of the server on one database.
 *
 * Each "instance" here has its own PrismaClient — its own connection pool, as
 * a second process would — and builds its own limiters, routers and jobs from
 * it, the way each process does at module load. Nothing is shared between the
 * two except Postgres. Before this, every one of these behaviours lived in a
 * Map or a variable in one process, and each assertion below would have seen
 * two independent copies.
 */

const A = prisma;
const B = new PrismaClient({ datasources: { db: { url: withDefaultUser(process.env.DATABASE_URL!) } } });

const RUN = `mi${process.pid}${Date.now().toString(36)}`;
const USER = `${RUN}_user`;

beforeAll(async () => {
  await B.$connect();
  const now = new Date();
  await A.user.create({ data: { id: USER, name: "Multi", email: `${USER}@x.test`, createdAt: now, updatedAt: now } });
});

afterAll(async () => {
  await A.transaction.deleteMany({ where: { userId: USER } });
  await A.recurringTransaction.deleteMany({ where: { userId: USER } });
  await A.user.deleteMany({ where: { id: USER } });
  await A.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
  await A.cacheEntry.deleteMany({ where: { OR: [{ key: { contains: RUN } }, { key: { startsWith: "rates:" } }] } });
  await A.storedFile.deleteMany({ where: { id: { startsWith: `${RUN}/` } } });
  await A.jobLease.deleteMany({ where: { name: { startsWith: RUN } } });
  await B.$disconnect();
});

/** The slice of Hono's Context the auth limiters read: two headers. */
function authRequest(ip: string, identifier: string) {
  return {
    req: {
      header: (name: string) =>
        name === "x-forwarded-for" ? ip : name === "x-rate-limit-identifier" ? identifier : undefined,
      query: () => undefined,
    },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as unknown as Context;
}

async function status(limiter: ReturnType<typeof createRateLimiter>, c: Context) {
  const res = (await limiter(c, async () => {})) as unknown as { status: number } | undefined;
  return res?.status ?? 200;
}

// The sign-in limiter's settings, built once per instance.
const LOGIN = {
  scope: `login-${RUN}`, ipMax: 15, ipWindowMs: 10 * 60_000,
  identifierMax: 5, identifierWindowMs: 10 * 60_000, identifierLockoutThreshold: 5,
};

test("the sign-in limit is one budget across instances, not one per instance", async () => {
  const onA = createRateLimiter(LOGIN, A);
  const onB = createRateLimiter(LOGIN, B);
  const who = `victim-${RUN}@x.test`;
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push(await status(i % 2 ? onB : onA, authRequest("10.0.0.1", who)));
  // In-process counters would have allowed five on each, ten in all.
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
});

test("a lockout tripped on one instance is enforced by the other", async () => {
  const onA = createRateLimiter(LOGIN, A);
  const onB = createRateLimiter(LOGIN, B);
  const who = `locked-${RUN}@x.test`;
  for (let i = 0; i < 6; i++) await status(onA, authRequest(`10.0.1.${i}`, who));
  const res = (await onB(authRequest("10.0.2.1", who), async () => {})) as unknown as {
    status: number;
    body: { error: string };
  };
  expect(res.status).toBe(429);
  expect(res.body.error).toBe("Account temporarily locked, try again later");
});

test("a free user's AI allowance is counted once across instances", async () => {
  const allowance = aiAllowance(false);
  const user = `ai-${RUN}`;
  const results = [];
  for (let i = 0; i < FREE_AI_CALLS_PER_DAY + 2; i++) {
    results.push(await allowUsageTiered("ai", user, allowance, i % 2 ? B : A));
  }
  expect(results.filter(Boolean).length).toBe(FREE_AI_CALLS_PER_DAY);
  expect(results.slice(FREE_AI_CALLS_PER_DAY)).toEqual([false, false]);
});

test("invite-code attempts share one budget across instances, even when concurrent", async () => {
  const onA = makeJoinRateLimiter(`household-${RUN}`, { db: A });
  const onB = makeJoinRateLimiter(`household-${RUN}`, { db: B });
  const attempts = await Promise.all(
    Array.from({ length: JOIN_MAX * 2 }, (_, i) => (i % 2 ? onB : onA)("guesser"))
  );
  expect(attempts.filter(Boolean).length).toBe(JOIN_MAX);
});

test("a bank link session created on one instance is consumed exactly once on the other", async () => {
  const linkToken = `link-${RUN}`;
  await rememberLinkSession(linkToken, USER, A);
  // The provider's webhook reaches B — twice at once, as retried deliveries do.
  const [first, second] = await Promise.all([
    consumeLinkSession(linkToken, B),
    consumeLinkSession(linkToken, B),
  ]);
  expect([first, second].filter((u) => u === USER)).toHaveLength(1);
  expect([first, second].filter((u) => u === null)).toHaveLength(1);
  expect(await consumeLinkSession(linkToken, A)).toBeNull();
});

test("exchange rates are fetched once for both instances", async () => {
  await A.cacheEntry.deleteMany({ where: { key: { startsWith: "rates:" } } });
  let upstreamCalls = 0;
  const payload: RatesPayload = { base: "USD", rates: { USD: 1, MAD: 9.8 }, asOf: "2026-10-11", source: RUN };
  const fetchUpstream = async () => {
    upstreamCalls++;
    await new Promise((r) => setTimeout(r, 150));
    return payload;
  };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const appA = createRatesRouter({ db: A, fetchUpstream, sleep });
  const appB = createRatesRouter({ db: B, fetchUpstream, sleep });

  const responses = await Promise.all([appA, appB, appA, appB].map((app) => app.request("/")));
  for (const res of responses) {
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  }
  // And later requests on either are served from the shared cache.
  expect((await appB.request("/")).status).toBe(200);
  expect(upstreamCalls).toBe(1);
});

test("a receipt written by one instance is served by the other, and removed for both", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
  const path = `${RUN}/biz/expense`;
  await writeFile(path, bytes, { kind: "receipt", ownerId: "expense", contentType: "image/png" }, A);
  const served = await readFile(path, B);
  expect(served!.contentType).toBe("image/png");
  expect(new Uint8Array(served!.bytes)).toEqual(bytes);
  await rm(`${RUN}/biz`, { recursive: true }, B);
  expect(await readFile(path, A)).toBeNull();
});

test("a job lease held by one instance is refused to the other until released", async () => {
  const name = `${RUN}-job`;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const running = new Promise<void>((r) => (started = r));

  const onA = withJobLease(name, 60_000, async () => {
    started();
    await held;
    return "A ran";
  }, { db: A });
  await running;
  expect(await withJobLease(name, 60_000, async () => "B ran", { db: B })).toEqual({ acquired: false });
  release();
  expect(await onA).toEqual({ acquired: true, value: "A ran" });
  expect(await withJobLease(name, 60_000, async () => "B ran", { db: B })).toEqual({ acquired: true, value: "B ran" });
});

test("two instances processing recurring transactions at once book each occurrence once", async () => {
  const today = await dbToday(A);
  const ids = [`${RUN}_r1`, `${RUN}_r2`, `${RUN}_r3`];
  for (const id of ids) {
    await A.recurringTransaction.create({
      data: {
        id, userId: USER, name: id, amount: 10, category: "Gym", type: "Expense",
        frequency: "monthly", startDate: today, nextDate: today, isActive: true,
      },
    });
  }
  // The lease normally keeps the two apart; this runs the ticks' work
  // directly, as two instances would after a lost lease, to prove the
  // per-row claim alone books each occurrence once.
  const [onA, onB] = await Promise.all([
    processRecurring({ db: A, userIds: [USER] }),
    processRecurring({ db: B, userIds: [USER] }),
  ]);
  expect(onA + onB).toBe(3);
  for (const id of ids) {
    const rows = await A.transaction.findMany({ where: { id: { startsWith: `tx_rec_${id}_` } } });
    expect(rows.map((r) => r.id)).toEqual([occurrenceId(id, today)]);
  }
});

test("run-now on both instances at once books today's occurrence once", async () => {
  const today = await dbToday(A);
  const id = `${RUN}_now`;
  await A.recurringTransaction.create({
    data: {
      id, userId: USER, name: "Rent", amount: 900, category: "Other", type: "Expense",
      frequency: "monthly", startDate: today, nextDate: today, isActive: true,
    },
  });
  const results = await Promise.all([
    runRecurringNow(id, USER, A),
    runRecurringNow(id, USER, B),
    runRecurringNow(id, USER, B),
  ]);
  expect(results.map((r) => r!.status).sort()).toEqual([200, 200, 201]);
  expect(new Set(results.map((r) => r!.transactionId))).toEqual(new Set([occurrenceId(id, today)]));
  expect(await A.transaction.count({ where: { id: { startsWith: `tx_rec_${id}_` } } })).toBe(1);
});
