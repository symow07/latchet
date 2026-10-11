/**
 * POST /sync/push: apply a device's changes, last writer wins (conflict.ts).
 *
 * One database transaction per push, entities in SYNC_ENTITIES order. Every
 * read and lock comes first, then every write, so the rows this push stamps
 * (serverUpdatedAt is taken at write time) commit moments after they were
 * stamped — the pull's safety lag (cursor.ts) assumes exactly that.
 *
 * Stale answers converge. A row that loses (`stale`) changes no data, but its
 * winner — the live row or the tombstone it lost to — is moved forward in pull
 * order: the row's serverUpdatedAt is re-stamped by its trigger, the
 * tombstone's deletedAt set to now. A device whose clock runs behind may have
 * pulled past the winner already; this is what brings it back to that device,
 * which otherwise keeps its losing version forever (I-WIRE, rev 5).
 *
 * Concurrency. A per-user advisory lock queues two pushes from the same
 * account (two devices), and the stored rows and tombstones are read FOR
 * UPDATE (in key order, so two pushes queue rather than deadlock), so a REST
 * write or a bank sync cannot change them between the decision and the write. Two different users can still race on a brand-new
 * global id; the loser fails on the primary key and the whole push is retried,
 * when it sees the other user's row and gets `forbidden`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { SYNC_ENTITIES, type SyncEntity } from "./constants";
import {
  accountsAfter, planBatch, resolveAccountId,
  type BatchPlan, type BatchRow, type KeyState, type SyncStatus, type WriteOp,
} from "./conflict";
import { parsePushRow, toWireTimestamp, type SyncRowValues } from "./schemas";
import { databaseNowMs, dropTombstones, sqlMillis, stampTombstones, touchTombstones, SQL_NOW } from "./sql";

type Tx = Prisma.TransactionClient;

export interface PushResponse {
  results: Record<SyncEntity, { id: string; status: SyncStatus }[]>;
  serverTime: string;
}

/** The live rows of `ids`: who owns each, and its clientUpdatedAt. */
type LiveRows = Map<string, { owner: string; cu: number }>;

interface EntityStore<E extends SyncEntity> {
  /** Read and lock the live rows a push names. */
  lockLive(tx: Tx, userId: string, ids: string[]): Promise<LiveRows>;
  insert(tx: Tx, userId: string, ops: InsertOrUpdate<E>[], ctx: WriteContext): Promise<void>;
  update(tx: Tx, userId: string, ops: InsertOrUpdate<E>[], ctx: WriteContext): Promise<void>;
  remove(tx: Tx, userId: string, ids: string[]): Promise<void>;
  /**
   * Re-stamp the caller's live rows `ids` without changing them: an UPDATE
   * that sets nothing new still fires the serverUpdatedAt trigger, and touches
   * no column the balance triggers watch.
   */
  touch(tx: Tx, userId: string, ids: string[]): Promise<void>;
}

type InsertOrUpdate<E extends SyncEntity> = Extract<WriteOp<SyncRowValues<E>>, { kind: "insert" | "update" }>;

interface WriteContext {
  /** The caller's accounts once this push's accounts are applied. */
  ownAccounts: ReadonlySet<string>;
}

const at = (ms: number) => new Date(ms);
const cuOf = (column: string) => sqlMillis(Prisma.raw(`"${column}"`));

function liveRows(rows: { id: string; owner: string; cu: bigint }[]): LiveRows {
  return new Map(rows.map((r) => [r.id, { owner: r.owner, cu: Number(r.cu) }]));
}

