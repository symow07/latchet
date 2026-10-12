import { test, expect, afterAll } from "bun:test";
import { prisma } from "../prisma";
import {
  billReminderDeps,
  advanceMonth,
  shouldNotify,
  rearmsNotifier,
  checkBillReminders,
  BILL_PUSH_FROM_HOUR,
  nextDueAfter,
  type BillRecipient,
  type BillReminderDeps,
  type DueBill,
} from "./bill-reminder-checker";

test("advanceMonth moves a recurring bill to the next month", () => {
  expect(advanceMonth("2026-01-15", 15)).toBe("2026-02-15");
});

test("advanceMonth clamps the due day to the last day of a short month", () => {
  // Jan 31 → Feb (2026 is not a leap year) clamps to the 28th.
  expect(advanceMonth("2026-01-31", 31)).toBe("2026-02-28");
});

test("advanceMonth rolls over the year in December", () => {
  expect(advanceMonth("2026-12-10", 10)).toBe("2027-01-10");
});

test("shouldNotify fires when a bill has never been notified", () => {
  expect(shouldNotify(null, "2026-08-18")).toBe(true);
});

test("shouldNotify does not re-fire for a due date already notified", () => {
  expect(shouldNotify(new Date("2026-08-18T09:00:00Z"), "2026-08-18")).toBe(false);
});

test("shouldNotify re-arms once the due date advances past the last send", () => {
  expect(shouldNotify(new Date("2026-08-18T09:00:00Z"), "2026-09-18")).toBe(true);
});

test("an edit re-arms the notifier only when it moves the due date later", () => {
  expect(rearmsNotifier("2026-08-18", "2026-09-18")).toBe(true);
  expect(rearmsNotifier("2026-08-18", "2026-08-19")).toBe(true);
  // Saved again unchanged (a rename, marked unpaid), moved back, or not sent.
  expect(rearmsNotifier("2026-08-18", "2026-08-18")).toBe(false);
  expect(rearmsNotifier("2026-08-18", "2026-08-01")).toBe(false);
  expect(rearmsNotifier("2026-08-18", undefined)).toBe(false);
  // Across a year boundary, string order is still date order.
  expect(rearmsNotifier("2026-12-31", "2027-01-01")).toBe(true);
});

/**
 * In-memory stand-in for the Prisma-backed deps, mirroring the same coarse
 * pre-filter the real query applies so the test exercises the real path.
 * Every owner pays in euros and has no time zone (UTC) unless `owners` says
 * otherwise.
 */
function fakeDeps(bills: DueBill[], owners: Record<string, Partial<BillRecipient>> = {}) {
  const sends: Array<{ userId: string; title: string; body: string }> = [];
  const deps: BillReminderDeps = {
    async findDueBills(latest, earliestStart) {
      return bills.filter(
        (b) =>
          b.nextDueDate <= latest &&
          (b.lastNotifiedAt === null ||
            b.lastNotifiedAt.getTime() < earliestStart.getTime())
      );
    },
    async recipients(userIds) {
      return new Map(
        userIds.map((id) => [id, { timeZone: null, locale: null, currency: "EUR", currencySymbol: "€", ...owners[id] }])
      );
    },
    async sendPush(userId, title, body) {
      sends.push({ userId, title, body });
    },
    async claimNotification(read, notifiedAt, nextDueDate) {
      // The real one is a conditional update: it only applies while the row
      // still holds what this run read.
      const bill = bills.find((b) => b.id === read.id)!;
      if (
        bill.nextDueDate !== read.nextDueDate ||
        bill.lastNotifiedAt?.getTime() !== read.lastNotifiedAt?.getTime()
      ) {
        return false;
      }
      bill.lastNotifiedAt = notifiedAt;
      bill.nextDueDate = nextDueDate;
      return true;
    },
  };
  return { deps, sends };
}

function bill(overrides: Partial<DueBill> = {}): DueBill {
  const today = new Date().toISOString().split("T")[0]!;
  return {
    id: "bill_1",
    userId: "user_1",
    name: "Rent",
    amount: 1200,
    dueDay: Number(today.slice(8, 10)),
    isRecurring: false,
    nextDueDate: today,
    lastNotifiedAt: null,
    ...overrides,
  };
}

test("a non-recurring bill due today notifies exactly once across two runs", async () => {
  const { deps, sends } = fakeDeps([bill()]);

  await checkBillReminders(deps);
  await checkBillReminders(deps);

  expect(sends.length).toBe(1);
});

test("an overdue non-recurring bill notifies once, not once per tick", async () => {
  const { deps, sends } = fakeDeps([bill({ nextDueDate: "2026-01-05", dueDay: 5 })]);

  await checkBillReminders(deps);
  await checkBillReminders(deps);
  await checkBillReminders(deps);

  expect(sends.length).toBe(1);
});

