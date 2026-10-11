import type { PrismaClient, RecurringTransaction } from "@prisma/client";
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
 * lastCreated is not already today and nextDate is still what I read" — so of
 * any number of instances (or a job tick and a tap on "run now") racing for the
 * same occurrence, exactly one updates the row and books it; the others' update
 * matches nothing once the winner commits. The insert also skips an id that
 * already exists, so even a series whose lastCreated was edited back cannot
 * produce a second row for the same day.
 */

export function occurrenceId(recurringId: string, dateISO: string): string {
  return `tx_rec_${recurringId}_${dateISO}`;
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
 * Claim `rec`'s occurrence for `today` and book it, moving the series on to
 * `nextDate`. Claims only while the row still has the nextDate `rec` was read
 * with (and, for the job, is still active), so a stale read books nothing.
 */
export async function bookOccurrence(
  rec: BookableRecurring,
  today: string,
  nextDate: string,
  opts: { requireActive: boolean; db?: PrismaClient }
): Promise<BookingResult> {
  const db = opts.db ?? prisma;
  return db.$transaction(async (tx) => {
    const claim = await tx.recurringTransaction.updateMany({
      where: {
        id: rec.id,
        nextDate: rec.nextDate,
        ...(opts.requireActive ? { isActive: true } : {}),
        OR: [{ lastCreated: null }, { lastCreated: { not: today } }],
      },
      data: { lastCreated: today, nextDate },
    });
    if (claim.count === 0) return { claimed: false, created: false };

    // The series' accountId was stored as sent and never checked. Book onto
    // it only if it is still one of the owner's own accounts — otherwise the
    // occurrence would land in someone else's ledger and balance.
    const account = rec.accountId
      ? await tx.bankAccount.findFirst({
          where: { id: rec.accountId, userId: rec.userId },
          select: { id: true },
        })
      : null;

    const inserted = await tx.transaction.createMany({
      data: [
        {
          id: occurrenceId(rec.id, today),
          userId: rec.userId,
          accountId: account?.id ?? null,
          amount: rec.amount,
          category: rec.category,
          type: rec.type,
          isImpulse: rec.isImpulse,
          note: `[Auto] ${rec.name}`,
          dateISO: today,
          currency: rec.currency,
          // A server-created row carries the server's time (PLAN decision 5),
          // so the phone takes it as the newest version on its next pull.
          clientUpdatedAt: await dbNow(tx),
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
      const moved = await db.recurringTransaction.updateMany({
        where: { id, nextDate: rec.nextDate, lastCreated: today },
        data: { nextDate },
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
