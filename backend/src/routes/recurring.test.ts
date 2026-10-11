import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { recurringRouter } from "./recurring";
import { processRecurring } from "../jobs/recurring-processor";
import { occurrenceId } from "../jobs/recurring-booking";
import { dbToday } from "../lib/distributed/clock";
import { advanceDays, anchorDayOf, computeNextDate } from "../lib/recurrence";

/**
 * "Run now" (POST /recurring/:id/run) and the recurring job, through the real
 * handlers against Postgres. The property that matters: each occurrence is
 * booked exactly once, whoever asks and however often — the app used to post
 * its own transaction and then set nextDate to today, and the job booked a
 * second one on top.
 */

const P = `rectest_${process.pid}${Date.now().toString(36)}_`;
const OWNER = `${P}owner`;
const OTHER = `${P}other`;
const OWNER_ACCOUNT = `${P}acc_owner`;
const OTHER_ACCOUNT = `${P}acc_other`;

let actingAs = "";
type TestEnv = { Variables: { user: { id: string; email: string } | null; session: unknown } };
const app = new Hono<TestEnv>();
app.use("*", async (c, next) => {
  c.set("user", actingAs ? { id: actingAs, email: `${actingAs}@x.test` } : null);
  await next();
});
app.route("/recurring", recurringRouter as unknown as Hono<TestEnv>);

