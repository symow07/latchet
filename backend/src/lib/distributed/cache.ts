import { prisma } from "../../prisma";
import { DB_NOW, msInterval, type Db } from "./clock";

/**
 * Short-lived shared values with an expiry, in the CacheEntry table: caches
 * (exchange rates) and one-time state (a pending bank link). Every instance
 * sees the same entry, where a Map in each process meant a value set on one
 * instance was missing on the next.
 *
 * Expiry is by the database's clock. An expired entry reads as absent and is
 * replaced by the next write; the retention job purges what is left.
 *
 * Values are JSON. Store plain data, not class instances; undefined is
 * stored as null.
 */

const json = (value: unknown) => JSON.stringify(value ?? null);

/** The value under `key`, or null when there is none or it has expired. */
export async function cacheGet<T>(key: string, db: Db = prisma): Promise<T | null> {
  const rows = await db.$queryRaw<{ value: T }[]>`
    SELECT "value" FROM "CacheEntry"
     WHERE "key" = ${key} AND "expiresAt" > ${DB_NOW}`;
  return rows.length ? rows[0]!.value : null;
}

/** Store `value` under `key` for `ttlMs`, replacing whatever was there. */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlMs: number,
  db: Db = prisma
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "CacheEntry" ("key", "value", "expiresAt")
    VALUES (${key}, ${json(value)}::jsonb, ${DB_NOW} + ${msInterval(ttlMs)})
    ON CONFLICT ("key") DO UPDATE SET
      "value" = EXCLUDED."value",
      "expiresAt" = EXCLUDED."expiresAt"`;
}

/**
 * Store `value` under `key` only if nothing live is there; true when it was
 * stored. Atomic across instances: of any number of concurrent callers, exactly
 * one gets true while the entry lives. That makes it a lock with a timeout —
 * whoever adds the entry does the work, and an entry left by a crashed holder
 * simply expires.
 */
export async function cacheAdd(
  key: string,
  value: unknown,
  ttlMs: number,
  db: Db = prisma
): Promise<boolean> {
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "CacheEntry" AS e ("key", "value", "expiresAt")
    VALUES (${key}, ${json(value)}::jsonb, ${DB_NOW} + ${msInterval(ttlMs)})
    ON CONFLICT ("key") DO UPDATE SET
      "value" = EXCLUDED."value",
      "expiresAt" = EXCLUDED."expiresAt"
    WHERE e."expiresAt" <= ${DB_NOW}
    RETURNING "key"`;
  return rows.length === 1;
}

/**
 * Remove the entry under `key` and return its value if it had not expired.
 *
 * For single-use state. The read and the delete are one statement, so of two
 * instances consuming the same entry at once exactly one gets the value: the
 * other's DELETE finds the row already gone. A get followed by a delete would
 * let both read it before either removed it.
 */
export async function cacheTake<T>(key: string, db: Db = prisma): Promise<T | null> {
  const rows = await db.$queryRaw<{ value: T; live: boolean }[]>`
    DELETE FROM "CacheEntry" WHERE "key" = ${key}
    RETURNING "value", ("expiresAt" > ${DB_NOW}) AS "live"`;
  return rows.length && rows[0]!.live ? rows[0]!.value : null;
}

/** Remove the entry under `key`, if any. */
export async function cacheDelete(key: string, db: Db = prisma): Promise<void> {
  await db.$executeRaw`DELETE FROM "CacheEntry" WHERE "key" = ${key}`;
}

/**
 * Remove the entry under `key` only while it still holds `value`. Releases a
 * lock taken with cacheAdd without releasing a newer holder's: if this
 * holder's entry expired and someone else added theirs, it is left alone.
 */
export async function cacheDeleteIf(key: string, value: unknown, db: Db = prisma): Promise<boolean> {
  const n = await db.$executeRaw`
    DELETE FROM "CacheEntry" WHERE "key" = ${key} AND "value" = ${json(value)}::jsonb`;
  return n === 1;
}
