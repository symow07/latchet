import { prisma } from "../prisma";
import { sendPushToUser } from "../lib/expo-push";
import { advanceMonth } from "../lib/recurrence";
import { withJobLease } from "../lib/distributed/lease";
import { dbNow } from "../lib/distributed/clock";

export { advanceMonth };

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

/**
 * Whether a user's edit re-arms the notifier (clears lastNotifiedAt): only
 * when it moves the bill to a later due date. Moving it back to a date it
 * already fired for, or saving the same date again (marking it unpaid, a
 * rename), must not fire it a second time. lastNotifiedAt is the server's
 * own and never on the sync wire, so this is decided here for every write:
 * PUT /bill-reminders and a sync push (lib/sync/push.ts, the same comparison
 * in SQL). Dates are YYYY-MM-DD, so string order is date order.
 */
export function rearmsNotifier(storedNextDueDate: string, newNextDueDate: string | undefined): boolean {
  return newNextDueDate !== undefined && newNextDueDate > storedNextDueDate;
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
  /**
   * Claim the bill's current due date: record the notification and move a
   * recurring bill on, but only if the row still has the lastNotifiedAt and
   * nextDueDate this run read. True when this run made the change and should
   * send the push; false when another run (another instance) got there first.
   *
   * A server write to a synced row: it stamps clientUpdatedAt from the
   * database clock (Phase 4 decision 4), so a phone's copy edited before it
   * loses, and every phone pulls the moved bill.
   */
  claimNotification(
    bill: DueBill,
    notifiedAt: Date,
    nextDueDate: string
  ): Promise<boolean>;
}

/** The real deps, on the app's database. */
export const billReminderDeps: BillReminderDeps = {
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

  async claimNotification(bill, notifiedAt, nextDueDate) {
    const { count } = await prisma.billReminder.updateMany({
      where: {
        id: bill.id,
        isPaid: false,
        nextDueDate: bill.nextDueDate,
        lastNotifiedAt: bill.lastNotifiedAt,
      },
      data: { lastNotifiedAt: notifiedAt, nextDueDate, isPaid: false, clientUpdatedAt: await dbNow() },
    });
    return count === 1;
  },
};

export async function checkBillReminders(
  deps: BillReminderDeps = billReminderDeps
): Promise<void> {
  const now = new Date();
  const today = now.toISOString().split("T")[0]!;
  const startOfToday = startOfDayUTC(today);

  const candidates = await deps.findDueBills(today, startOfToday);
  const due = candidates.filter((b) => shouldNotify(b.lastNotifiedAt, b.nextDueDate));
  if (due.length === 0) return;

  const symbols = await deps.currencySymbols([...new Set(due.map((b) => b.userId))]);

  for (const bill of due) {
    // Recurring bills roll forward to next month; one-off bills keep their due
    // date. Either way lastNotifiedAt is stamped so this due date is spent.
    // Claimed before sending, so two instances never both send it: of two
    // runs that read the same row, only one's conditional update matches.
    const nextDueDate = bill.isRecurring
      ? advanceMonth(bill.nextDueDate, bill.dueDay)
      : bill.nextDueDate;
    if (!(await deps.claimNotification(bill, now, nextDueDate))) continue;

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
  }
}

/** The lease every instance's tick competes for (lib/distributed/lease). */
export const BILL_REMINDER_LEASE = "bill-reminder-checker";
/** Held this long at a time, renewed while a tick runs. */
const LEASE_TTL_MS = 5 * 60_000;

/** One tick: run under the lease, or skip when another instance holds it. */
export function runBillReminderTick(deps: BillReminderDeps = billReminderDeps) {
  return withJobLease(BILL_REMINDER_LEASE, LEASE_TTL_MS, () => checkBillReminders(deps));
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startBillReminderChecker(intervalMs = 5 * 60_000) {
  const tick = () =>
    runBillReminderTick().catch((e) => console.error("[bill-reminder] Run failed:", e));

  // Run immediately, then repeat on interval.
  tick();
  intervalHandle = setInterval(tick, intervalMs);
  intervalHandle.unref();
}

export function stopBillReminderChecker() {
  if (intervalHandle) clearInterval(intervalHandle);
}
