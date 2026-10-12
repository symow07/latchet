import type { Prisma, PrismaClient, RecurringTransaction } from "@prisma/client";
import { prisma } from "../prisma";
import { anchorDayOf, computeNextDate } from "../lib/recurrence";
import { dbNow } from "../lib/distributed/clock";
import { userToday } from "../lib/user-day";

/**
 * Booking one occurrence of a recurring transaction — the one piece of code
 * both the recurring job and "run now" (POST /recurring/:id/run) go through,
 * so the two can never book the same day twice.
 *
 * An occurrence is named by its series and the owner's own calendar date,
 * tx_rec_<id>_<date> (Phase 5 decision 1): the date in the time zone their
 * phone reported (User.timezone), or UTC's when it has not. The instant that
 * date is read at comes from the database's clock: two instances whose clocks
 * straddle midnight would otherwise name one occurrence two ways.
 *
 * Booking is a claim, then an insert, in one transaction. The claim is a
 * conditional update of the series row — "set lastCreated to today, where
 * lastCreated is before today and the row is still what I read" — so of any
 * number of instances (or a job tick and a tap on "run now") racing for the
 * same occurrence, exactly one updates the row and books it; the others' update
 * matches nothing once the winner commits. The insert also skips an id that
 * already exists, so even a series whose lastCreated was edited back cannot
 * produce a second row for the same day.
 *
 * "Before today", not "other than today": a user's day can go backwards. A
 * phone that reports a zone west of the one it reported before (or of UTC,
 * for a series booked before it ever reported) makes today a date earlier
 * than one already booked. That day has had its occurrence; booking the
 * earlier date as well would charge it twice. The series waits until its own
 * calendar passes the last booking (bookedThrough).
 *
 * "Still what I read" covers every field the booking copies, not only
 * nextDate: an edit that lands between the read and the claim (a sync push, a
 * REST update) makes the claim miss, and the series is booked from its new
 * values on the next tick (or the next attempt of run-now) instead of from
 * the old ones.
 *
 * The claim is a server write to a synced row: it stamps clientUpdatedAt from
 * the database clock (Phase 4 decision 4), so a phone's copy edited before
 * the booking loses to it, and every phone pulls the moved series.
 *
 * Where it lands (Phase 4 decision 5): the series' own account when the
 * owner has it, otherwise the owner's default account, otherwise none
 * (bookingAccountId). That account is locked FOR KEY SHARE before the series
 * row is claimed. A sync push locks the accounts it writes FOR UPDATE before
 * any series row, so the one lock pair that conflicts is always taken in the
 * same order on both sides and the two cannot deadlock (lib/sync/push.ts).
 */

export function occurrenceId(recurringId: string, dateISO: string): string {
  return `tx_rec_${recurringId}_${dateISO}`;
}

/**
 * Whether a series whose last booking was `lastCreated` has had its
 * occurrence for `today` — or for a later date, when the user's day has gone
 * backwards since (a zone further west). Either way nothing is booked today.
 * Dates are YYYY-MM-DD, so string order is date order.
 */
export function bookedThrough(lastCreated: string | null, today: string): boolean {
  return lastCreated !== null && lastCreated >= today;
}

/** The claim's half of bookedThrough: rows whose last booking is before `today`. */
function notBookedThrough(today: string): Prisma.RecurringTransactionWhereInput {
  return { OR: [{ lastCreated: null }, { lastCreated: { lt: today } }] };
}

/**
 * `userId`'s today at `now`: their calendar date in the time zone their
 * phone last reported, or UTC's (lib/user-day.ts).
 */
export async function userTodayOf(db: PrismaClient, userId: string, now: Date): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return userToday(user?.timezone, now);
}

/**
 * Whether a user's edit of a series must leave its booking state (nextDate,
 * lastCreated) as stored: when the edit carries a lastCreated older than the
 * stored one, or none while the series has been booked. Such an edit was made
 * on a copy read before the latest booking; applied whole, it would move the
 * series back to a date already booked, and the job would book again the
 * next day. Its other fields still apply.
 *
 * `sentLastCreated` undefined means the edit did not say (a REST PUT of a
 * few fields): its nextDate, if any, is taken as meant. A sync push always
 * says, and applies the same rule in SQL (lib/sync/push.ts). Dates are
 * YYYY-MM-DD, so string order is date order.
 */
export function keepsBookingState(
  storedLastCreated: string | null,
  sentLastCreated: string | null | undefined
): boolean {
  if (sentLastCreated === undefined || storedLastCreated === null) return false;
  return sentLastCreated === null || sentLastCreated < storedLastCreated;
}

/** The fields of a series that booking reads. */
export type BookableRecurring = Pick<
  RecurringTransaction,
  | "id" | "userId" | "accountId" | "name" | "amount" | "category" | "type"
  | "isImpulse" | "currency" | "nextDate" | "frequency" | "startDate"
>;

export interface BookingResult {
  /** This call won the claim: lastCreated is now today and nextDate moved. */
  claimed: boolean;
  /** This call inserted the occurrence's transaction. */
  created: boolean;
}

/**
 * The account an occurrence of `userId`'s series is booked onto (Phase 4
 * decision 5), locked FOR KEY SHARE so it cannot be deleted before the
 * booking commits:
 *
 *   1. the series' own account, if `userId` owns it;
 *   2. else the user's default account — the oldest marked isDefault;
 *   3. else acc_default_<userId>, the account every phone seeds, if present;
 *   4. else null: the occurrence is booked with no account.
 *
 * Never another user's account, whatever the series says.
 */
