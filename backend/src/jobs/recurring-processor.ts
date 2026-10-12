import type { PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { computeNextDate, anchorDayOf } from "../lib/recurrence";
import { dbNow } from "../lib/distributed/clock";
import { withJobLease } from "../lib/distributed/lease";
import { latestToday, userToday } from "../lib/user-day";
import { bookOccurrence, bookedThrough } from "./recurring-booking";

/** The lease every instance's tick competes for (lib/distributed/lease). */
export const RECURRING_LEASE = "recurring-processor";
/** Held this long at a time, renewed while a tick runs. */
const LEASE_TTL_MS = 2 * 60_000;

/**
 * Book today's occurrence of every active series that is due, where today is
 * each owner's own calendar date (Phase 5 decision 1): one tick serves users
 * in every time zone, each by their own day, read at one instant of the
 * database's clock (`opts.now` in tests).
 *
 * Each series is claimed before it is booked (jobs/recurring-booking.ts), so
 * this is safe to run on any number of instances at once: the lease keeps
 * them from running together, and the claim keeps them correct if they ever
 * do (a tick that outlived its lease) or race "run now". An overdue series
 * moves one step per day, as it always has.
 *
 * Stops early when `signal` fires (the lease was lost). Returns how many
 * transactions it booked.
 */
export async function processRecurring(
  opts: {
    db?: PrismaClient;
    signal?: AbortSignal;
    /** Only these users' series. For tests, which share a database. */
    userIds?: string[];
    /** The instant to book at, instead of the database's clock. For tests. */
    now?: Date;
  } = {}
): Promise<number> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? (await dbNow(db));
  // No one's today is later than this, so the query can be coarse; the exact
  // cut is each owner's own today, below.
  const latest = latestToday(now);

  const candidates = await db.recurringTransaction.findMany({
    where: {
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
      isActive: true,
      nextDate: { lte: latest },
      // Booked for the latest today or after: the claim would refuse it anyway.
      OR: [{ lastCreated: null }, { lastCreated: { lt: latest } }],
    },
    include: { user: { select: { timezone: true } } },
    orderBy: { id: "asc" },
  });

  // One owner, one today, even across a tick that takes a while.
  const todays = new Map<string, string>();
  const todayOf = (userId: string, timeZone: string | null) => {
    let today = todays.get(userId);
    if (today === undefined) {
      today = userToday(timeZone, now);
      todays.set(userId, today);
    }
    return today;
  };

  let booked = 0;
  for (const { user, ...rec } of candidates) {
    if (opts.signal?.aborted) break;
    const today = todayOf(rec.userId, user.timezone);
    if (rec.nextDate > today || bookedThrough(rec.lastCreated, today)) continue;
    try {
      // Anchor on the series' start date: clamping to February must not
      // permanently shorten every month that follows.
      const nextDate = computeNextDate(rec.nextDate, rec.frequency, anchorDayOf(rec.startDate));
      const result = await bookOccurrence(rec, today, nextDate, { requireActive: true, db });
      if (result.created) booked++;
    } catch (e) {
      console.error(`[recurring-processor] Failed for ${rec.id}:`, e);
    }
  }
  return booked;
}

/** One tick: run under the lease, or skip when another instance holds it. */
export function runRecurringTick(opts: { db?: PrismaClient } = {}) {
  return withJobLease(
    RECURRING_LEASE,
    LEASE_TTL_MS,
    ({ signal }) => processRecurring({ db: opts.db, signal }),
    { db: opts.db }
  );
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startRecurringProcessor(intervalMs = 60_000) {
  const tick = () =>
    runRecurringTick().catch((e) => console.error("[recurring-processor] Run failed:", e));

  // Run immediately on start, then repeat on interval.
  tick();
  intervalHandle = setInterval(tick, intervalMs);
  intervalHandle.unref();
}

export function stopRecurringProcessor() {
  if (intervalHandle) clearInterval(intervalHandle);
}