test("a recurring bill advances its due date and does not re-fire same-day", async () => {
  const bills = [bill({ isRecurring: true })];
  const { deps, sends } = fakeDeps(bills);

  await checkBillReminders(deps);
  await checkBillReminders(deps);

  expect(sends.length).toBe(1);
  // Rolled forward to next month rather than staying due.
  expect(bills[0]!.nextDueDate > new Date().toISOString().split("T")[0]!).toBe(true);
});

test("the push body uses the user's currency symbol, not a hardcoded $", async () => {
  const { deps, sends } = fakeDeps([bill({ amount: 42 })]);

  await checkBillReminders(deps);

  expect(sends[0]!.body).toContain("€42.00");
  expect(sends[0]!.body).not.toContain("$");
});

test("two runs that read the same bill send it once", async () => {
  // Two instances' ticks overlapping: both find the bill due, only the one
  // whose claim lands sends the push.
  const bills = [bill()];
  const { deps, sends } = fakeDeps(bills);
  const stale = { ...bills[0]! };
  await Promise.all([
    checkBillReminders(deps),
    checkBillReminders({ ...deps, findDueBills: async () => [stale] }),
  ]);
  expect(sends.length).toBe(1);
});

// ── The owner's own day (Phase 5 decision 1) ────────────────────────────────

/** 10:30 UTC on 12 October: already the 13th at UTC+14 (00:30), still the 11th at UTC-11 (23:30). */
const AT = new Date("2026-10-12T10:30:00Z");
/** 19:30 UTC on 12 October: 09:30 on the 13th at UTC+14, 08:30 on the 12th at UTC-11. */
const EVENING = new Date("2026-10-12T19:30:00Z");
const KIRITIMATI = "Pacific/Kiritimati"; // UTC+14, no summer time
const PAGO_PAGO = "Pacific/Pago_Pago"; // UTC-11, no summer time
const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

test("the push hour is the morning", () => {
  expect(BILL_PUSH_FROM_HOUR).toBe(9);
});

test("bill local day: a bill due on the 13th fires on the morning of the 13th where its owner is, while UTC is still the 12th", async () => {
  const bills = [
    bill({ id: "east", userId: "east", nextDueDate: "2026-10-13", dueDay: 13 }),
    bill({ id: "utc", userId: "utc", nextDueDate: "2026-10-13", dueDay: 13 }),
  ];
  const { deps, sends } = fakeDeps(bills, { east: { timeZone: KIRITIMATI } });

  // Half past midnight on the 13th at UTC+14: the day has begun, the push hour has not.
  await checkBillReminders(deps, { now: AT });
  expect(sends).toHaveLength(0);

  // Half past nine there; UTC is still on the 12th.
  await checkBillReminders(deps, { now: EVENING });
  expect(sends.map((s) => s.userId)).toEqual(["east"]);
  expect(sends[0]!.body).toContain("is due today");
  expect(bills.map((b) => b.lastNotifiedAt)).toEqual([EVENING, null]);

  // The owner with no zone gets theirs at UTC's midnight, as every owner did before.
  await checkBillReminders(deps, { now: new Date("2026-10-13T00:05:00Z") });
  expect(sends.map((s) => s.userId)).toEqual(["east", "utc"]);
});

test("bill local day: west of UTC a bill waits for the owner's own due day, then fires once", async () => {
  const bills = [bill({ id: "west", userId: "west", nextDueDate: "2026-10-12", dueDay: 12, isRecurring: true })];
  const { deps, sends } = fakeDeps(bills, { west: { timeZone: PAGO_PAGO } });

  // UTC's 12th, but the 11th in Pago Pago; then the 12th there, before nine.
  await checkBillReminders(deps, { now: AT });
  await checkBillReminders(deps, { now: EVENING });
  expect(sends).toHaveLength(0);

  // Half past nine on the 12th there: fires, and moves on a month.
  await checkBillReminders(deps, { now: hoursAfter(EVENING, 1) });
  await checkBillReminders(deps, { now: hoursAfter(EVENING, 10) });
  expect(sends.map((s) => s.userId)).toEqual(["west"]);
  expect(bills[0]!.nextDueDate).toBe("2026-11-12");

  // And next month, again by the owner's day rather than UTC's.
  await checkBillReminders(deps, { now: new Date("2026-11-12T19:30:00Z") });
  expect(sends).toHaveLength(1);
  await checkBillReminders(deps, { now: new Date("2026-11-12T20:30:00Z") });
  expect(sends).toHaveLength(2);
});

