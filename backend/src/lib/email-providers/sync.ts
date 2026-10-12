/**
 * Reading one connected mailbox: the one-year backfill on first connect, then
 * incremental passes.
 *
 * One connection never syncs twice at once — not on two instances, not as a
 * job tick beside a manual sync: each pass holds a JobLease named for the
 * connection, renewed while it runs. A second caller is told "busy".
 *
 * Backfill: list everything that looks like billing from the last year, page
 * by page, downloading each message whole and handing the bytes to the MIME
 * parser. Progress is saved after every page (backfillCursor), so a pass cut
 * short — a restart, a lost lease, a throttled provider — resumes where it
 * stopped. It reads at most BACKFILL_MAX_MESSAGES messages.
 *
 * Incremental: the same listing for mail received since the previous pass
 * began, less a day of overlap; a message already stored is recognised by its
 * messageKey and not downloaded again, and the unique (userId, messageKey)
 * stops a duplicate in any case.
 *
 * Errors end the pass with a short code in lastError, never mail text:
 *   reauth_required     the grant is gone (invalid_grant, revoked, scope
 *                       removed): status needs_reauth, and nothing more is
 *                       tried until the user reconnects;
 *   provider_busy       throttled or down: the next pass resumes;
 *   mailbox_unavailable the account has no mailbox to read: status error;
 *   sync_failed         anything else: the next pass retries.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { dbNow, type Db } from "../distributed/clock";
import { withJobLease } from "../distributed/lease";
import { extractFinding, parseMime, type AiExtractor, type EmailFinding } from "../email-parse";
import { findingRow, knownMessageKeys, messageKeyFor, storeFindings } from "./findings";
import {
  BACKFILL_MAX_LISTED,
  BACKFILL_MAX_MESSAGES,
  BACKFILL_WINDOW_MS,
  FETCH_CONCURRENCY,
  INCREMENTAL_MAX_MESSAGES,
  INCREMENTAL_OVERLAP_MS,
} from "./limits";
import {
  AccessExpiredError,
  MailboxUnavailableError,
  ProviderBusyError,
  ReauthRequiredError,
  type MailProvider,
  type ProviderName,
  type ProviderSet,
  type TokenCipher,
} from "./types";

export interface SyncLimits {
  backfillMax: number;
  backfillMaxListed: number;
  incrementalMax: number;
  concurrency: number;
}

export interface SyncDeps {
  providers: ProviderSet;
  cipher: TokenCipher;
  /** The AI fallback for this user's mail (capped), or null. */
  aiFor?: (userId: string) => AiExtractor | null;
  db?: Db;
  /** How long the per-connection lease is held at a time (renewed while running). */
  leaseTtlMs?: number;
  limits?: Partial<SyncLimits>;
}

export type SyncOutcome =
  | { ran: false; reason: "busy" | "not_found" | "not_syncable" | "not_configured" }
  | {
      ran: true;
      phase: "backfill" | "incremental";
      /** Messages downloaded and parsed in this pass. */
      scanned: number;
      /** New findings stored in this pass. */
      stored: number;
      /** The listing was read to its end (or its bound). */
      complete: boolean;
      error: string | null;
    };

/** The per-connection lease's name (lib/distributed/lease). */
export const syncLeaseName = (connectionId: string) => `email-sync:conn:${connectionId}`;
const DEFAULT_LEASE_TTL_MS = 2 * 60_000;

interface BackfillCursor {
  v: 1;
  /** The provider's cursor for the next page; null to start. */
  next: string | null;
  /** Messages downloaded so far in this backfill. */
  scanned: number;
  /** Messages listed so far (Outlook lists headers to prefilter). */
  listed: number;
  /** When the backfill began (database clock, epoch ms): the next pass reads from here. */
  startedAt: number;
}

function parseBackfillCursor(raw: string | null, now: number): BackfillCursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as BackfillCursor;
      if (c && c.v === 1 && Number.isFinite(c.startedAt) && Number.isFinite(c.scanned) && Number.isFinite(c.listed)) {
        return { v: 1, next: typeof c.next === "string" ? c.next : null, scanned: c.scanned, listed: c.listed, startedAt: c.startedAt };
      }
    } catch {
      /* unreadable: start the backfill again; stored findings are not duplicated */
    }
  }
  return { v: 1, next: null, scanned: 0, listed: 0, startedAt: now };
}

const isProvider = (p: string): p is ProviderName => p === "gmail" || p === "outlook";

/** The connection was deleted while we worked (disconnect, account deletion). */
function isGone(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2025" || e.code === "P2003");
}

/** A short, loggable name for an error: never its message, which can carry data. */
export function errorCode(e: unknown): string {
  if (e instanceof ReauthRequiredError) return "reauth_required";
  if (e instanceof ProviderBusyError) return "provider_busy";
  if (e instanceof MailboxUnavailableError) return "mailbox_unavailable";
  if (e instanceof Prisma.PrismaClientKnownRequestError) return `db_${e.code}`;
  return "sync_failed";
}

