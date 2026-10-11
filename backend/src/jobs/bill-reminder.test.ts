import { test, expect, afterAll } from "bun:test";
import { prisma } from "../prisma";
import {
  billReminderDeps,
  advanceMonth,
  shouldNotify,
  rearmsNotifier,
  checkBillReminders,
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
 */
function fakeDeps(bills: DueBill[]) {
  const sends: Array<{ userId: string; body: string }> = [];
  const deps: BillReminderDeps = {
    async findDueBills(today, startOfToday) {
      return bills.filter(
        (b) =>
          b.nextDueDate <= today &&
          (b.lastNotifiedAt === null ||
            b.lastNotifiedAt.getTime() < startOfToday.getTime())
      );
    },
    async currencySymbols(userIds) {
      return new Map(userIds.map((id) => [id, "€"]));
    },
    async sendPush(userId, _title, body) {
      sends.push({ userId, body });
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

  expect(sends[0]!.body).toContain("€42");
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

// ── The real claim, against Postgres ─────────────────────────────────────────

const U = `billtest_${process.pid}${Date.now().toString(36)}`;
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: U } });
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
