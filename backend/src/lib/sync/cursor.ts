/**
 * The pull cursor: what it means, how it is encoded, and how each page moves it.
 * Pure — no database, no clock of its own; the caller passes the database's.
 *
 * ORDER. Every synced item — a live row or a tombstone — has a key
 * (t, entity, id): t is its serverUpdatedAt (rows) or deletedAt (tombstones)
 * in epoch milliseconds, both stamped by the database clock. A pull returns
 * items in key order, entity and id compared bytewise (COLLATE "C"), and a
 * cursor names a key: everything at or before it has been delivered.
 *
 * THE SAFETY LAG. A stamp is taken when a row is written, not when its
 * transaction commits, so a row stamped at t can become visible after rows
 * stamped later were already returned. Writes are assumed to commit within
 * PULL_SAFETY_LAG_MS of their stamp: at database time T, everything stamped
 * before the horizon H = T − lag is visible. A page still returns everything
 * it can see, including items newer than H, but a run of pages only ever
 * settles on a cursor at or before the horizon of the page where it first
 * crossed it. The window between is sent again on the next pull; applying is
 * idempotent, and nothing is skipped.
 *
 * CURSOR KINDS.
 *   rest  [1,"r",user,t]             Where a finished run settled: everything
 *                                    stamped before t is delivered. Always at
 *                                    or before a horizon.
 *   inc   [1,"i",user,t,e,k,floor]   Mid-run (hasMore): resume after (t,e,k).
 *                                    floor = the horizon of the first page that
 *                                    went past its own horizon, or null.
 *   snap  [1,"s",user,t,e,k,floor]   Mid-snapshot: resume after (t,e,k); floor
 *                                    = the horizon when the snapshot began.
 *
 * SNAPSHOTS. No cursor, a cursor for another user, or a cursor whose safe point
 * is older than the tombstones are kept starts a snapshot: live rows only, in
 * the same key order, fullResync on every page. When it finishes it settles on
 * the horizon at which it began, so the next incremental pull re-sends what
 * changed while it was paging — including the deletion of a row an early page
 * had already sent, which a snapshot by itself never carries.
 *
 * A snapshot in progress is never restarted: the client wipes its rows only
 * before the first page of a snapshot, and a restart under it would leave it
 * holding half of one.
 */
import { createHash } from "node:crypto";
import { PULL_SAFETY_LAG_MS, SYNC_ENTITIES, TOMBSTONE_RETENTION_DAYS, type SyncEntity } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How old a cursor's safe point may be before it needs a snapshot. A day short
 * of the retention period: the retention job and this check read different
 * clocks at different times, and a margin costs one early snapshot at most.
 */
export const CURSOR_MAX_AGE_MS = (TOMBSTONE_RETENTION_DAYS - 1) * DAY_MS;

/** Last representable millisecond of year 9999, the wire format's limit. */
const MAX_MS = 253_402_300_799_999;

/** A position in pull order. entity and id are "" for a boundary before every item at t. */
export interface SyncKey {
  t: number;
  e: SyncEntity | "";
  k: string;
}

export type PullCursor =
  | { mode: "rest"; user: string; t: number }
  | { mode: "inc"; user: string; pos: SyncKey; floor: number | null }
  | { mode: "snap"; user: string; pos: SyncKey; floor: number };

/** A short, stable tag of the user a cursor was issued to. */
export function userTag(userId: string): string {
  return createHash("sha256").update(userId).digest("base64url").slice(0, 12);
}