/**
 * Access tokens for one pass: refreshed when missing or refused, at most once
 * at a time however many downloads are in flight (Microsoft rotates the
 * refresh token on every refresh, and the old one stops working), with each
 * rotated refresh token handed to `onRotate` at once so it is never lost.
 */
export class TokenSession {
  private token: string | null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly provider: MailProvider,
    private refreshToken: string,
    initialAccessToken: string | null,
    private readonly onRotate: (refreshToken: string) => Promise<void>
  ) {
    this.token = initialAccessToken;
  }

  /** Refresh unless someone already replaced `stale`. */
  private renew(stale: string | null): Promise<void> {
    if (this.token !== stale) return Promise.resolve();
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const grant = await this.provider.refresh(this.refreshToken);
          if (grant.refreshToken && grant.refreshToken !== this.refreshToken) {
            this.refreshToken = grant.refreshToken;
            await this.onRotate(grant.refreshToken);
          }
          this.token = grant.accessToken;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async call<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
    if (!this.token) await this.renew(null);
    const used = this.token!;
    try {
      return await fn(used);
    } catch (e) {
      if (!(e instanceof AccessExpiredError)) throw e;
    }
    await this.renew(used);
    try {
      return await fn(this.token!);
    } catch (e) {
      // Refused with a token minted a moment ago: the grant itself is gone.
      if (e instanceof AccessExpiredError) throw new ReauthRequiredError();
      throw e;
    }
  }
}

/** Run `fn` over `items`, `n` at a time; the first failure stops new work and is rethrown. */
async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  let failure: { e: unknown } | null = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++]!;
      try {
        const r = await fn(item);
        if (r !== null) out.push(r);
      } catch (e) {
        failure ??= { e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failure) throw (failure as { e: unknown }).e;
  return out;
}

/** Parse one downloaded message; null when it is not readable mail. */
async function findingFor(raw: Uint8Array, ai: AiExtractor | null): Promise<EmailFinding | null> {
  try {
    const msg = await parseMime(raw);
    return await extractFinding(msg, { ai });
  } catch {
    return null;
  }
}

/**
 * One sync pass over one connection, under its lease. `accessToken` is a
 * fresh token the caller already holds (the OAuth callback), saving a refresh.
 */
export async function syncConnection(
  connectionId: string,
  deps: SyncDeps,
  opts: { accessToken?: string | null } = {}
): Promise<SyncOutcome> {
  const db = deps.db ?? prisma;
  const outcome = await withJobLease(
    syncLeaseName(connectionId),
    deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
    ({ signal }) => runPass(connectionId, deps, db, signal, opts.accessToken ?? null),
    { db }
  );
  return outcome.acquired ? outcome.value : { ran: false, reason: "busy" };
}

