import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { prisma } from "../../prisma";
import { DB_NOW, msInterval, type Db } from "./clock";

/**
 * Mutual exclusion for periodic jobs across instances, in the JobLease table.
 *
 * Every instance runs the same timers, so without this each job ran once per
 * instance per tick, all at the same time. A lease is one row per job name:
 * whoever holds an unexpired lease runs the tick, everyone else skips it.
 *
 * Why a row and not pg_advisory_lock: advisory locks belong to a database
 * session, and Prisma hands each query whichever pooled connection is free, so
 * the unlock can run on a different connection from the lock (and fail), and a
 * lock taken by a query outlives the request on a connection that goes back to
 * the pool. A lease row is ordinary data: any connection can take, renew or
 * release it, and if its holder dies it simply expires.
 *
 * Each call is its own holder (a random id per acquisition, not per process),
 * so a tick that overlaps the previous one in the same process is refused too.
 *
 * Expiry is by the database's clock. While the job runs, the lease is renewed
 * every third of its ttl; if a renewal finds the lease taken over (the holder
 * stalled for longer than the ttl) or fails, the job's AbortSignal fires so it
 * can stop between units of work. The jobs do not rely on the lease alone for
 * correctness: each one also claims its rows with conditional updates, so even
 * two ticks overlapping after a lost lease cannot do the same unit twice.
 */

export interface JobLeaseContext {
  /** Fires when the lease is lost; stop at the next safe point. */
  signal: AbortSignal;
  /** This acquisition's holder id, as stored in JobLease.holder. */
  holder: string;
}

export type LeaseOutcome<T> = { acquired: true; value: T } | { acquired: false };

export interface LeaseOptions {
  db?: Db;
  /** How often to renew while the job runs. Default: a third of the ttl. */
  renewEveryMs?: number;
}

/** Take the lease if it is free or expired. True when this holder now has it. */
export async function acquireLease(
  name: string,
  holder: string,
  ttlMs: number,
  db: Db = prisma
): Promise<boolean> {
  const rows = await db.$queryRaw<{ holder: string }[]>`
    INSERT INTO "JobLease" AS l ("name", "holder", "leaseUntil")
    VALUES (${name}, ${holder}, ${DB_NOW} + ${msInterval(ttlMs)})
    ON CONFLICT ("name") DO UPDATE SET
      "holder" = EXCLUDED."holder",
      "leaseUntil" = EXCLUDED."leaseUntil"
    WHERE l."leaseUntil" < ${DB_NOW}
    RETURNING "holder"`;
  return rows.length === 1 && rows[0]!.holder === holder;
}

/** Extend the lease by `ttlMs` from now. False when this holder no longer has it. */
export async function renewLease(
  name: string,
  holder: string,
  ttlMs: number,
  db: Db = prisma
): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE "JobLease" SET "leaseUntil" = ${DB_NOW} + ${msInterval(ttlMs)}
     WHERE "name" = ${name} AND "holder" = ${holder}`;
  return n === 1;
}

/** Give the lease up, if this holder still has it. */
export async function releaseLease(name: string, holder: string, db: Db = prisma): Promise<void> {
  await db.$executeRaw`DELETE FROM "JobLease" WHERE "name" = ${name} AND "holder" = ${holder}`;
}

/**
 * Run `fn` while holding the lease `name`, or skip it when another holder has
 * the lease. The lease is held for `ttlMs` at a time, renewed while `fn` runs,
 * and released when it settles, whether it returned or threw.
 */
export async function withJobLease<T>(
  name: string,
  ttlMs: number,
  fn: (lease: JobLeaseContext) => Promise<T>,
  opts: LeaseOptions = {}
): Promise<LeaseOutcome<T>> {
  const db = opts.db ?? prisma;
  const holder = `${hostname()}:${process.pid}:${randomUUID()}`;
  if (!(await acquireLease(name, holder, ttlMs, db))) return { acquired: false };

  const controller = new AbortController();
  let renewing = false;
  const renewal = setInterval(() => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    renewLease(name, holder, ttlMs, db)
      .then((held) => {
        if (!held) controller.abort(new Error(`job lease "${name}" was taken over`));
      })
      .catch((e) => controller.abort(e))
      .finally(() => {
        renewing = false;
      });
  }, opts.renewEveryMs ?? Math.max(10, Math.floor(ttlMs / 3)));
  renewal.unref?.();

  try {
    return { acquired: true, value: await fn({ signal: controller.signal, holder }) };
  } finally {
    clearInterval(renewal);
    await releaseLease(name, holder, db).catch((e) =>
      // Not fatal: the lease expires on its own at the end of its ttl.
      console.warn(`[lease] release of "${name}" failed:`, e instanceof Error ? e.message : e)
    );
  }
}