const as = (userId: string) => {
  actingAs = userId;
};
async function call(method: string, path: string, body?: unknown) {
  const res = await app.fetch(
    new Request(`http://t${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

let today = "";

async function cleanup() {
  await prisma.transaction.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.recurringTransaction.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.bankAccount.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  today = await dbToday();
  const now = new Date();
  for (const id of [OWNER, OTHER]) {
    await prisma.user.create({ data: { id, name: id, email: `${id}@x.test`, createdAt: now, updatedAt: now } });
  }
  await prisma.bankAccount.create({ data: { id: OWNER_ACCOUNT, userId: OWNER, name: "Main", type: "checking" } });
  await prisma.bankAccount.create({ data: { id: OTHER_ACCOUNT, userId: OTHER, name: "Theirs", type: "checking" } });
});
afterAll(cleanup);

/** A series of the owner's, created through the API. */
async function series(overrides: Record<string, unknown> = {}) {
  as(OWNER);
  const res = await call("POST", "/recurring", {
    name: "Gym", amount: 30, category: "Gym", type: "Expense", frequency: "monthly",
    startDate: today, nextDate: today, currency: "EUR", accountId: OWNER_ACCOUNT, ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json as { id: string; startDate: string; frequency: string };
}

const booked = (id: string) =>
  prisma.transaction.findMany({ where: { id: { startsWith: `tx_rec_${id}_` } }, orderBy: { id: "asc" } });

test("run-now books today's occurrence under the job's id and moves the series past today", async () => {
  const rec = await series();
  const res = await call("POST", `/recurring/${rec.id}/run`);

  expect(res.status).toBe(201);
  expect(res.json.transactionId).toBe(occurrenceId(rec.id, today));
  expect(res.json.transactionId).toBe(`tx_rec_${rec.id}_${today}`);
  expect(res.json.nextDate > today).toBe(true);
  expect(res.json.nextDate).toBe(computeNextDate(today, "monthly", anchorDayOf(rec.startDate)));

  const [tx] = await booked(rec.id);
  expect(tx).toMatchObject({
    userId: OWNER, accountId: OWNER_ACCOUNT, amount: 30, category: "Gym", type: "Expense",
    dateISO: today, currency: "EUR", note: "[Auto] Gym",
  });
  // A server-created row carries the server's time as its clientUpdatedAt.
  expect(Math.abs(tx!.clientUpdatedAt.getTime() - Date.now())).toBeLessThan(60_000);

  const after = await prisma.recurringTransaction.findUnique({ where: { id: rec.id } });
  expect(after).toMatchObject({ lastCreated: today, nextDate: res.json.nextDate });
});

test("running it again the same day is idempotent: 200, the same id, nothing new", async () => {
  const rec = await series();
  const first = await call("POST", `/recurring/${rec.id}/run`);
  const second = await call("POST", `/recurring/${rec.id}/run`);
  const third = await call("POST", `/recurring/${rec.id}/run`);

  expect(first.status).toBe(201);
  expect(second.status).toBe(200);
  expect(third.status).toBe(200);
  expect(second.json).toEqual({ transactionId: first.json.transactionId, nextDate: first.json.nextDate });
  expect(await booked(rec.id)).toHaveLength(1);
});

test("only the owner can run a series: anyone else gets 404 and nothing is booked", async () => {
  const rec = await series();
  as(OTHER);
  expect((await call("POST", `/recurring/${rec.id}/run`)).status).toBe(404);
  as("");
  expect((await call("POST", `/recurring/${rec.id}/run`)).status).toBe(401);
  as(OWNER);
  expect((await call("POST", `/recurring/does-not-exist/run`)).status).toBe(404);
  expect(await booked(rec.id)).toHaveLength(0);
  expect((await prisma.recurringTransaction.findUnique({ where: { id: rec.id } }))!.lastCreated).toBeNull();
});

test("after run-now, the job books nothing more that day", async () => {
  const rec = await series();
  expect((await call("POST", `/recurring/${rec.id}/run`)).status).toBe(201);
  await processRecurring({ userIds: [OWNER] });
  await processRecurring({ userIds: [OWNER] });
  expect(await booked(rec.id)).toHaveLength(1);
});

test("after the job has booked today, run-now returns the job's occurrence", async () => {
  const rec = await series();
  expect(await processRecurring({ userIds: [OWNER] })).toBeGreaterThanOrEqual(1);
  const res = await call("POST", `/recurring/${rec.id}/run`);
  expect(res.status).toBe(200);
  expect(res.json.transactionId).toBe(occurrenceId(rec.id, today));
  expect(res.json.nextDate > today).toBe(true);
  expect(await booked(rec.id)).toHaveLength(1);
});

test("run-now and the job at the same moment book the occurrence once", async () => {
  const rec = await series();
  const [run] = await Promise.all([
    call("POST", `/recurring/${rec.id}/run`),
    processRecurring({ userIds: [OWNER] }),
    processRecurring({ userIds: [OWNER] }),
  ]);
  expect([200, 201]).toContain(run.status);
  expect(run.json.transactionId).toBe(occurrenceId(rec.id, today));
  expect(await booked(rec.id)).toHaveLength(1);
});

test("many run-now taps at once: one 201, the rest 200, one transaction", async () => {
  const rec = await series();
  const results = await Promise.all(Array.from({ length: 6 }, () => call("POST", `/recurring/${rec.id}/run`)));
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  expect(results.filter((r) => r.status === 200)).toHaveLength(5);
  expect(new Set(results.map((r) => r.json.transactionId)).size).toBe(1);
  expect(await booked(rec.id)).toHaveLength(1);
});

test("a series not yet due restarts from today when run now", async () => {
  // What the app asked for before: a payment today, the schedule continuing
  // from it — without a second booking.
  const future = advanceDays(today, 20);
  const rec = await series({ frequency: "weekly", startDate: future, nextDate: future });
  const res = await call("POST", `/recurring/${rec.id}/run`);
  expect(res.status).toBe(201);
  expect(res.json.nextDate).toBe(advanceDays(today, 7));
  expect(await booked(rec.id)).toHaveLength(1);
});

test("an overdue series is run up to date: the next date lands after today", async () => {
  const past = advanceDays(today, -45);
  const rec = await series({ frequency: "weekly", startDate: past, nextDate: past });
  const res = await call("POST", `/recurring/${rec.id}/run`);
  expect(res.status).toBe(201);
  expect(res.json.nextDate).toBe(advanceDays(today, 7));
});

test("the job moves an overdue series one step a day and books today once", async () => {
  const past = advanceDays(today, -45);
  const rec = await series({ frequency: "weekly", startDate: past, nextDate: past });
  await processRecurring({ userIds: [OWNER] });
  await processRecurring({ userIds: [OWNER] });
  expect(await booked(rec.id)).toHaveLength(1);
  const after = await prisma.recurringTransaction.findUnique({ where: { id: rec.id } });
  expect(after!.nextDate).toBe(advanceDays(past, 7));
  // Run-now on it the same day finishes moving it, without booking again.
  const res = await call("POST", `/recurring/${rec.id}/run`);
  expect(res.status).toBe(200);
  expect(res.json.nextDate > today).toBe(true);
  expect(await booked(rec.id)).toHaveLength(1);
});

test("a paused series is skipped by the job but can still be run by hand", async () => {
  const rec = await series();
  await prisma.recurringTransaction.update({ where: { id: rec.id }, data: { isActive: false } });
  await processRecurring({ userIds: [OWNER] });
  expect(await booked(rec.id)).toHaveLength(0);
  expect((await call("POST", `/recurring/${rec.id}/run`)).status).toBe(201);
});

test("an occurrence is never booked onto somebody else's account", async () => {
  // The series' accountId was stored as sent; booking checks it belongs to
  // the owner and books with no account otherwise.
  const rec = await series({ accountId: OTHER_ACCOUNT });
  expect((await call("POST", `/recurring/${rec.id}/run`)).status).toBe(201);
  const [tx] = await booked(rec.id);
  expect(tx!.accountId).toBeNull();
  const theirs = await prisma.bankAccount.findUnique({ where: { id: OTHER_ACCOUNT } });
  expect(theirs!.balance).toBe(0);
});