test("bill local day: a one-off bill sent in one zone is not sent again when its owner moves west", async () => {
  const bills = [bill({ id: "trip", userId: "trip", nextDueDate: "2026-10-13", dueDay: 13 })];
  const owners: Record<string, Partial<BillRecipient>> = { trip: { timeZone: KIRITIMATI } };
  const { deps, sends } = fakeDeps(bills, owners);

  await checkBillReminders(deps, { now: EVENING });
  expect(sends).toHaveLength(1);

  // The phone now reports a zone where the 13th starts a day later.
  owners.trip!.timeZone = PAGO_PAGO;
  for (const h of [1, 13, 25, 49]) await checkBillReminders(deps, { now: hoursAfter(EVENING, h) });
  owners.trip!.timeZone = null;
  await checkBillReminders(deps, { now: hoursAfter(EVENING, 30) });
  expect(sends).toHaveLength(1);
});

test("bill local day: an overdue bill goes at once, without waiting for the push hour", async () => {
  const { deps, sends } = fakeDeps(
    [bill({ id: "late", userId: "late", nextDueDate: "2026-10-12", dueDay: 12 })],
    { late: { timeZone: KIRITIMATI } }
  );
  // 00:30 on the 13th at UTC+14: the 12th is past.
  await checkBillReminders(deps, { now: AT });
  expect(sends.map((s) => s.body)).toEqual(['"Rent" — €1,200.00 is overdue.']);
});

test("a notified recurring bill moves a month on, or past the owner's today when it was first noticed months late", () => {
  expect(nextDueAfter("2026-10-12", 12, "2026-10-12")).toBe("2026-11-12");
  expect(nextDueAfter("2026-10-10", 10, "2026-10-12")).toBe("2026-11-10");
  expect(nextDueAfter("2026-07-31", 31, "2026-10-12")).toBe("2026-10-31");
  expect(nextDueAfter("2026-07-31", 31, "2026-10-31")).toBe("2026-11-30");
});

test("bill local day: a recurring bill first noticed months late is pushed once as overdue, then again on its next due day", async () => {
  const bills = [bill({ id: "old", userId: "old", nextDueDate: "2026-07-20", dueDay: 20, isRecurring: true })];
  const { deps, sends } = fakeDeps(bills, { old: { timeZone: KIRITIMATI } });

  // Through the 19th there: once.
  for (const h of [0, 1, 24, 24 * 6]) await checkBillReminders(deps, { now: hoursAfter(EVENING, h) });
  expect(sends.map((s) => s.body)).toEqual(['"Rent" — €1,200.00 is overdue.']);
  expect(bills[0]!.nextDueDate).toBe("2026-10-20");

  // 09:30 on the 20th at UTC+14.
  await checkBillReminders(deps, { now: new Date("2026-10-19T19:30:00Z") });
  expect(sends.map((s) => s.body)).toEqual(['"Rent" — €1,200.00 is overdue.', '"Rent" — €1,200.00 is due today.']);
  expect(bills[0]!.nextDueDate).toBe("2026-11-20");
});

test("bill local day: an owner with no time zone, or one this runtime does not know, is notified by UTC's day from its midnight", async () => {
  const bills = [
    bill({ id: "none", userId: "none", nextDueDate: "2026-10-12", dueDay: 12 }),
    bill({ id: "junk", userId: "junk", nextDueDate: "2026-10-12", dueDay: 12 }),
    bill({ id: "tomorrow", userId: "none", nextDueDate: "2026-10-13", dueDay: 13 }),
  ];
  const { deps, sends } = fakeDeps(bills, { junk: { timeZone: "Mars/Olympus_Mons" } });
  await checkBillReminders(deps, { now: new Date("2026-10-12T00:05:00Z") });
  expect(sends.map((s) => s.userId).sort()).toEqual(["junk", "none"]);
  expect(sends.map((s) => s.body)).toEqual(['"Rent" — €1,200.00 is due today.', '"Rent" — €1,200.00 is due today.']);
});

test("bill local day: a push counts as sent for its due date from the first moment that date begins anywhere", () => {
  // The 18th begins at 10:00 UTC on the 17th at UTC+14.
  expect(shouldNotify(new Date("2026-08-17T10:00:00Z"), "2026-08-18")).toBe(false);
  expect(shouldNotify(new Date("2026-08-17T09:59:59Z"), "2026-08-18")).toBe(true);
});

