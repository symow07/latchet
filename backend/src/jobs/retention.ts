import { prisma } from "../prisma";
import { DB_NOW, msInterval, type Db } from "../lib/distributed/clock";
import { withJobLease } from "../lib/distributed/lease";
import { LOGO_KIND, RECEIPT_KIND } from "../lib/receipt-store";
import { TOMBSTONE_RETENTION_DAYS } from "../lib/sync/constants";

/**
 * Data retention.
 *
 * Nothing used to be deleted, ever. Forwarded billing emails, expired sessions
 * and spent one-time codes accumulated for the life of the account, which is
 * both a growing liability and something a privacy policy cannot honestly
 * describe as keeping only what is needed.
 *
 * What is kept and for how long:
 *
 *   Forwarded emails   90 days. Long enough to spot an annual renewal cycle;
 *                      the subscription detected from one is stored separately
 *                      and is unaffected.
 *   Confirmation codes 24 hours. A Gmail forwarding code is useful for minutes.
 *   Expired sessions   7 days past expiry, so a support question about a
 *                      recent sign-in is still answerable.
 *   Expired verification tokens  24 hours past expiry.
 *
 * Shared state that replaced per-process memory (lib/distributed) is swept
 * here too, since nothing else ever deletes it:
 *
 *   Rate-limit counters and lockouts   once their window or lockout has ended.
 *   Cache entries                      once expired (rates, link sessions).
 *   Sync tombstones                    after TOMBSTONE_RETENTION_DAYS, when a
 *                                      client that old gets a full resync
 *                                      instead; at once when their user is gone
 *                                      (they have no foreign key to cascade).
 *   Stored files                       once the expense or business they belong
 *                                      to is gone — account deletion cascades
 *                                      past the routes that remove them.
 *
 * Expiries are compared with the database's clock, which stamped them.
 *
 * A user's own ledger is never expired — it is theirs until they delete it.
 */

export const INBOX_RETENTION_DAYS = 90;
export const CONFIRMATION_RETENTION_HOURS = 24;
export const EXPIRED_SESSION_GRACE_DAYS = 7;
export const EXPIRED_VERIFICATION_GRACE_HOURS = 24;

export interface RetentionCounts {
  inboxEmails: number;
  confirmations: number;
  sessions: number;
  verifications: number;
  rateLimits: number;
  cacheEntries: number;
  tombstones: number;
  files: number;
}

export interface RetentionDeps {
  deleteInboxOlderThan(cutoff: Date): Promise<number>;
  deleteConfirmationsOlderThan(cutoff: Date): Promise<number>;
  deleteSessionsExpiredBefore(cutoff: Date): Promise<number>;
  deleteVerificationsExpiredBefore(cutoff: Date): Promise<number>;
  /** RateLimitBucket rows whose window or lockout has ended. */
  deleteExpiredRateLimits(): Promise<number>;
  /** CacheEntry rows past their expiry. */
  deleteExpiredCacheEntries(): Promise<number>;
  /** Tombstones deleted more than `days` ago, and any whose user is gone. */
  deleteTombstones(days: number): Promise<number>;
  /** Stored files whose expense or business no longer exists. */
  deleteOrphanFiles(): Promise<number>;
}

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (now: Date, hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);

/**
 * The real sweeps, on `db`: the app's client, or a transaction in tests so
 * that their effect can be rolled back.
 */
