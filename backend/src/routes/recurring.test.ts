import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { recurringRouter } from "./recurring";
import { processRecurring } from "../jobs/recurring-processor";
import { bookOccurrence, keepsBookingState, occurrenceId, runRecurringNow } from "../jobs/recurring-booking";
import { dbToday } from "../lib/distributed/clock";
import { advanceDays, anchorDayOf, computeNextDate } from "../lib/recurrence";
import { userToday } from "../lib/user-day";

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
let seq = 0;
/** A fresh user of this file's own, for tests that need to control its accounts. */
async function makeUser(label: string): Promise<string> {
  const id = `${P}${label}_${++seq}`;
  const now = new Date();
  await prisma.user.create({ data: { id, name: id, email: `${id}@x.test`, createdAt: now, updatedAt: now } });
  return id;
}
/** An account of `userId`'s, created `ageMs` ago. */
async function makeAccount(userId: string, id: string, opts: { isDefault?: boolean; ageMs?: number; openingBalance?: number } = {}) {
  await prisma.bankAccount.create({
    data: {
      id, userId, name: id, type: "checking", isDefault: opts.isDefault ?? false, openingBalance: opts.openingBalance ?? 0,
      createdAt: new Date(Date.now() - (opts.ageMs ?? 0)),
    },
  });
  return id;
}
const balanceOf = async (id: string) => (await prisma.bankAccount.findUniqueOrThrow({ where: { id } })).balance;

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
  await prisma.syncTombstone.deleteMany({ where: { userId: { startsWith: P } } });
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

test("an edit read before the latest booking keeps the series' booking state; one that has seen it does not", () => {
  // Booked on the 10th; the edit was made on a copy from before it.
  expect(keepsBookingState("2026-10-10", null)).toBe(true);
  expect(keepsBookingState("2026-10-10", "2026-09-10")).toBe(true);
  // It has seen the booking (or a later one): its nextDate is meant.
  expect(keepsBookingState("2026-10-10", "2026-10-10")).toBe(false);
  expect(keepsBookingState("2026-10-10", "2026-11-10")).toBe(false);
  // Never booked, or the edit does not say: nothing to keep.
  expect(keepsBookingState(null, null)).toBe(false);
  expect(keepsBookingState(null, "2026-10-10")).toBe(false);
  expect(keepsBookingState("2026-10-10", undefined)).toBe(false);
});

test("a booking read before an edit landed claims nothing, so the series is booked from its new values", async () => {
  // The job reads every due series, then claims each. A sync push or a REST
  // update between the two must not leave the occurrence booked from the old
  // amount or onto the old account.
  const rec = await series({ amount: 30 });
  const read = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rec.id } });
  expect((await call("PUT", `/recurring/${rec.id}`, { amount: 45 })).status).toBe(200);

  const stale = await bookOccurrence(read, today, advanceDays(today, 30), { requireActive: true });
  expect(stale).toEqual({ claimed: false, created: false });
  expect(await booked(rec.id)).toHaveLength(0);

  expect(await processRecurring({ userIds: [OWNER] })).toBeGreaterThanOrEqual(1);
  expect((await booked(rec.id)).map((t) => t.amount)).toEqual([45]);
});

// ─── Where an occurrence lands (Phase 4 decision 5) ──────────────────────────

/** A series of `userId`'s written straight to the table, as a phone's push or old data could leave it. */
async function storedSeries(userId: string, accountId: string | null, overrides: Record<string, unknown> = {}) {
  const id = `${P}rec_${++seq}`;
  await prisma.recurringTransaction.create({
    data: {
      id, userId, accountId, name: "Rent", amount: 700, category: "Housing", type: "Expense",
      frequency: "monthly", startDate: today, nextDate: today, currency: "EUR", ...overrides,
    },
  });
  return id;
}

