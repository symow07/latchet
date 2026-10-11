/**
 * SQL building blocks for synced tables: time conversion, the database clock,
 * tombstone stamping and the ledger sum.
 *
 * Time. Prisma keeps DateTime as UTC in `timestamp(3)` columns, which carry no
 * zone, and Postgres converts between those and timestamptz with the SESSION'S
 * TimeZone — not necessarily UTC. Raw SQL here therefore never passes a JS Date
 * and never lets a timestamptz meet one of these columns: times cross the
 * boundary as epoch milliseconds and are converted explicitly, the way the
 * triggers in the init migration do it.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SyncEntity } from "./constants";

/** The root client or an interactive transaction's client. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** A `timestamp(3)` value (UTC) from epoch milliseconds. */
export function sqlTimestamp(ms: number): Prisma.Sql {
  return Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + (${ms})::double precision * INTERVAL '1 millisecond')`;
}

/** Epoch milliseconds of a `timestamp(3)` column holding UTC. */
export function sqlMillis(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(extract(epoch FROM ${column}) * 1000)::bigint`;
}

/** The database clock now, as a UTC `timestamp(3)`, as the triggers stamp it. */
export const SQL_NOW = Prisma.sql`date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')`;

/**
 * The database clock in epoch milliseconds. Every instance orders sync by this
 * one clock (PLAN.md decision 2), never by its own.
 */
export async function databaseNowMs(db: Db): Promise<number> {
  const [row] = await db.$queryRaw<{ ms: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`;
  return Number(row!.ms);
}

/**
 * Give the tombstones of `ids` a clientUpdatedAt of at least `cuMs`, and move
 * their deletedAt to now so the change is pulled again.
 *
 * The delete trigger records the deleted row's own clientUpdatedAt. A delete
 * is a write with a time of its own (decision 5): the device's time for a
 * pushed delete, the server's for one the server made. Without this, an edit
 * made after the row's last change but before it was deleted would beat the
 * tombstone and bring the row back.
 *
 * `insertMissing` also records a tombstone for an id that has none — a push
 * deleting a row the server never had, so a late upsert of it loses.
 */
export async function stampTombstones(
  db: Db,
  userId: string,
  entity: SyncEntity,
  stamps: readonly { id: string; cu: number }[],
  opts: { insertMissing: boolean }
): Promise<void> {
  if (stamps.length === 0) return;
  const json = JSON.stringify(stamps.map((s) => ({ k: s.id, cu: s.cu })));
  const cu = Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + v.cu * INTERVAL '1 millisecond')`;
  if (opts.insertMissing) {
    await db.$executeRaw`
      INSERT INTO "SyncTombstone" ("id", "userId", "entity", "syncId", "deletedAt", "clientUpdatedAt")
      SELECT gen_random_uuid()::text, ${userId}, ${entity}, v.k, ${SQL_NOW}, ${cu}
        FROM jsonb_to_recordset(${json}::jsonb) AS v(k text, cu double precision)
      ON CONFLICT ("userId", "entity", "syncId") DO UPDATE SET
        "deletedAt" = EXCLUDED."deletedAt",
        "clientUpdatedAt" = GREATEST("SyncTombstone"."clientUpdatedAt", EXCLUDED."clientUpdatedAt")`;
  } else {
    await db.$executeRaw`
      UPDATE "SyncTombstone" AS s SET
        "deletedAt" = ${SQL_NOW},
        "clientUpdatedAt" = GREATEST(s."clientUpdatedAt", ${cu})
        FROM jsonb_to_recordset(${json}::jsonb) AS v(k text, cu double precision)
       WHERE s."userId" = ${userId} AND s."entity" = ${entity} AND s."syncId" = v.k`;
  }
}

/**
 * Move the caller's tombstones of `ids` forward in pull order (deletedAt = the
 * database clock now), changing nothing else. A push answered `stale` against
 * a tombstone does this, so the device that lost pulls the delete again even
 * if its cursor had already passed it (I-WIRE, rev 5).
 */
export async function touchTombstones(db: Db, userId: string, entity: SyncEntity, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.$executeRaw`
    UPDATE "SyncTombstone" SET "deletedAt" = ${SQL_NOW}
     WHERE "userId" = ${userId} AND "entity" = ${entity} AND "syncId" = ANY(${[...ids]}::text[])`;
}

/** Remove the caller's tombstones of `ids`: those rows are live again. */
export async function dropTombstones(db: Db, userId: string, entity: SyncEntity, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.syncTombstone.deleteMany({ where: { userId, entity, syncId: { in: [...ids] } } });
}

/**
 * Σ Income − Σ everything else over each account's transactions: the sum the
 * balance trigger adds to openingBalance, restricted the same way to the
 * account owner's rows. Accounts with no transactions are absent (net 0).
 */
export async function ledgerNet(db: Db, userId: string, accountIds: readonly string[]): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ accountId: string; net: number }[]>`
    SELECT "accountId",
           SUM(CASE WHEN "type" = 'Income' THEN "amount" ELSE -"amount" END)::double precision AS net
      FROM "Transaction"
     WHERE "userId" = ${userId} AND "accountId" = ANY(${[...accountIds]}::text[])
     GROUP BY "accountId"`;
  return new Map(rows.map((r) => [r.accountId, Number(r.net)]));
}

/**
 * The openingBalance that makes the derived balance equal `target`, with the
 * account row locked first so no ledger write lands between the sum and the
 * write. Returns null when the caller owns no such account. Must run inside an
 * interactive transaction.
 */
export async function openingBalanceForTarget(
  tx: Prisma.TransactionClient,
  userId: string,
  accountId: string,
  target: number
): Promise<number | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BankAccount" WHERE "id" = ${accountId} AND "userId" = ${userId} FOR UPDATE`;
  if (locked.length === 0) return null;
  const net = (await ledgerNet(tx, userId, [accountId])).get(accountId) ?? 0;
  return target - net;
}
