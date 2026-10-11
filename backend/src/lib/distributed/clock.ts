import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";

/**
 * What the shared-state modules in this directory run their queries on.
 *
 * The app's own client by default. A test passes a second PrismaClient to play
 * a second instance, and a route passes its interactive transaction when the
 * write has to commit or roll back together with its own rows.
 */
export type Db = Prisma.TransactionClient;

/**
 * The database's clock, in UTC, as a timestamp without time zone — the type of
 * every Prisma DateTime column here, which holds UTC.
 *
 * Every expiry, window and lease in this directory is decided by this clock and
 * never by the instance's own: two instances' clocks drift apart, and a counter
 * window or a lease that each side measured against its own clock would open
 * and close at different moments on each. The server's time zone is not UTC
 * (the local one is Asia/Shanghai), so the conversion is explicit; the value is
 * truncated to milliseconds like the columns, as the init migration's triggers
 * do. statement_timestamp() is fixed for the whole statement, so one query that
 * reads "now" twice sees the same instant both times.
 */
export const DB_NOW = Prisma.sql`date_trunc('milliseconds', statement_timestamp() AT TIME ZONE 'UTC')`;

/** A millisecond count as a Postgres interval expression. */
export function msInterval(ms: number): Prisma.Sql {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`invalid duration: ${ms}ms`);
  return Prisma.sql`(${ms}::double precision * interval '1 millisecond')`;
}

/** The database's current time. */
export async function dbNow(db: Db = prisma): Promise<Date> {
  const [row] = await db.$queryRaw<{ now: Date }[]>`SELECT ${DB_NOW} AS now`;
  return row!.now;
}

/**
 * Today's date in UTC, YYYY-MM-DD, by the database's clock.
 *
 * What a recurring occurrence is named by. Two instances whose clocks disagree
 * across midnight would otherwise name the same occurrence differently and
 * book it twice.
 */
export async function dbToday(db: Db = prisma): Promise<string> {
  const [row] = await db.$queryRaw<{ today: string }[]>`
    SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS today`;
  return row!.today;
}
