import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { DB_NOW, msInterval, type Db } from "./clock";

/**
 * Fixed-window counters every instance shares, in the RateLimitBucket table.
 *
 * These used to be a Map in each process, so with two instances every limit
 * was really twice its value — and with N, N times — and a restart forgot all
 * of them. Now a counter is one row, and counting is one statement:
 *
 *   INSERT … ON CONFLICT (key) DO UPDATE … RETURNING count
 *
 * Postgres runs that atomically per row. Two concurrent hits on one key never
 * both read the old count: the second waits for the first's row lock and then
 * updates the row the first wrote. The window rolls over inside the same
 * statement (an expired row restarts at 1), so there is no read-then-reset
 * race either, and windows open and close by the database's clock, not by
 * whichever instance happened to see the request.
 *
 * The count stops at max + 1. A refused hit still "counts" in that it can never
 * be allowed, but the number does not keep climbing, so a refused caller cannot
 * push the stored count past thresholds that are measured against `max`.
 *
 * Expired rows are left in place until the retention job purges them; every
 * read here ignores them.
 */

export interface WindowHit {
  /** True when this hit is within the limit. */
  allowed: boolean;
  /** Hits allowed in the current window, this one included; at most `max`. */
  count: number;
  /** When the current window closes (database clock, UTC). */
  resetAt: Date;
}

/** Longest key stored verbatim. A btree entry cannot hold arbitrary text. */
const MAX_KEY_LENGTH = 200;

/**
 * The key as stored. Keys can carry client-supplied text (an identifier
 * header), and a primary-key entry of a few kilobytes is refused outright by
 * Postgres, which would turn a long header into a 500. Long keys are stored as
 * a prefix plus a hash of the whole, so they stay distinct and bounded.
 */
export function bucketKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `${key.slice(0, 64)}#${createHash("sha256").update(key).digest("hex")}`;
}

/**
 * Count one hit against `key`, allowing at most `max` per `windowMs`.
 *
 * The first hit opens the window; it closes `windowMs` later, and the next hit
 * after that opens a fresh one at 1. Within a window, hits past `max` are
 * refused, and they do not extend the window.
 */
export async function hitWindow(
  key: string,
  max: number,
  windowMs: number,
  db: Db = prisma
): Promise<WindowHit> {
  if (!Number.isInteger(max) || max < 0) throw new Error(`invalid limit: ${max}`);
  if (!(windowMs > 0)) throw new Error(`invalid window: ${windowMs}ms`);

  const rows = await db.$queryRaw<{ count: number; expiresAt: Date }[]>`
    INSERT INTO "RateLimitBucket" AS b ("key", "count", "windowStart", "expiresAt")
    SELECT ${bucketKey(key)}, 1, t.now, t.now + ${msInterval(windowMs)}
      FROM (SELECT ${DB_NOW} AS now) t
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN b."expiresAt" < EXCLUDED."windowStart" THEN 1
                     ELSE LEAST(b."count" + 1, ${max}::int + 1) END,
      "windowStart" = CASE WHEN b."expiresAt" < EXCLUDED."windowStart"
                           THEN EXCLUDED."windowStart" ELSE b."windowStart" END,
      "expiresAt" = CASE WHEN b."expiresAt" < EXCLUDED."windowStart"
                         THEN EXCLUDED."expiresAt" ELSE b."expiresAt" END
    RETURNING "count", "expiresAt"`;

  const row = rows[0]!;
  const count = Number(row.count);
  return { allowed: count <= max, count: Math.min(count, max), resetAt: row.expiresAt };
}

/** Lockouts share the table with counters under their own prefix. */
const LOCK_PREFIX = "lockout:";

/**
 * Lock `key` for `ttlMs` from now (database clock). Locking an already-locked
 * key restarts the lock from now, as the per-process lockout map did.
 */
export async function lockFor(key: string, ttlMs: number, db: Db = prisma): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "RateLimitBucket" AS b ("key", "count", "windowStart", "expiresAt")
    SELECT ${bucketKey(LOCK_PREFIX + key)}, 0, t.now, t.now + ${msInterval(ttlMs)}
      FROM (SELECT ${DB_NOW} AS now) t
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = EXCLUDED."windowStart",
      "expiresAt" = EXCLUDED."expiresAt"`;
}

/** Which of `keys` are locked right now. One query for any number of keys. */
export async function lockedKeys(keys: string[], db: Db = prisma): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const stored = new Map(keys.map((k) => [bucketKey(LOCK_PREFIX + k), k]));
  const rows = await db.$queryRaw<{ key: string }[]>`
    SELECT "key" FROM "RateLimitBucket"
     WHERE "key" = ANY(${[...stored.keys()]}::text[])
       AND "expiresAt" >= ${DB_NOW}`;
  return new Set(rows.map((r) => stored.get(r.key)!));
}
