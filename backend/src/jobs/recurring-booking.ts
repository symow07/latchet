import type { Prisma, PrismaClient, RecurringTransaction } from "@prisma/client";
import { prisma } from "../prisma";
import { anchorDayOf, computeNextDate } from "../lib/recurrence";
import { dbNow, dbToday } from "../lib/distributed/clock";

/**
 * Booking one occurrence of a recurring transaction — the one piece of code
 * both the recurring job and "run now" (POST /recurring/:id/run) go through,
 * so the two can never book the same day twice.
 *
 * An occurrence is named by its series and its UTC date, tx_rec_<id>_<date>,
 * and the date comes from the database's clock: two instances whose clocks
 * straddle midnight would otherwise name one occurrence two ways.
 *
 * Booking is a claim, then an insert, in one transaction. The claim is a
 * conditional update of the series row — "set lastCreated to today, where
 * lastCreated is not already today and the row is still what I read" — so of
 * any number of instances (or a job tick and a tap on "run now") racing for the
 * same occurrence, exactly one updates the row and books it; the others' update
 * matches nothing once the winner commits. The insert also skips an id that
 * already exists, so even a series whose lastCreated was edited back cannot
 * produce a second row for the same day.
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
 * Claim `rec`'s occurrence for `today` and book it, moving the series on to
 * `nextDate`. Claims only while the row is still exactly what `rec` was read
 * as (and, for the job, is still active), so a stale read books nothing.
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
        OR: [{ lastCreated: null }, { lastCreated: { not: today } }],
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
 * The series restarts from today: nextDate becomes the first date after today
 * on its schedule (anchored on its start date, as the job does). This is what
 * the app used to ask for — it posted its own transaction and set nextDate to
 * today for the job to advance — without the second transaction the job then
 * booked on top of it.
 *
 * Idempotent: when today's occurrence is already booked, by an earlier tap or
 * by the job, nothing new is booked and the existing id comes back with 200.
 */
export async function runRecurringNow(
  id: string,
  userId: string,
  db: PrismaClient = prisma
): Promise<RunNowResult | null> {
  const today = await dbToday(db);
  const transactionId = occurrenceId(id, today);

  // A claim can lose to a concurrent write that moved nextDate (an edit, the
  // job); reading again and retrying settles it in a step or two.
  for (let attempt = 0; attempt < 5; attempt++) {
    const rec = await db.recurringTransaction.findFirst({ where: { id, userId } });
    if (!rec) return null;
    const nextDate = computeNextDate(today, rec.frequency, anchorDayOf(rec.startDate));

    if (rec.lastCreated === today) {
      // Booked already. The job may have booked an overdue series and moved it
      // just one step, still on or before today; finish moving it.
      if (rec.nextDate > today) return { status: 200, transactionId, nextDate: rec.nextDate };
      // A server write like the claim: stamped by the database clock.
      const moved = await db.recurringTransaction.updateMany({
        where: { id, nextDate: rec.nextDate, lastCreated: today },
        data: { nextDate, clientUpdatedAt: await dbNow(db) },
      });
      if (moved.count === 1) return { status: 200, transactionId, nextDate };
      continue;
    }

    const booking = await bookOccurrence(rec, today, nextDate, { requireActive: false, db });
    if (booking.claimed) {
      return { status: booking.created ? 201 : 200, transactionId, nextDate };
    }
  }
  throw new Error(`run-now for ${id} kept losing its claim to concurrent writes`);
}