const STORES: { [E in SyncEntity]: EntityStore<E> } = {
  settings: {
    async lockLive(tx, userId) {
      return liveRows(await tx.$queryRaw`
        SELECT 'settings' AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "UserSettings" WHERE "userId" = ${userId} FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      for (const op of ops) {
        // The id convention of PUT /settings: one row per user.
        await tx.userSettings.create({
          data: { id: `settings_${userId}`, userId, ...op.values, clientUpdatedAt: at(op.cu) },
        });
      }
    },
    async update(tx, userId, ops) {
      for (const op of ops) {
        await tx.userSettings.update({ where: { userId }, data: { ...op.values, clientUpdatedAt: at(op.cu) } });
      }
    },
    async remove(tx, userId) {
      await tx.userSettings.deleteMany({ where: { userId } });
    },
    async touch(tx, userId) {
      await tx.$executeRaw`UPDATE "UserSettings" SET "serverUpdatedAt" = "serverUpdatedAt" WHERE "userId" = ${userId}`;
    },
  },

  categories: {
    async lockLive(tx, userId, ids) {
      return liveRows(await tx.$queryRaw`
        SELECT "name" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "CustomCategory" WHERE "userId" = ${userId} AND "name" = ANY(${ids}::text[])
         ORDER BY "name" FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      await tx.customCategory.createMany({
        data: ops.map((op) => ({
          userId, name: op.id, icon: op.values.icon, color: op.values.color,
          createdAt: at(op.values.createdAt), clientUpdatedAt: at(op.cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      for (const op of ops) {
        await tx.customCategory.update({
          where: { userId_name: { userId, name: op.id } },
          data: { icon: op.values.icon, color: op.values.color, createdAt: at(op.values.createdAt), clientUpdatedAt: at(op.cu) },
        });
      }
    },
    async remove(tx, userId, ids) {
      await tx.customCategory.deleteMany({ where: { userId, name: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "CustomCategory" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "name" = ANY(${ids}::text[])`;
    },
  },

  accounts: {
    async lockLive(tx, _userId, ids) {
      // By id alone: an id held by another user must be seen to be refused.
      return liveRows(await tx.$queryRaw`
        SELECT "id" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "BankAccount" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      // balance is not written: the trigger derives it from openingBalance.
      await tx.bankAccount.createMany({
        data: ops.map(({ id, cu, values: v }) => ({
          id, userId, name: v.name, type: v.type, openingBalance: v.openingBalance, currency: v.currency,
          color: v.color, icon: v.icon, isDefault: v.isDefault, createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      for (const { id, cu, values: v } of ops) {
        await tx.bankAccount.update({
          where: { id, userId },
          data: {
            name: v.name, type: v.type, openingBalance: v.openingBalance, currency: v.currency,
            color: v.color, icon: v.icon, isDefault: v.isDefault, createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
          },
        });
      }
    },
    async remove(tx, userId, ids) {
      // The foreign key unlinks the account's transactions (SET NULL); their
      // serverUpdatedAt moves, so devices pull them unlinked too.
      await tx.bankAccount.deleteMany({ where: { userId, id: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "BankAccount" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])`;
    },
  },

  transactions: {
    async lockLive(tx, _userId, ids) {
      return liveRows(await tx.$queryRaw`
        SELECT "id" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "Transaction" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
    },
    async insert(tx, userId, ops, { ownAccounts }) {
      // One statement: the balance trigger is per statement, so a thousand
      // rows recompute each account once, not a thousand times.
      await tx.transaction.createMany({
        data: ops.map(({ id, cu, values: v }) => ({
          id, userId, accountId: resolveAccountId(v.accountId, ownAccounts), amount: v.amount,
          category: v.category, type: v.type, isImpulse: v.isImpulse, note: v.note, dateISO: v.dateISO,
          currency: v.currency, createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops, { ownAccounts }) {
      if (ops.length === 0) return;
      // One statement for the same reason as insert.
      const json = JSON.stringify(ops.map(({ id, cu, values: v }) => ({
        id, accountId: resolveAccountId(v.accountId, ownAccounts), amount: v.amount, category: v.category,
        type: v.type, isImpulse: v.isImpulse, note: v.note, dateISO: v.dateISO, currency: v.currency,
        createdAt: v.createdAt, cu,
      })));
      const ms = (col: string) => Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + v.${Prisma.raw(`"${col}"`)} * INTERVAL '1 millisecond')`;
      await tx.$executeRaw`
        UPDATE "Transaction" AS t SET
          "accountId" = v."accountId", "amount" = v."amount", "category" = v."category", "type" = v."type",
          "isImpulse" = v."isImpulse", "note" = v."note", "dateISO" = v."dateISO", "currency" = v."currency",
          "createdAt" = ${ms("createdAt")}, "clientUpdatedAt" = ${ms("cu")}, "updatedAt" = ${SQL_NOW}
          FROM jsonb_to_recordset(${json}::jsonb) AS v(
            "id" text, "accountId" text, "amount" double precision, "category" text, "type" text,
            "isImpulse" boolean, "note" text, "dateISO" text, "currency" text,
            "createdAt" double precision, "cu" double precision)
         WHERE t."id" = v."id" AND t."userId" = ${userId}`;
    },
    async remove(tx, userId, ids) {
      await tx.transaction.deleteMany({ where: { userId, id: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "Transaction" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])`;
    },
  },

  subscriptions: {
    async lockLive(tx, userId, ids) {
      return liveRows(await tx.$queryRaw`
        SELECT "syncId" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "Subscription" WHERE "userId" = ${userId} AND "syncId" = ANY(${ids}::text[])
         ORDER BY "syncId" FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      await tx.subscription.createMany({
        data: ops.map(({ id, cu, values }) => ({
          userId, syncId: id, ...values, createdAt: at(values.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      for (const { id, cu, values } of ops) {
        await tx.subscription.update({
          where: { userId_syncId: { userId, syncId: id } },
          data: { ...values, createdAt: at(values.createdAt), clientUpdatedAt: at(cu) },
        });
      }
    },
    async remove(tx, userId, ids) {
      await tx.subscription.deleteMany({ where: { userId, syncId: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "Subscription" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "syncId" = ANY(${ids}::text[])`;
    },
  },
};

/** The caller's tombstones of `ids` for one entity, locked. */
async function lockTombstones(tx: Tx, userId: string, entity: SyncEntity, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; cu: bigint }[]>`
    SELECT "syncId" AS id, ${cuOf("clientUpdatedAt")} AS cu
      FROM "SyncTombstone"
     WHERE "userId" = ${userId} AND "entity" = ${entity} AND "syncId" = ANY(${ids}::text[])
     ORDER BY "syncId" FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, Number(r.cu)]));
}

/** The caller's accounts among `ids` that exist now, locked against deletion. */
async function lockOwnAccounts(tx: Tx, userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BankAccount" WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])
     ORDER BY "id" FOR KEY SHARE`;
  return new Set(rows.map((r) => r.id));
}

/**
 * The winners a push must send back: every id answered `stale` that this push
 * does not write anyway (a later row for the same id may have won), split by
 * what it lost to. A stale answer means a live row or a tombstone was current,
 * and the live row is the current state when both exist.
 */
export function winnersToResend(
  plan: BatchPlan<unknown>,
  initial: ReadonlyMap<string, KeyState>
): { rows: string[]; tombstones: string[] } {
  const written = new Set(plan.ops.map((op) => op.id));
  const stale = new Set(plan.results.filter((r) => r.status === "stale" && !written.has(r.id)).map((r) => r.id));
  const rows: string[] = [];
  const tombstones: string[] = [];
  for (const id of [...stale].sort()) {
    const state = initial.get(id);
    if (state?.live) rows.push(id);
    else if (state?.tomb !== null && state?.tomb !== undefined) tombstones.push(id);
  }
  return { rows, tombstones };
}

async function writeOps<E extends SyncEntity>(
  tx: Tx, userId: string, entity: E, ops: WriteOp<SyncRowValues<E>>[], ctx: WriteContext,
  resend: { rows: string[]; tombstones: string[] }
): Promise<void> {
  const store = STORES[entity] as EntityStore<E>;
  const of = <K extends WriteOp<unknown>["kind"]>(kind: K) =>
    ops.filter((op): op is Extract<WriteOp<SyncRowValues<E>>, { kind: K }> => op.kind === kind);

  const deletes = of("delete");
  if (deletes.length > 0) {
    await store.remove(tx, userId, deletes.map((op) => op.id));
    // The trigger recorded the deleted rows' own times; the delete's is later.
    await stampTombstones(tx, userId, entity, deletes, { insertMissing: true });
  }
  await stampTombstones(tx, userId, entity, of("tombstone"), { insertMissing: true });

  const inserts = of("insert");
  const updates = of("update");
  await dropTombstones(tx, userId, entity, [...inserts, ...updates].filter((op) => op.dropTombstone).map((op) => op.id));
  if (inserts.length > 0) await store.insert(tx, userId, inserts, ctx);
  if (updates.length > 0) await store.update(tx, userId, updates, ctx);

  // Stale answers: send the winner back on the device's next pull.
  if (resend.rows.length > 0) await store.touch(tx, userId, resend.rows);
  await touchTombstones(tx, userId, entity, resend.tombstones);
}

/** Postgres and Prisma errors after which the same push may well succeed. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === "P2002" || err.code === "P2034") return true;
  // Raw statements report the SQLSTATE in the message: unique violation,
  // serialization failure, deadlock.
  return err.code === "P2010" && /\b(23505|40001|40P01)\b/.test(err.message);
}

const ATTEMPTS = 3;

/**
 * Apply one push for `userId`. `changes` is the request's `changes` object;
 * entities it does not name are left alone, keys this server does not know
 * are ignored.
 */
export async function applyPush(
  userId: string,
  changes: Partial<Record<SyncEntity, unknown[]>>
): Promise<PushResponse> {
  const parsed = Object.fromEntries(
    SYNC_ENTITIES.map((entity) => [entity, (changes[entity] ?? []).map((raw) => parsePushRow(entity, raw))])
  ) as { [E in SyncEntity]: BatchRow<SyncRowValues<E>>[] };

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sync-push:${userId}`}, 0))`;

          const plans = {} as { [E in SyncEntity]: BatchPlan<SyncRowValues<E>> };
          const resend = {} as Record<SyncEntity, { rows: string[]; tombstones: string[] }>;
          for (const entity of SYNC_ENTITIES) {
            const ids = [...new Set(parsed[entity].flatMap((p) => (p.ok ? [p.row.id] : [])))];
            const live = ids.length > 0 ? await STORES[entity].lockLive(tx, userId, ids) : new Map();
            const tombs = await lockTombstones(tx, userId, entity, ids);
            const initial = new Map<string, KeyState>(
              ids.map((id) => [id, { live: live.get(id) ?? null, tomb: tombs.get(id) ?? null }])
            );
            const plan = planBatch(parsed[entity] as BatchRow<unknown>[], initial, userId);
            (plans as Record<SyncEntity, BatchPlan<unknown>>)[entity] = plan;
            resend[entity] = winnersToResend(plan, initial);
          }

          const referenced = [...new Set(plans.transactions.ops.flatMap((op) =>
            (op.kind === "insert" || op.kind === "update") && op.values.accountId ? [op.values.accountId] : []))];
          const ctx: WriteContext = {
            ownAccounts: accountsAfter(await lockOwnAccounts(tx, userId, referenced), plans.accounts.ops),
          };

          for (const entity of SYNC_ENTITIES) {
            await writeOps(tx, userId, entity, plans[entity].ops as WriteOp<never>[], ctx, resend[entity]);
          }

          const results = Object.fromEntries(
            SYNC_ENTITIES.map((entity) => [entity, plans[entity].results])
          ) as PushResponse["results"];
          return { results, serverTime: toWireTimestamp(await databaseNowMs(tx)) };
        },
        { maxWait: 15_000, timeout: 60_000 }
      );
    } catch (err) {
      if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
    }
  }
}
