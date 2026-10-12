import { prisma } from "../prisma";
import { sendPushToUser } from "../lib/expo-push";
import { advanceMonth } from "../lib/recurrence";
import { withJobLease } from "../lib/distributed/lease";
import { dbNow } from "../lib/distributed/clock";
import { canonicalTimeZone, earliestStartOf, latestToday, userToday } from "../lib/user-day";
import { billDueNotification } from "../lib/bill-notify";

export { advanceMonth };

/**
 * A bill fires at most once per due date, on the day it is due where its
 * owner is (Phase 5 decision 1): the date in the time zone their phone
 * reported, UTC's until it has.
 *
 * `lastNotifiedAt` is compared against the first instant the bill's *current*
 * `nextDueDate` began anywhere (UTC+14, lib/user-day.ts): a recurring bill
 * re-arms the moment that date advances, while a non-recurring bill — whose
 * date never moves — never fires twice. Without this the 5-minute checker
 * re-sent every unpaid one-off bill on every tick.
 *
 * Anywhere, not in the owner's zone: a bill fires once its date has begun
 * where the owner is, which is never before it began at UTC+14, so a push for
 * this due date always counts as sent for it — even after the owner's zone
 * moves west, where the date begins later (comparing against midnight UTC,
 * or the new zone's midnight, would send it again). A push for an earlier
 * due date was sent at least a month before this one began anywhere.
 */
export function shouldNotify(
  lastNotifiedAt: Date | null,
  nextDueDate: string
): boolean {
  if (!lastNotifiedAt) return true;
  return lastNotifiedAt.getTime() < earliestStartOf(nextDueDate).getTime();
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

/**
 * A recurring bill's next due date once `dueDate` has been notified: a month
 * on, or as many months as it takes to pass `today` (the owner's), for a bill
 * first noticed more than a month late. Moved one month only, such a bill's
 * next date was already past and already older than the push just sent, so
 * shouldNotify never approved it again and the bill fell silent for good.
 */
export function nextDueAfter(dueDate: string, dueDay: number, today: string): string {
  let next = advanceMonth(dueDate, dueDay);
  // advanceMonth always moves a month on; the bound only guards bad data.
  for (let i = 0; next <= today && i < 1200; i++) next = advanceMonth(next, dueDay);
  return next;
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

/** What the push needs to know about a bill's owner. */
export interface BillRecipient {
  /** User.timezone: their today is the date there (null: UTC). */
  timeZone: string | null;
  /** UserSettings.locale: the push's language (anything but en/fr/zh/ar: English). */
  locale: string | null;
  /** UserSettings.currency, an ISO code. */
  currency: string | null;
  /** UserSettings.currencySymbol. */
  currencySymbol: string | null;
}

export interface BillReminderDeps {
  /**
   * Unpaid bills that may be due: due on or before `latestToday` (the latest
   * date it is anywhere, so on or before every owner's today), and not
   * notified since `earliestStart` (the first instant that date began
   * anywhere). A coarse cut — the exact one is per owner, in
   * checkBillReminders — that never drops a bill it would notify: such a
   * bill is due by its owner's today, so by latestToday, and its last push
   * (shouldNotify) is older than the start of its due date, so older than
   * the start of latestToday.
   */
  findDueBills(latestToday: string, earliestStart: Date): Promise<DueBill[]>;
  /** The owners of `userIds`; one with no row (or no settings) gets the defaults. */
  recipients(userIds: string[]): Promise<Map<string, BillRecipient>>;
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
  findDueBills: (latest, earliestStart) =>
    prisma.billReminder.findMany({
      where: {
        isPaid: false,
        nextDueDate: { lte: latest },
        OR: [
          { lastNotifiedAt: null },
          { lastNotifiedAt: { lt: earliestStart } },
        ],
      },
      orderBy: { id: "asc" },
    }),

  async recipients(userIds) {
    if (userIds.length === 0) return new Map();
    const rows = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        timezone: true,
        settings: { select: { locale: true, currency: true, currencySymbol: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          timeZone: r.timezone,
          locale: r.settings?.locale ?? null,
          currency: r.settings?.currency ?? null,
          currencySymbol: r.settings?.currencySymbol ?? null,
        },
      ])
    );
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

/**
 * The hour of its due day, where the owner is, from which a bill's push goes
 * out: a reminder to read over breakfast, not a buzz at midnight, which is
 * when their local day begins. A bill already past its due day goes at once.
 * Measured as this many hours after the owner's midnight, so on the two days
 * a year their clocks change it goes an hour early or late.
 *
 * Only for an owner whose zone is known. With none, nothing says when their
 * morning is, and the bill fires from midnight UTC on its due date, as every
 * bill did before phones reported a zone.
 */
export const BILL_PUSH_FROM_HOUR = 9;

/**
 * Notify every unpaid bill that is due by its owner's own day, once per due
 * date, in the owner's language and currency. `opts.now` names the instant
 * (tests); otherwise it is this instance's clock — the claim, not the clock,
 * is what keeps two instances from both sending one bill.
 */
export async function checkBillReminders(
  deps: BillReminderDeps = billReminderDeps,
  opts: { now?: Date } = {}
): Promise<void> {
  const now = opts.now ?? new Date();
  const latest = latestToday(now);

  const candidates = await deps.findDueBills(latest, earliestStartOf(latest));
  if (candidates.length === 0) return;
  const recipients = await deps.recipients([...new Set(candidates.map((b) => b.userId))]);

  // Each owner's dates, read once: today, and the latest due date that has
  // reached its push hour (BILL_PUSH_FROM_HOUR) — the owner's date that many
  // hours ago. Neither is ever later than `latest`.
  const sendFrom = new Date(now.getTime() - BILL_PUSH_FROM_HOUR * 3_600_000);
  const days = new Map<string, { today: string; dueBy: string }>();
  const daysOf = (userId: string) => {
    let d = days.get(userId);
    if (d === undefined) {
      const zone = canonicalTimeZone(recipients.get(userId)?.timeZone);
      const today = userToday(zone, now);
      d = { today, dueBy: zone ? userToday(zone, sendFrom) : today };
      days.set(userId, d);
    }
    return d;
  };

  const due = candidates.filter(
    (b) => b.nextDueDate <= daysOf(b.userId).dueBy && shouldNotify(b.lastNotifiedAt, b.nextDueDate)
  );

  for (const bill of due) {
    const dueDate = bill.nextDueDate;
    const recipient = recipients.get(bill.userId);
    const { title, body } = billDueNotification(recipient?.locale, {
      name: bill.name,
      amount: bill.amount,
      currency: recipient?.currency,
      currencySymbol: recipient?.currencySymbol,
      overdue: dueDate < daysOf(bill.userId).today,
    });

    // Recurring bills roll forward to their next due date after the owner's
    // today; one-off bills keep their due date. Either way lastNotifiedAt is
    // stamped so this due date is spent. Claimed before sending, so two
    // instances never both send it: of two runs that read the same row, only
    // one's conditional update matches.
    const nextDueDate = bill.isRecurring ? nextDueAfter(dueDate, bill.dueDay, daysOf(bill.userId).today) : dueDate;
    if (!(await deps.claimNotification(bill, now, nextDueDate))) continue;
    console.log(`[bill-reminder] Due: ${bill.id} on ${dueDate} (user: ${bill.userId})`);

    // Deliver a push to all of the user's registered devices (best-effort).
    await deps.sendPush(bill.userId, title, body, { type: "bill-reminder", billId: bill.id });
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
