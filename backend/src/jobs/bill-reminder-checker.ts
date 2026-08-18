import { prisma } from "../prisma";
import { sendPushToUser } from "../lib/expo-push";

export function advanceMonth(dateStr: string, dueDay: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  // Compute the target year/month directly. Using setUTCMonth(+1) on a 31st
  // would overflow a short month (Jan 31 → "Feb 31" → Mar 3) and skip the
  // month entirely, so we never mutate the day before clamping.
  const nextMonthIndex = d.getUTCMonth() + 1;
  const targetYear = d.getUTCFullYear() + Math.floor(nextMonthIndex / 12);
  const targetMonth = nextMonthIndex % 12;
  // Clamp dueDay to the last day of the target month (e.g., 31 → 28 for Feb).
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().split("T")[0]!;
}

/** Midnight UTC of a YYYY-MM-DD date string. */
export function startOfDayUTC(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

/**
 * A bill fires at most once per due date.
 *
 * `lastNotifiedAt` is compared against the start of the bill's *current*
 * `nextDueDate`: a recurring bill re-arms the moment that date advances, while
 * a non-recurring bill — whose date never moves — never fires twice. Without
 * this the 5-minute checker re-sent every unpaid one-off bill on every tick.
 */
export function shouldNotify(
  lastNotifiedAt: Date | null,
  nextDueDate: string
): boolean {
  if (!lastNotifiedAt) return true;
  return lastNotifiedAt.getTime() < startOfDayUTC(nextDueDate).getTime();
}

export interface DueBill {
  id: string;
  userId: string;
  name: string;
  amount: number;
  dueDay: number;
  isRecurring: boolean;
  nextDueDate: string;
  lastNotifiedAt: Date | null;
}

export interface BillReminderDeps {
  findDueBills(today: string, startOfToday: Date): Promise<DueBill[]>;
  currencySymbols(userIds: string[]): Promise<Map<string, string>>;
  sendPush(
    userId: string,
    title: string,
    body: string,
    data: Record<string, unknown>
  ): Promise<void>;
  markNotified(
    id: string,
    notifiedAt: Date,
    nextDueDate: string
  ): Promise<void>;
}

const prismaDeps: BillReminderDeps = {
  findDueBills: (today, startOfToday) =>
    prisma.billReminder.findMany({
      where: {
        isPaid: false,
        nextDueDate: { lte: today },
        // Coarse pre-filter only. Because nextDueDate <= today, anything
        // notified at or after midnight today has necessarily already fired
        // for its current due date, so excluding it here can never drop a
        // bill that shouldNotify() would have approved. The exact per-due-date
        // check still runs in JS below.
        OR: [
          { lastNotifiedAt: null },
          { lastNotifiedAt: { lt: startOfToday } },
        ],
      },
    }),

  async currencySymbols(userIds) {
    if (userIds.length === 0) return new Map();
    const rows = await prisma.userSettings.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, currencySymbol: true },
    });
    return new Map(rows.map((r) => [r.userId, r.currencySymbol]));
  },

  sendPush: (userId, title, body, data) =>
    sendPushToUser(userId, title, body, data),

  async markNotified(id, notifiedAt, nextDueDate) {
    await prisma.billReminder.update({
      where: { id },
      data: { lastNotifiedAt: notifiedAt, nextDueDate, isPaid: false },
    });
  },
};

export async function checkBillReminders(
  deps: BillReminderDeps = prismaDeps
): Promise<void> {
  const now = new Date();
  const today = now.toISOString().split("T")[0]!;
  const startOfToday = startOfDayUTC(today);

  const candidates = await deps.findDueBills(today, startOfToday);
  const due = candidates.filter((b) => shouldNotify(b.lastNotifiedAt, b.nextDueDate));
  if (due.length === 0) return;

  const symbols = await deps.currencySymbols([...new Set(due.map((b) => b.userId))]);

  for (const bill of due) {
    const symbol = symbols.get(bill.userId) ?? "$";
    console.log(
      `[bill-reminder] Due: "${bill.name}" — ${symbol}${bill.amount} (user: ${bill.userId})`
    );

    // Deliver a push to all of the user's registered devices (best-effort).
    await deps.sendPush(
      bill.userId,
      "Bill due 💸",
      `"${bill.name}" — ${symbol}${bill.amount} is due today.`,
      { type: "bill-reminder", billId: bill.id }
    );

    // Recurring bills roll forward to next month; one-off bills keep their due
    // date. Either way lastNotifiedAt is stamped so this due date is spent.
    const nextDueDate = bill.isRecurring
      ? advanceMonth(bill.nextDueDate, bill.dueDay)
      : bill.nextDueDate;
    await deps.markNotified(bill.id, now, nextDueDate);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startBillReminderChecker(intervalMs = 5 * 60_000) {
  // Run immediately
  checkBillReminders().catch((e) =>
    console.error("[bill-reminder] Initial run failed:", e)
  );

  // Then repeat on interval
  intervalHandle = setInterval(() => {
    checkBillReminders().catch((e) =>
      console.error("[bill-reminder] Scheduled run failed:", e)
    );
  }, intervalMs);
  intervalHandle.unref();
}

export function stopBillReminderChecker() {
  if (intervalHandle) clearInterval(intervalHandle);
}
