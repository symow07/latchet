import { prisma } from "../prisma";
import { dbNow, type Db } from "../lib/distributed/clock";
import { withJobLease } from "../lib/distributed/lease";
import { emailServicesFromEnv } from "../lib/email-providers";
import { syncConnection, type SyncDeps, type SyncOutcome } from "../lib/email-providers/sync";

/**
 * Keeping connected inboxes current while the server is awake.
 *
 * Railway sleeps an idle service, so this is not the only trigger: the app
 * asks for a sync when it opens (POST /email/sync). While the server runs, this
 * job wakes every EMAIL_SYNC_INTERVAL_MINUTES and syncs the connections that
 * have not been synced within that interval — oldest first, a bounded number
 * per tick, one after another. A connection whose first backfill was cut
 * short (a restart, a deploy) has never been synced and goes first, so the
 * backfill resumes on its own.
 *
 * Each tick runs under its own JobLease, and each connection's pass under the
 * connection's lease (lib/email-providers/sync), so neither another instance's
 * tick nor a manual sync ever reads the same mailbox at the same time.
 */

/** Connections synced per tick, at most. */
export const EMAIL_SYNC_BATCH = 25;
export const EMAIL_SYNC_LEASE = "email-sync";
const LEASE_TTL_MS = 10 * 60_000;

/**
 * Due when not synced within the interval, less a grace: a connection this
 * job synced at the last tick finished a little after the tick began, and
 * without the grace it would be skipped every other tick.
 */
export function dueBefore(now: Date, intervalMinutes: number): Date {
  const intervalMs = intervalMinutes * 60_000;
  const grace = Math.min(5 * 60_000, intervalMs / 2);
  return new Date(now.getTime() - intervalMs + grace);
}

export interface EmailSyncJobDeps {
  /** Connections due a sync, oldest first, at most `limit`. */
  listDue(before: Date, limit: number): Promise<string[]>;
  syncOne(connectionId: string): Promise<SyncOutcome>;
  now(): Promise<Date>;
}

export function emailSyncJobDeps(sync: SyncDeps, db: Db = prisma): EmailSyncJobDeps {
  const configured = Object.entries(sync.providers).filter(([, p]) => !!p).map(([name]) => name);
  return {
    async listDue(before, limit) {
      if (configured.length === 0) return [];
      const rows = await db.emailConnection.findMany({
        where: {
          provider: { in: configured },
          status: { in: ["active", "error"] },
          refreshTokenEnc: { not: null },
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: before } }],
        },
        orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        take: limit,
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },
    syncOne: (id) => syncConnection(id, sync, {}),
    now: () => dbNow(db),
  };
}

export interface EmailSyncTickResult {
  due: number;
  synced: number;
  busy: number;
}

/** One tick: sync what is due, one connection at a time. */
export async function runEmailSyncTick(
  deps: EmailSyncJobDeps,
  intervalMinutes: number,
  signal?: AbortSignal
): Promise<EmailSyncTickResult> {
  const due = await deps.listDue(dueBefore(await deps.now(), intervalMinutes), EMAIL_SYNC_BATCH);
  let synced = 0;
  let busy = 0;
  for (const id of due) {
    if (signal?.aborted) break;
    try {
      const outcome = await deps.syncOne(id);
      if (outcome.ran) synced++;
      else if (outcome.reason === "busy") busy++;
    } catch {
      // syncConnection records its own failures; one bad connection never stops the rest.
    }
  }
  return { due: due.length, synced, busy };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Ticks on start and then every EMAIL_SYNC_INTERVAL_MINUTES. Nothing to do without a provider. */
export function startEmailSyncJob() {
  const services = emailServicesFromEnv();
  if (!services.providers.gmail && !services.providers.outlook) return;
  const intervalMinutes = services.config.syncIntervalMinutes;
  const deps = emailSyncJobDeps(services.sync);
  const tick = () =>
    withJobLease(EMAIL_SYNC_LEASE, LEASE_TTL_MS, ({ signal }) => runEmailSyncTick(deps, intervalMinutes, signal))
      .then((r) => {
        if (r.acquired && r.value.synced > 0) console.log(`[email-sync] synced ${r.value.synced} of ${r.value.due} due inbox(es)`);
      })
      .catch((e) => console.error("[email-sync] tick failed:", e instanceof Error ? e.name : "error"));
  tick();
  intervalHandle = setInterval(tick, intervalMinutes * 60_000);
  intervalHandle.unref();
}

export function stopEmailSyncJob() {
  if (intervalHandle) clearInterval(intervalHandle);
}