describe("books onto an account", () => {
  test("the job books onto the series' own account and moves that account's balance, no other", async () => {
    const user = await makeUser("own");
    const main = await makeAccount(user, `${user}_main`, { openingBalance: 1000 });
    const fallback = await makeAccount(user, `${user}_default`, { isDefault: true, ageMs: 60_000 });
    as(user);
    const res = await call("POST", "/recurring", {
      name: "Rent", amount: 700, category: "Housing", type: "Expense", frequency: "monthly",
      startDate: today, nextDate: today, accountId: main,
    });
    expect([res.status, res.json.accountId]).toEqual([201, main]);

    expect(await processRecurring({ userIds: [user] })).toBe(1);
    const [tx] = await booked(res.json.id);
    expect(tx!.accountId).toBe(main);
    expect([await balanceOf(main), await balanceOf(fallback)]).toEqual([300, 0]);
  });

  test("a series with no account books onto the user's default account, the oldest marked isDefault", async () => {
    const user = await makeUser("default");
    const plain = await makeAccount(user, `${user}_plain`, { ageMs: 120_000 });
    const older = await makeAccount(user, `${user}_d_older`, { isDefault: true, ageMs: 60_000 });
    const newer = await makeAccount(user, `${user}_d_newer`, { isDefault: true, ageMs: 1_000 });
    const rec = await storedSeries(user, null);

    as(user);
    expect((await call("POST", `/recurring/${rec}/run`)).status).toBe(201);
    const [tx] = await booked(rec);
    expect(tx!.accountId).toBe(older);
    expect([await balanceOf(older), await balanceOf(newer), await balanceOf(plain)]).toEqual([-700, 0, 0]);
  });

  test("with no account marked default the phone's acc_default_<userId> is used; with neither, no account", async () => {
    const seeded = await makeUser("seeded");
    const phoneDefault = await makeAccount(seeded, `acc_default_${seeded}`);
    await makeAccount(seeded, `${seeded}_other`, { ageMs: 60_000 });
    const a = await storedSeries(seeded, null);

    const bare = await makeUser("bare");
    await makeAccount(bare, `${bare}_only`);
    const b = await storedSeries(bare, null);

    expect(await processRecurring({ userIds: [seeded, bare] })).toBe(2);
    expect((await booked(a))[0]!.accountId).toBe(phoneDefault);
    expect(await balanceOf(phoneDefault)).toBe(-700);
    expect((await booked(b))[0]!.accountId).toBeNull();
  });

  test("a series naming another user's account books onto the owner's default, never theirs", async () => {
    // Nothing writes such a series any more (REST refuses it, a push stores
    // null, the Phase 4 migration unlinked old ones); the booking checks anyway.
    const user = await makeUser("foreign");
    const mine = await makeAccount(user, `${user}_default`, { isDefault: true });
    const theirsBefore = await balanceOf(OTHER_ACCOUNT);
    const viaJob = await storedSeries(user, OTHER_ACCOUNT);
    // Not due yet: only run-now books it.
    const viaRunNow = await storedSeries(user, OTHER_ACCOUNT, { nextDate: advanceDays(today, 5) });

    expect(await processRecurring({ userIds: [user] })).toBe(1);
    as(user);
    expect((await call("POST", `/recurring/${viaRunNow}/run`)).status).toBe(201);
    for (const rec of [viaJob, viaRunNow]) expect((await booked(rec)).map((t) => t.accountId)).toEqual([mine]);
    expect(await balanceOf(OTHER_ACCOUNT)).toBe(theirsBefore);
    expect(await balanceOf(mine)).toBe(-1400);
  });

  test("REST create and update take only the caller's own account: another's or none such is a 400, null unlinks", async () => {
    const body = {
      name: "Gym", amount: 30, category: "Gym", type: "Expense", frequency: "monthly", startDate: today, nextDate: today,
    };
    as(OWNER);
    const seriesBefore = await prisma.recurringTransaction.count({ where: { userId: OWNER } });
    for (const accountId of [OTHER_ACCOUNT, "acc_nowhere"]) {
      const refused = await call("POST", "/recurring", { ...body, accountId });
      expect([refused.status, refused.json.code]).toEqual([400, "invalid_account"]);
    }
    expect(await prisma.recurringTransaction.count({ where: { userId: OWNER } })).toBe(seriesBefore);

    const created = await call("POST", "/recurring", { ...body, accountId: OWNER_ACCOUNT });
    expect([created.status, created.json.accountId]).toEqual([201, OWNER_ACCOUNT]);
    const id = created.json.id as string;

    const foreign = await call("PUT", `/recurring/${id}`, { accountId: OTHER_ACCOUNT, name: "Hijacked" });
    expect(foreign.status).toBe(400);
    expect(await prisma.recurringTransaction.findUniqueOrThrow({ where: { id } })).toMatchObject({ accountId: OWNER_ACCOUNT, name: "Gym" });

    expect((await call("PUT", `/recurring/${id}`, { accountId: null })).json.accountId).toBeNull();
    expect((await call("PUT", `/recurring/${id}`, { accountId: OWNER_ACCOUNT })).json.accountId).toBe(OWNER_ACCOUNT);
    // A PUT that does not name the account leaves it alone.
    expect((await call("PUT", `/recurring/${id}`, { amount: 31 })).json).toMatchObject({ accountId: OWNER_ACCOUNT, amount: 31 });
    as(OTHER);
    expect((await call("PUT", `/recurring/${id}`, { accountId: OTHER_ACCOUNT })).status).toBe(404);
  });

  test("deleting the account unlinks the series (devices pull it), and its next booking lands on the default", async () => {
    const user = await makeUser("unlink");
    const card = await makeAccount(user, `${user}_card`);
    const fallback = await makeAccount(user, `${user}_default`, { isDefault: true });
    const rec = await storedSeries(user, card);
    const before = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rec } });

    await Bun.sleep(5);
    await prisma.bankAccount.delete({ where: { id: card } });
    const after = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rec } });
    expect(after.accountId).toBeNull();
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());

    as(user);
    expect((await call("POST", `/recurring/${rec}/run`)).status).toBe(201);
    expect((await booked(rec))[0]!.accountId).toBe(fallback);
    expect(await balanceOf(fallback)).toBe(-700);
  });
});