export function encodeCursor(c: PullCursor): string {
  const body =
    c.mode === "rest"
      ? [1, "r", c.user, c.t]
      : [1, c.mode === "inc" ? "i" : "s", c.user, c.pos.t, c.pos.e, c.pos.k, c.floor];
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

const isMs = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_MS;
const isEntity = (v: unknown): v is SyncEntity => (SYNC_ENTITIES as readonly unknown[]).includes(v);

/** The cursor a string encodes, or null when it is not one this server issued. */
export function decodeCursor(raw: string): PullCursor | null {
  if (raw.length === 0 || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(body) || body[0] !== 1) return null;
  const [, mode, user] = body;
  if (typeof user !== "string" || user.length === 0 || user.length > 32) return null;

  if (mode === "r") {
    if (body.length !== 4 || !isMs(body[3])) return null;
    return { mode: "rest", user, t: body[3] };
  }
  if (mode !== "i" && mode !== "s") return null;
  if (body.length !== 7) return null;
  const [, , , t, e, k, floor] = body;
  if (!isMs(t) || !isEntity(e) || typeof k !== "string" || k.length === 0 || k.length > 200) return null;
  if (mode === "s") {
    if (!isMs(floor)) return null;
    return { mode: "snap", user, pos: { t, e, k }, floor };
  }
  if (floor !== null && !isMs(floor)) return null;
  return { mode: "inc", user, pos: { t, e, k }, floor };
}

/** What one pull reads: a snapshot or not, after which key, and the floor so far. */
export interface PullPlan {
  snapshot: boolean;
  /** Items strictly after this key; null for the first page of a snapshot. */
  after: SyncKey | null;
  /** See PullCursor; always set for a snapshot. */
  floor: number | null;
}

/**
 * Decide what a pull reads. `cursor` is the decoded cursor, or null when the
 * request named none; `nowMs` is the database clock.
 */
export function planPull(cursor: PullCursor | null, tag: string, nowMs: number): PullPlan {
  const fresh: PullPlan = { snapshot: true, after: null, floor: nowMs - PULL_SAFETY_LAG_MS };
  if (cursor === null || cursor.user !== tag) return fresh;
  const oldest = nowMs - CURSOR_MAX_AGE_MS;

  switch (cursor.mode) {
    case "snap":
      return { snapshot: true, after: cursor.pos, floor: cursor.floor };
    case "inc":
      if ((cursor.floor ?? cursor.pos.t) < oldest) return fresh;
      return { snapshot: false, after: cursor.pos, floor: cursor.floor };
    case "rest":
      if (cursor.t < oldest) return fresh;
      return { snapshot: false, after: { t: cursor.t, e: "", k: "" }, floor: null };
  }
}

/** Items in pull order, bytewise on entity and id as Postgres's COLLATE "C". */
export function compareKeys(a: SyncKey, b: SyncKey): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.e !== b.e) return Buffer.compare(Buffer.from(a.e), Buffer.from(b.e));
  return Buffer.compare(Buffer.from(a.k), Buffer.from(b.k));
}

export interface PageCut<T extends SyncKey> {
  items: T[];
  hasMore: boolean;
  cursor: PullCursor;
}

/**
 * Cut a page from items read in key order (at most limit + 1 of them; the
 * extra one only says there is more) and compute the cursor that follows it.
 * `horizonMs` is the database time the page was read at, minus the lag.
 */
export function cutPage<T extends SyncKey>(
  read: T[],
  limit: number,
  plan: PullPlan,
  tag: string,
  horizonMs: number
): PageCut<T> {
  const items = read.slice(0, limit);
  const hasMore = read.length > limit;

  if (!hasMore) {
    // Everything visible after the cursor was returned, and everything stamped
    // before the horizon was visible: the run settles where it first became
    // unsafe, or on this page's horizon.
    return { items, hasMore, cursor: { mode: "rest", user: tag, t: plan.floor ?? horizonMs } };
  }

  const last = items[items.length - 1]!;
  const pos: SyncKey = { t: last.t, e: last.e, k: last.k };
  if (plan.snapshot) {
    return { items, hasMore, cursor: { mode: "snap", user: tag, pos, floor: plan.floor! } };
  }
  const floor = plan.floor ?? (last.t >= horizonMs ? horizonMs : null);
  return { items, hasMore, cursor: { mode: "inc", user: tag, pos, floor } };
}