export const retentionDeps = (db: Db = prisma): RetentionDeps => ({
  async deleteInboxOlderThan(cutoff) {
    const { count } = await db.inboxEmail.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    return count;
  },
  async deleteConfirmationsOlderThan(cutoff) {
    const { count } = await db.inboxEmail.deleteMany({
      where: { status: "confirmation", receivedAt: { lt: cutoff } },
    });
    return count;
  },
  async deleteSessionsExpiredBefore(cutoff) {
    const { count } = await db.session.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  },
  async deleteVerificationsExpiredBefore(cutoff) {
    const { count } = await db.verification.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  },
  deleteExpiredRateLimits: () =>
    db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "expiresAt" < ${DB_NOW}`,
  deleteExpiredCacheEntries: () =>
    db.$executeRaw`DELETE FROM "CacheEntry" WHERE "expiresAt" < ${DB_NOW}`,
  async deleteTombstones(days) {
    // deletedAt is stamped by the database's clock, and the pull decides a
    // cursor is too old for deltas by the same clock; measuring this cutoff by
    // the instance's clock instead could drop a tombstone a client is still
    // owed by the size of the drift.
    const old = await db.$executeRaw`
      DELETE FROM "SyncTombstone"
       WHERE "deletedAt" < ${DB_NOW} - ${msInterval(days * 24 * 60 * 60 * 1000)}`;
    const orphaned = await db.$executeRaw`
      DELETE FROM "SyncTombstone" t
       WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = t."userId")`;
    return old + orphaned;
  },
  async deleteOrphanFiles() {
    const receipts = await db.$executeRaw`
      DELETE FROM "StoredFile" f
       WHERE f."kind" = ${RECEIPT_KIND}
         AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."id" = f."ownerId")`;
    const logos = await db.$executeRaw`
      DELETE FROM "StoredFile" f
       WHERE f."kind" = ${LOGO_KIND}
         AND NOT EXISTS (SELECT 1 FROM "Group" g WHERE g."id" = f."ownerId")`;
    return receipts + logos;
  },
});

export async function enforceRetention(
  deps: RetentionDeps = retentionDeps(),
  now: Date = new Date()
): Promise<RetentionCounts> {
  // Confirmations first: they are also inbox rows, and the tighter window
  // should apply to them rather than the general 90 days.
  const confirmations = await deps.deleteConfirmationsOlderThan(
    hoursAgo(now, CONFIRMATION_RETENTION_HOURS)
  );
  const inboxEmails = await deps.deleteInboxOlderThan(
    daysAgo(now, INBOX_RETENTION_DAYS)
  );
  const sessions = await deps.deleteSessionsExpiredBefore(
    daysAgo(now, EXPIRED_SESSION_GRACE_DAYS)
  );
  const verifications = await deps.deleteVerificationsExpiredBefore(
    hoursAgo(now, EXPIRED_VERIFICATION_GRACE_HOURS)
  );

  const rateLimits = await deps.deleteExpiredRateLimits();
  const cacheEntries = await deps.deleteExpiredCacheEntries();
  const tombstones = await deps.deleteTombstones(TOMBSTONE_RETENTION_DAYS);
  const files = await deps.deleteOrphanFiles();

  const counts = {
    inboxEmails, confirmations, sessions, verifications,
    rateLimits, cacheEntries, tombstones, files,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) {
    console.log(
      `[retention] removed ${total} row(s): ${inboxEmails} inbox, ` +
        `${confirmations} confirmations, ${sessions} sessions, ${verifications} verifications, ` +
        `${rateLimits} rate limits, ${cacheEntries} cache entries, ${tombstones} tombstones, ` +
        `${files} files`
    );
  }
  return counts;
}

/** The lease every instance's tick competes for (lib/distributed/lease). */
export const RETENTION_LEASE = "retention";
/** Held this long at a time, renewed while a run lasts. */
const LEASE_TTL_MS = 10 * 60_000;

/** One run: under the lease, or skipped when another instance holds it. */
export function runRetentionTick(deps: RetentionDeps = retentionDeps()) {
  return withJobLease(RETENTION_LEASE, LEASE_TTL_MS, () => enforceRetention(deps));
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Runs on start and then daily. Cheap: a handful of indexed deletes. */
export function startRetentionJob(intervalMs = 24 * 60 * 60 * 1000) {
  const tick = () =>
    runRetentionTick().catch((e) => console.error("[retention] run failed:", e));
  tick();
  intervalHandle = setInterval(tick, intervalMs);
  intervalHandle.unref();
}

export function stopRetentionJob() {
  if (intervalHandle) clearInterval(intervalHandle);
}
