import type { PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { computeNextDate, anchorDayOf } from "../lib/recurrence";
import { dbToday } from "../lib/distributed/clock";
import { withJobLease } from "../lib/distributed/lease";
import { bookOccurrence } from "./recurring-booking";

/** The lease every instance's tick competes for (lib/distributed/lease). */
export const RECURRING_LEASE = "recurring-processor";
/** Held this long at a time, renewed while a tick runs. */
const LEASE_TTL_MS = 2 * 60_000;

/**
 * Book today's occurrence of every active series that is due.
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
  } = {}
): Promise<number> {
  const db = opts.db ?? prisma;
  const today = await dbToday(db);

  const due = await db.recurringTransaction.findMany({
    where: {
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
      isActive: true,
      nextDate: { lte: today },
      // Already booked today: the claim would refuse it anyway.
      OR: [{ lastCreated: null }, { lastCreated: { not: today } }],
    },
    orderBy: { id: "asc" },
  });

  let booked = 0;
  for (const rec of due) {
    if (opts.signal?.aborted) break;
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