test("bill push language: the checker writes each owner's push in their own language and currency", async () => {
  const bills = [
    bill({ id: "fr", userId: "fr", amount: 1200, nextDueDate: "2026-10-12", dueDay: 12 }),
    bill({ id: "zh", userId: "zh", amount: 88, nextDueDate: "2026-10-12", dueDay: 12 }),
    bill({ id: "de", userId: "de", amount: 15, nextDueDate: "2026-10-12", dueDay: 12 }),
  ];
  const { deps, sends } = fakeDeps(bills, {
    fr: { locale: "fr" },
    zh: { locale: "zh", currency: "CNY", currencySymbol: "¥" },
    de: { locale: "de", currency: "USD", currencySymbol: "$" },
  });
  await checkBillReminders(deps, { now: AT });
  const byUser = Object.fromEntries(sends.map((s) => [s.userId, [s.title, s.body]]));
  expect(byUser).toEqual({
    fr: ["Facture à régler 💸", "«\u00a0Rent\u00a0» — 1\u202f200,00\u00a0€ à régler aujourd’hui."],
    zh: ["账单到期 💸", "“Rent”（¥88.00）今天到期。"],
    // A language the app does not ship: English.
    de: ["Bill due 💸", '"Rent" — $15.00 is due today.'],
  });
});

// ── The real claim, against Postgres ─────────────────────────────────────────

const U = `billtest_${process.pid}${Date.now().toString(36)}`;
const FAR_EAST = `${U}_east`;
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [U, FAR_EAST] } } });
});

test("two instances checking at once notify a due bill once, through the real claim", async () => {
  const today = new Date().toISOString().split("T")[0]!;
  const now = new Date();
  await prisma.user.create({ data: { id: U, name: U, email: `${U}@x.test`, createdAt: now, updatedAt: now } });
  await prisma.billReminder.create({
    data: { id: `${U}_rent`, userId: U, name: "Rent", amount: 900, dueDay: Number(today.slice(8, 10)),
            isRecurring: true, nextDueDate: today },
  });

  const sends: string[] = [];
  // The real deps, scoped to this test's user: the database is shared.
  const deps: BillReminderDeps = {
    ...billReminderDeps,
    findDueBills: async (t, s) => (await billReminderDeps.findDueBills(t, s)).filter((b) => b.userId === U),
    sendPush: async (userId) => {
      sends.push(userId);
    },
  };
  await Promise.all([checkBillReminders(deps), checkBillReminders(deps), checkBillReminders(deps)]);

  expect(sends).toEqual([U]);
  const after = await prisma.billReminder.findUnique({ where: { id: `${U}_rent` } });
  expect(after!.nextDueDate > today).toBe(true);
  expect(after!.lastNotifiedAt).not.toBeNull();
  // The claim is a server write to a synced row: stamped by the database
  // clock, so it beats a phone copy edited before it (Phase 4 decision 4).
  expect(after!.clientUpdatedAt.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1_000);
  expect(after!.clientUpdatedAt.getTime()).toBeLessThanOrEqual(after!.serverUpdatedAt.getTime());
});

test("bill local day: the real deps read the owner's zone, language and currency, and the real claim keeps it to one push", async () => {
  const now = new Date();
  await prisma.user.create({
    data: { id: FAR_EAST, name: FAR_EAST, email: `${FAR_EAST}@x.test`, timezone: KIRITIMATI, createdAt: now, updatedAt: now },
  });
  await prisma.userSettings.create({
    data: { id: `${FAR_EAST}_settings`, userId: FAR_EAST, locale: "fr", currency: "EUR", currencySymbol: "€" },
  });
  // Due on the 13th: UTC+14's date from AT on, UTC's only from the next midnight.
  await prisma.billReminder.create({
    data: { id: `${FAR_EAST}_power`, userId: FAR_EAST, name: "Électricité", amount: 64.5, dueDay: 13,
            isRecurring: false, nextDueDate: "2026-10-13" },
  });

  const sends: Array<{ title: string; body: string }> = [];
  const deps: BillReminderDeps = {
    ...billReminderDeps,
    findDueBills: async (t, s) => (await billReminderDeps.findDueBills(t, s)).filter((b) => b.userId === FAR_EAST),
    sendPush: async (_userId, title, body) => {
      sends.push({ title, body });
    },
  };
  // Just after the owner's midnight: their day, not yet their push hour.
  await checkBillReminders(deps, { now: AT });
  expect(sends).toHaveLength(0);
  // Their morning (UTC's evening of the 12th), from two instances at once.
  await Promise.all([checkBillReminders(deps, { now: EVENING }), checkBillReminders(deps, { now: EVENING })]);
  // Later the same day, and UTC's 13th: spent.
  await checkBillReminders(deps, { now: hoursAfter(EVENING, 6) });
  await checkBillReminders(deps, { now: hoursAfter(EVENING, 20) });

  expect(sends).toEqual([{ title: "Facture à régler 💸", body: "«\u00a0Électricité\u00a0» — 64,50\u00a0€ à régler aujourd’hui." }]);
  const after = await prisma.billReminder.findUniqueOrThrow({ where: { id: `${FAR_EAST}_power` } });
  expect(after.lastNotifiedAt).toEqual(EVENING);
  expect(after.nextDueDate).toBe("2026-10-13");
});