export async function bookingAccountId(
  tx: Prisma.TransactionClient,
  userId: string,
  seriesAccountId: string | null
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BankAccount"
     WHERE "userId" = ${userId}
       AND ("id" = ${seriesAccountId} OR "isDefault" OR "id" = ${`acc_default_${userId}`})
     ORDER BY COALESCE("id" = ${seriesAccountId}, false) DESC, "isDefault" DESC, "createdAt", "id"
     LIMIT 1
       FOR KEY SHARE`;
  return rows[0]?.id ?? null;
}

/**
 * Claim `rec`'s occurrence for `today` (the owner's own date) and book it,
 * moving the series on to `nextDate`. Claims only while the row is still
 * exactly what `rec` was read as (and, for the job, is still active), and has
 * not been booked for today or later, so a stale read books nothing.
 */
export async function bookOccurrence(
  rec: BookableRecurring,
  today: string,
  nextDate: string,
  opts: { requireActive: boolean; db?: PrismaClient }
): Promise<BookingResult> {
  const db = opts.db ?? prisma;
  return db.$transaction(async (tx) => {
    const now = await dbNow(tx);
    const accountId = await bookingAccountId(tx, rec.userId, rec.accountId);

    const claim = await tx.recurringTransaction.updateMany({
      where: {
        id: rec.id,
        userId: rec.userId,
        nextDate: rec.nextDate,
        accountId: rec.accountId,
        name: rec.name,
        amount: rec.amount,
        category: rec.category,
        type: rec.type,
        isImpulse: rec.isImpulse,
        currency: rec.currency,
        frequency: rec.frequency,
        startDate: rec.startDate,
        ...(opts.requireActive ? { isActive: true } : {}),
        ...notBookedThrough(today),
      },
      data: { lastCreated: today, nextDate, clientUpdatedAt: now },
    });
    if (claim.count === 0) return { claimed: false, created: false };

    const inserted = await tx.transaction.createMany({
      data: [
        {
          id: occurrenceId(rec.id, today),
          userId: rec.userId,
          accountId,
          amount: rec.amount,
          category: rec.category,
          type: rec.type,
          isImpulse: rec.isImpulse,
          note: `[Auto] ${rec.name}`,
          dateISO: today,
          currency: rec.currency,
          // A server-created row carries the server's time (Phase 3 decision 5),
          // so the phone takes it as the newest version on its next pull.
          clientUpdatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    return { claimed: true, created: inserted.count === 1 };
  });
}

export interface RunNowResult {
  /** 201 when this call booked today's occurrence, 200 when it already was. */
  status: 200 | 201;
  transactionId: string;
  nextDate: string;
}

/**
 * "Run now": book today's occurrence of the caller's own series and move it
 * on past today. Null when `id` is not a series of `userId`'s.
 *
 * Today is the user's own (userTodayOf), read at the database's clock unless
 * `opts.now` names the instant (tests). The series restarts from today:
 * nextDate becomes the first date after today on its schedule (anchored on
 * its start date, as the job does). This is what the app used to ask for —
 * it posted its own transaction and set nextDate to today for the job to
 * advance — without the second transaction the job then booked on top of it.
 *
 * Idempotent: when today's occurrence is already booked, by an earlier tap or
 * by the job, nothing new is booked and the existing id comes back with 200.
 * So is a series booked for a later date than today — the user's day went
 * backwards (bookedThrough): that occurrence is the one returned, and the
 * series moves on past it.
 */
export async function runRecurringNow(
  id: string,
  userId: string,
  db: PrismaClient = prisma,
  opts: { now?: Date } = {}
): Promise<RunNowResult | null> {
  const today = await userTodayOf(db, userId, opts.now ?? (await dbNow(db)));

  // A claim can lose to a concurrent write that moved nextDate (an edit, the
  // job); reading again and retrying settles it in a step or two.
  for (let attempt = 0; attempt < 5; attempt++) {
    const rec = await db.recurringTransaction.findFirst({ where: { id, userId } });
    if (!rec) return null;
    const anchor = anchorDayOf(rec.startDate);

    if (rec.lastCreated !== null && bookedThrough(rec.lastCreated, today)) {
      // Booked already. The job may have booked an overdue series and moved it
      // just one step, still on or before that day; finish moving it.
      const bookedDay = rec.lastCreated;
      const transactionId = occurrenceId(id, bookedDay);
      if (rec.nextDate > bookedDay) return { status: 200, transactionId, nextDate: rec.nextDate };
      const nextDate = computeNextDate(bookedDay, rec.frequency, anchor);
      // A server write like the claim: stamped by the database clock.
      const moved = await db.recurringTransaction.updateMany({
        where: { id, nextDate: rec.nextDate, lastCreated: bookedDay },
        data: { nextDate, clientUpdatedAt: await dbNow(db) },
      });
      if (moved.count === 1) return { status: 200, transactionId, nextDate };
      continue;
    }

    const nextDate = computeNextDate(today, rec.frequency, anchor);
    const booking = await bookOccurrence(rec, today, nextDate, { requireActive: false, db });
    if (booking.claimed) {
      return { status: booking.created ? 201 : 200, transactionId: occurrenceId(id, today), nextDate };
    }
  }
  throw new Error(`run-now for ${id} kept losing its claim to concurrent writes`);
}