async function runPass(
  connectionId: string,
  deps: SyncDeps,
  db: Db,
  signal: AbortSignal,
  accessToken: string | null
): Promise<SyncOutcome> {
  const limits: SyncLimits = {
    backfillMax: BACKFILL_MAX_MESSAGES,
    backfillMaxListed: BACKFILL_MAX_LISTED,
    incrementalMax: INCREMENTAL_MAX_MESSAGES,
    concurrency: FETCH_CONCURRENCY,
    ...deps.limits,
  };
  const conn = await db.emailConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true, userId: true, provider: true, refreshTokenEnc: true, status: true,
      backfillDoneAt: true, backfillCursor: true, syncCursor: true, lastSyncedAt: true,
    },
  });
  if (!conn) return { ran: false, reason: "not_found" };
  if (!isProvider(conn.provider) || !conn.refreshTokenEnc || conn.status === "needs_reauth") {
    return { ran: false, reason: "not_syncable" };
  }
  const provider = deps.providers[conn.provider];
  if (!provider) return { ran: false, reason: "not_configured" };
  const source = conn.provider;

  const update = (data: Prisma.EmailConnectionUpdateInput) =>
    db.emailConnection.update({ where: { id: conn.id }, data, select: { id: true } });

  const backfill = conn.backfillDoneAt === null;
  const startedAt = (await dbNow(db)).getTime();
  const cursor = backfill
    ? parseBackfillCursor(conn.backfillCursor, startedAt)
    : { v: 1 as const, next: null, scanned: 0, listed: 0, startedAt };
  const previousStart = Number(conn.syncCursor) || conn.lastSyncedAt?.getTime() || startedAt - BACKFILL_WINDOW_MS;
  const sinceMs = backfill ? cursor.startedAt - BACKFILL_WINDOW_MS : previousStart - INCREMENTAL_OVERLAP_MS;
  const max = backfill ? limits.backfillMax : limits.incrementalMax;
  const phase = backfill ? "backfill" : "incremental";
  let scanned = 0;
  let stored = 0;

  let refreshToken: string;
  try {
    refreshToken = deps.cipher.decrypt(conn.refreshTokenEnc);
  } catch {
    // Encrypted under a key this server no longer has: only a reconnect helps.
    await update({ status: "needs_reauth", lastError: "reauth_required", syncState: "idle" }).catch(() => {});
    return { ran: true, phase, scanned, stored, complete: false, error: "reauth_required" };
  }

  try {
    await update({ syncState: backfill ? "backfilling" : "syncing" });
  } catch (e) {
    if (isGone(e)) return { ran: false, reason: "not_found" };
    throw e;
  }

  const session = new TokenSession(provider, refreshToken, accessToken, async (rotated) => {
    await update({ refreshTokenEnc: deps.cipher.encrypt(rotated) });
  });
  const ai = deps.aiFor?.(conn.userId) ?? null;
  // Gmail lists one message under several term groups: download it once per pass.
  const seen = new Set<string>();

  try {
    let complete = false;
    while (!signal.aborted) {
      const page = await session.call((t) => provider.listPage(t, { backfill, sinceMs, cursor: cursor.next }));
      cursor.listed += page.listed;

      const ids = [...new Set(page.ids)].filter((id) => !seen.has(id)).slice(0, Math.max(0, max - cursor.scanned));
      for (const id of ids) seen.add(id);
      const keys = ids.map((id) => messageKeyFor(source, id));
      const known = await knownMessageKeys(conn.userId, keys, db);
      const todo = ids.filter((_, i) => !known.has(keys[i]!));

      const results = await mapPool(todo, limits.concurrency, async (id) => {
        if (signal.aborted) return null;
        const raw = await session.call((t) => provider.fetchRaw(t, id));
        return { id, finding: raw ? await findingFor(raw, ai) : null };
      });

      const receivedAt = await dbNow(db);
      const rows = results.flatMap((r) => {
        const row = findingRow(r.finding, {
          userId: conn.userId,
          connectionId: conn.id,
          source,
          messageKey: messageKeyFor(source, r.id),
          receivedAt,
        });
        return row ? [row] : [];
      });
      const inserted = await storeFindings(rows, db);
      cursor.scanned += results.length;
      scanned += results.length;
      stored += inserted;

      // A page cut short by a lost lease is listed again next time.
      const pageDone = !signal.aborted;
      if (pageDone) cursor.next = page.next;
      complete =
        pageDone &&
        (page.next === null || cursor.scanned >= max || (backfill && cursor.listed >= limits.backfillMaxListed));
      await update({
        messagesScanned: { increment: results.length },
        findingsCount: { increment: inserted },
        ...(backfill && !complete ? { backfillCursor: JSON.stringify(cursor) } : {}),
      });
      if (complete) break;
    }

    if (!complete) {
      // The lease was lost: another holder may be running; leave the state to it.
      return { ran: true, phase, scanned, stored, complete: false, error: "lease_lost" };
    }
    const finishedAt = await dbNow(db);
    await update({
      syncState: "idle",
      status: "active",
      lastError: null,
      lastSyncedAt: finishedAt,
      // The next pass reads from when this one began (less the overlap).
      syncCursor: String(cursor.startedAt),
      ...(backfill ? { backfillDoneAt: finishedAt, backfillCursor: null } : {}),
    });
    return { ran: true, phase, scanned, stored, complete: true, error: null };
  } catch (e) {
    if (isGone(e)) return { ran: true, phase, scanned, stored, complete: false, error: "gone" };
    const code = errorCode(e);
    const lastError = code.startsWith("db_") ? "sync_failed" : code;
    await update({
      syncState: "idle",
      lastError,
      ...(code === "reauth_required" ? { status: "needs_reauth" } : {}),
      ...(code === "mailbox_unavailable" ? { status: "error" } : {}),
      ...(backfill ? { backfillCursor: JSON.stringify(cursor) } : {}),
    }).catch(() => {});
    console.warn(`[email-sync] ${source} connection ${conn.id}: ${phase} stopped (${code})`);
    return { ran: true, phase, scanned, stored, complete: false, error: lastError };
  }
}

/**
 * A sync someone asked for: if a pass is already running, wait for it to
 * finish (polling the lease) and run another, so mail that arrived during the
 * running pass is read too. Gives up after `waitMs`.
 */
export async function syncWhenFree(
  connectionId: string,
  deps: SyncDeps,
  opts: { accessToken?: string | null; waitMs?: number; pollMs?: number } = {}
): Promise<SyncOutcome> {
  const deadline = Date.now() + (opts.waitMs ?? 60_000);
  for (;;) {
    const outcome = await syncConnection(connectionId, deps, { accessToken: opts.accessToken });
    if (outcome.ran || outcome.reason !== "busy" || Date.now() >= deadline) return outcome;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 2_000));
  }
}
