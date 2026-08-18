import { test, expect } from "bun:test";
import {
  advanceMonth,
  shouldNotify,
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
    async markNotified(id, notifiedAt, nextDueDate) {
      const bill = bills.find((b) => b.id === id)!;
      bill.lastNotifiedAt = notifiedAt;
      bill.nextDueDate = nextDueDate;
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