// ─── The owner's own day (Phase 5 decision 1) ────────────────────────────────

describe("user's local day", () => {
  /** 10:30 UTC on 12 October 2026: the 13th at UTC+14, the 11th at UTC-11, the 12th in UTC. */
  const AT = new Date("2026-10-12T10:30:00Z");
  const EAST = "Pacific/Kiritimati"; // UTC+14, no summer time
  const WEST = "Pacific/Pago_Pago"; // UTC-11, no summer time
  const at = (iso: string) => new Date(iso);
  const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

  /** A user whose phone reported `timezone` (stored as PUT /me/timezone stores it), or none. */
  async function zonedUser(label: string, timezone: string | null): Promise<string> {
    const id = await makeUser(label);
    if (timezone !== null) await setZone(id, timezone);
    return id;
  }
  const setZone = (id: string, timezone: string | null) => prisma.user.update({ where: { id }, data: { timezone } });
  const seriesRow = (id: string) => prisma.recurringTransaction.findUniqueOrThrow({ where: { id } });
  const bookedDates = async (id: string) => (await booked(id)).map((t) => [t.id, t.dateISO]);
  /** A series of `userId`'s due on `nextDate`, anchored there. */
  const dueOn = (userId: string, nextDate: string, frequency = "monthly", startDate = nextDate) =>
    storedSeries(userId, null, { frequency, startDate, nextDate });
  const job = (userIds: string[], now: Date) => processRecurring({ userIds, now });

  test("user's local day: run-now books on the owner's date — id, dateISO, lastCreated — and moves nextDate on from it", async () => {
    const east = await zonedUser("rn_east", EAST);
    const west = await zonedUser("rn_west", WEST);
    const e = await dueOn(east, "2026-10-13");
    const w = await dueOn(west, "2026-10-11");

    expect(await runRecurringNow(e, east, prisma, { now: AT })).toEqual({
      status: 201, transactionId: occurrenceId(e, "2026-10-13"), nextDate: "2026-11-13",
    });
    expect(await runRecurringNow(w, west, prisma, { now: AT })).toEqual({
      status: 201, transactionId: occurrenceId(w, "2026-10-11"), nextDate: "2026-11-11",
    });
    expect(await bookedDates(e)).toEqual([[occurrenceId(e, "2026-10-13"), "2026-10-13"]]);
    expect(await bookedDates(w)).toEqual([[occurrenceId(w, "2026-10-11"), "2026-10-11"]]);
    expect(await seriesRow(e)).toMatchObject({ lastCreated: "2026-10-13", nextDate: "2026-11-13" });
    expect(await seriesRow(w)).toMatchObject({ lastCreated: "2026-10-11", nextDate: "2026-11-11" });

    // The day is the owner's; the time a server write is stamped with is
    // still the database's clock (Phase 4 decision 4), not the instant asked about.
    const [tx] = await booked(e);
    for (const stamp of [tx!.clientUpdatedAt, (await seriesRow(e)).clientUpdatedAt]) {
      expect(Math.abs(stamp.getTime() - Date.now())).toBeLessThan(60_000);
    }
  });

  test("user's local day: one tick of the job books every owner by their own date", async () => {
    const east = await zonedUser("job_east", EAST);
    const west = await zonedUser("job_west", WEST);
    const utc = await zonedUser("job_utc", null);
    const due = { east: await dueOn(east, "2026-10-13"), west: await dueOn(west, "2026-10-11"), utc: await dueOn(utc, "2026-10-12") };
    // UTC's date, but not yet the 12th in Pago Pago; the 13th at UTC+14, but not yet in UTC.
    const early = { west: await dueOn(west, "2026-10-12"), utc: await dueOn(utc, "2026-10-13") };

    expect(await job([east, west, utc], AT)).toBe(3);
    expect(await bookedDates(due.east)).toEqual([[occurrenceId(due.east, "2026-10-13"), "2026-10-13"]]);
    expect(await bookedDates(due.west)).toEqual([[occurrenceId(due.west, "2026-10-11"), "2026-10-11"]]);
    expect(await bookedDates(due.utc)).toEqual([[occurrenceId(due.utc, "2026-10-12"), "2026-10-12"]]);
    expect(await booked(early.west)).toHaveLength(0);
    expect(await booked(early.utc)).toHaveLength(0);
    expect(await seriesRow(due.east)).toMatchObject({ lastCreated: "2026-10-13", nextDate: "2026-11-13" });
    expect(await seriesRow(due.west)).toMatchObject({ lastCreated: "2026-10-11", nextDate: "2026-11-11" });
  });

  test("user's local day: a series falls due just after the owner's midnight, not UTC's", async () => {
    const west = await zonedUser("mid_west", WEST);
    const east = await zonedUser("mid_east", EAST);
    const w = await dueOn(west, "2026-10-12");
    const e = await dueOn(east, "2026-10-13");

    // 23:30 on the 12th at UTC+14; 23:30 on the 11th at UTC-11.
    expect(await job([west, east], at("2026-10-12T09:30:00Z"))).toBe(0);
    // 00:30 on the 13th at UTC+14.
    expect(await job([west, east], AT)).toBe(1);
    expect(await bookedDates(e)).toEqual([[occurrenceId(e, "2026-10-13"), "2026-10-13"]]);
    // 00:30 on the 12th at UTC-11, half a day after UTC's midnight.
    expect(await job([west, east], at("2026-10-12T11:30:00Z"))).toBe(1);
    expect(await bookedDates(w)).toEqual([[occurrenceId(w, "2026-10-12"), "2026-10-12"]]);
  });

  test("user's local day: idempotent per local day — the job, run-now and both at once book it once", async () => {
    const east = await zonedUser("idem", EAST);
    const e = await dueOn(east, "2026-10-13");

    const [ticked1, ticked2, tap] = await Promise.all([
      job([east], AT),
      job([east], hoursAfter(AT, 1)),
      runRecurringNow(e, east, prisma, { now: hoursAfter(AT, 2) }),
    ]);
    expect(ticked1 + ticked2 + (tap!.status === 201 ? 1 : 0)).toBe(1);
    expect(tap!.transactionId).toBe(occurrenceId(e, "2026-10-13"));

    // 20:30 on the 13th there, though UTC's 13th has begun: still the same day.
    const evening = hoursAfter(AT, 20);
    expect(await job([east], evening)).toBe(0);
    expect(await runRecurringNow(e, east, prisma, { now: evening })).toEqual({
      status: 200, transactionId: occurrenceId(e, "2026-10-13"), nextDate: "2026-11-13",
    });
    expect(await bookedDates(e)).toEqual([[occurrenceId(e, "2026-10-13"), "2026-10-13"]]);
  });

  test("user's local day: when the owner's zone moves west after a booking, no day is booked twice", async () => {
    const user = await zonedUser("west_move", EAST);
    // Daily, and well behind: the job catches it up one step a day.
    const d = await dueOn(user, "2026-10-01", "daily");

    expect(await job([user], AT)).toBe(1);
    expect(await seriesRow(d)).toMatchObject({ lastCreated: "2026-10-13", nextDate: "2026-10-02" });

    // Now in Pago Pago, where it is the 11th, then the 12th: both before the
    // day already booked, so neither is booked.
    await setZone(user, WEST);
    expect(await job([user], AT)).toBe(0);
    const noon12 = at("2026-10-12T23:30:00Z");
    expect(await job([user], noon12)).toBe(0);
    // Run-now returns the booked occurrence and moves the series past it.
    expect(await runRecurringNow(d, user, prisma, { now: noon12 })).toEqual({
      status: 200, transactionId: occurrenceId(d, "2026-10-13"), nextDate: "2026-10-14",
    });
    // The 13th there: booked already. The 14th: a day it has not had.
    expect(await job([user], at("2026-10-13T11:30:00Z"))).toBe(0);
    expect(await job([user], at("2026-10-14T11:30:00Z"))).toBe(1);
    expect((await bookedDates(d)).map(([, date]) => date)).toEqual(["2026-10-13", "2026-10-14"]);
  });

  test("user's local day: series booked by UTC's day before the phone reported a zone are booked no day twice after it does", async () => {
    // West: booked for UTC's 12th at 01:00 UTC — the 11th in Pago Pago.
    const west = await zonedUser("switch_west", null);
    const w = await dueOn(west, "2026-10-12", "daily", "2026-10-01");
    expect(await job([west], at("2026-10-12T01:00:00Z"))).toBe(1);
    await setZone(west, WEST);
    expect(await job([west], at("2026-10-12T01:30:00Z"))).toBe(0);
    expect(await runRecurringNow(w, west, prisma, { now: at("2026-10-12T01:30:00Z") })).toEqual({
      status: 200, transactionId: occurrenceId(w, "2026-10-12"), nextDate: "2026-10-13",
    });
    expect(await job([west], at("2026-10-12T11:30:00Z"))).toBe(0); // the 12th there: had it
    expect(await job([west], at("2026-10-13T11:30:00Z"))).toBe(1); // the 13th there
    expect((await bookedDates(w)).map(([, date]) => date)).toEqual(["2026-10-12", "2026-10-13"]);

    // East: booked for UTC's 12th; the phone then reports UTC+14, where the
    // 12th runs on to 10:00 UTC and the 13th follows — a day of its own.
    const east = await zonedUser("switch_east", null);
    const e = await dueOn(east, "2026-10-12", "daily", "2026-10-01");
    expect(await job([east], at("2026-10-12T01:00:00Z"))).toBe(1);
    await setZone(east, EAST);
    expect(await job([east], at("2026-10-12T01:30:00Z"))).toBe(0);
    expect(await job([east], AT)).toBe(1);
    expect(await job([east], hoursAfter(AT, 5))).toBe(0);
    expect((await bookedDates(e)).map(([, date]) => date)).toEqual(["2026-10-12", "2026-10-13"]);
  });

  test("user's local day: without a zone, or with one this runtime does not know, the day is UTC's as before", async () => {
    const none = await zonedUser("utc_none", null);
    const junk = await zonedUser("utc_junk", "Mars/Olympus_Mons");
    const a = await dueOn(none, "2026-10-12");
    const b = await dueOn(junk, "2026-10-12");
    expect(await runRecurringNow(a, none, prisma, { now: AT })).toMatchObject({ status: 201, transactionId: occurrenceId(a, "2026-10-12") });
    expect(await job([junk], AT)).toBe(1);
    expect(await bookedDates(b)).toEqual([[occurrenceId(b, "2026-10-12"), "2026-10-12"]]);
    expect(await job([none, junk], hoursAfter(AT, 13))).toBe(0); // 23:30 UTC: still the 12th
  });

  test("user's local day: run-now through the API books by the zone the user's phone reported", async () => {
    const user = await zonedUser("api", EAST);
    const before = userToday(EAST, new Date());
    as(user);
    const created = await call("POST", "/recurring", {
      name: "Rent", amount: 10, category: "Other", type: "Expense", frequency: "monthly", startDate: before, nextDate: before,
    });
    expect(created.status).toBe(201);
    const res = await call("POST", `/recurring/${created.json.id}/run`);
    const after = userToday(EAST, new Date());
    expect(res.status).toBe(201);
    // Across the owner's midnight between the two reads, either date is theirs.
    const day = [before, after].find((d) => res.json.transactionId === occurrenceId(created.json.id, d));
    expect(day).toBeDefined();
    expect(await bookedDates(created.json.id)).toEqual([[res.json.transactionId, day]]);
  });
});
