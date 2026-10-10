import { prisma } from "../prisma";

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
}

export interface RetentionDeps {
  deleteInboxOlderThan(cutoff: Date): Promise<number>;
  deleteConfirmationsOlderThan(cutoff: Date): Promise<number>;
  deleteSessionsExpiredBefore(cutoff: Date): Promise<number>;
  deleteVerificationsExpiredBefore(cutoff: Date): Promise<number>;
}

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (now: Date, hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);

const prismaDeps: RetentionDeps = {
  async deleteInboxOlderThan(cutoff) {
    const { count } = await prisma.inboxEmail.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    return count;
  },
  async deleteConfirmationsOlderThan(cutoff) {
    const { count } = await prisma.inboxEmail.deleteMany({
      where: { status: "confirmation", receivedAt: { lt: cutoff } },
    });
    return count;
  },
  async deleteSessionsExpiredBefore(cutoff) {
    const { count } = await prisma.session.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  },
  async deleteVerificationsExpiredBefore(cutoff) {
    const { count } = await prisma.verification.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  },
};

export async function enforceRetention(
  deps: RetentionDeps = prismaDeps,
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

  const total = confirmations + inboxEmails + sessions + verifications;
  if (total > 0) {
    console.log(
      `[retention] removed ${total} row(s): ${inboxEmails} inbox, ` +
        `${confirmations} confirmations, ${sessions} sessions, ${verifications} verifications`
    );
  }
  return { inboxEmails, confirmations, sessions, verifications };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Runs on start and then daily. Cheap: four indexed deletes. */
export function startRetentionJob(intervalMs = 24 * 60 * 60 * 1000) {
  enforceRetention().catch((e) =>
    console.error("[retention] initial run failed:", e)
  );
  intervalHandle = setInterval(() => {
    enforceRetention().catch((e) =>
      console.error("[retention] scheduled run failed:", e)
    );
  }, intervalMs);
  intervalHandle.unref();
}

export function stopRetentionJob() {
  if (intervalHandle) clearInterval(intervalHandle);
}
