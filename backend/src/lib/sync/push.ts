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
 * write, a bank sync, the recurring job or the bill checker cannot change them
 * between the decision and the write. Two different users can still race on a
 * brand-new global id (or one user's REST route and push on a new category
 * budget); the loser fails on the unique key and the whole push is retried,
 * when it sees the other row and gets `forbidden` (or decides against it).
 *
 * Lock order against the recurring booking (jobs/recurring-booking.ts), which
 * takes its account FOR KEY SHARE and then claims (updates) the series row.
 * The push takes, in entity order, the accounts it writes FOR UPDATE before
 * any series row, and the accounts its transactions and series only name FOR
 * KEY SHARE after them (lockOwnAccounts). The one conflicting pair is its FOR
 * UPDATE against the booking's KEY SHARE, and the push holds no series row
 * while it waits there, so the booking never waits on a push that waits on
 * it. KEY SHARE conflicts with neither KEY SHARE nor the NO KEY UPDATE the
 * balance trigger takes, so the rest of either side's locks cannot close a
 * cycle.
 *
 * Server writes win (Phase 4 decision 4): every server-side write to a synced
 * row stamps clientUpdatedAt from the database clock, so a phone's copy made
 * before it is answered `stale` here like any older edit.
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
import { PHASE6_SUBSCRIPTION_FIELDS, resolveSubscriptionWrite, type Phase6SubscriptionColumns } from "./subscription-fields";

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
  /**
   * The caller's accounts once this push's accounts are applied, among those
   * the push's transactions and recurring series name.
   */
  ownAccounts: ReadonlySet<string>;
}

const at = (ms: number) => new Date(ms);
const cuOf = (column: string) => sqlMillis(Prisma.raw(`"${column}"`));
/**
 * Column `col` of the jsonb_to_recordset row `v`, epoch milliseconds, as a
 * UTC timestamp(3) — never through a JS Date (sql.ts). NULL stays NULL.
 */
const recordMs = (col: string) =>
  Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + v.${Prisma.raw(`"${col}"`)} * INTERVAL '1 millisecond')`;

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
      await tx.$executeRaw`
        UPDATE "Transaction" AS t SET
          "accountId" = v."accountId", "amount" = v."amount", "category" = v."category", "type" = v."type",
          "isImpulse" = v."isImpulse", "note" = v."note", "dateISO" = v."dateISO", "currency" = v."currency",
          "createdAt" = ${recordMs("createdAt")}, "clientUpdatedAt" = ${recordMs("cu")}, "updatedAt" = ${SQL_NOW}
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
    // The Phase 6 fields go through resolveSubscriptionWrite: a phone that
    // predates them leaves them out, which keeps what is stored (and, for a
    // row without a decision yet, reads its status as one), and the status
    // follows the decision whatever was sent.
    async insert(tx, userId, ops) {
      await tx.subscription.createMany({
        data: ops.map(({ id, cu, values }) => ({
          userId, syncId: id, ...subscriptionColumns(values, null),
          createdAt: at(values.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      if (ops.length === 0) return;
      // Locked FOR UPDATE by lockLive in this transaction, so nothing changes
      // them between this read and the write.
      const stored = new Map(
        (await tx.subscription.findMany({
          where: { userId, syncId: { in: ops.map((op) => op.id) } },
          select: { syncId: true, ...PHASE6_SELECT },
        })).map(({ syncId, ...columns }) => [syncId, columns])
      );
      for (const { id, cu, values } of ops) {
        await tx.subscription.update({
          where: { userId_syncId: { userId, syncId: id } },
          data: {
            ...subscriptionColumns(values, stored.get(id) ?? null),
            createdAt: at(values.createdAt), clientUpdatedAt: at(cu),
          },
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

  recurring: {
    async lockLive(tx, _userId, ids) {
      // By id alone: ids are global (rec_…, minted by a phone or by
      // POST /recurring), and another user's must be seen to be refused.
      return liveRows(await tx.$queryRaw`
        SELECT "id" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "RecurringTransaction" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
    },
    async insert(tx, userId, ops, { ownAccounts }) {
      await tx.recurringTransaction.createMany({
        data: ops.map(({ id, cu, values: v }) => ({
          id, userId, accountId: resolveAccountId(v.accountId, ownAccounts), name: v.name, amount: v.amount,
          category: v.category, type: v.type, isImpulse: v.isImpulse, frequency: v.frequency,
          startDate: v.startDate, nextDate: v.nextDate, lastCreated: v.lastCreated, isActive: v.isActive,
          currency: v.currency, createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops, { ownAccounts }) {
      if (ops.length === 0) return;
      // The booking state (nextDate, lastCreated) is the server's as much as
      // the phone's: the job and run-now move it, stamping the database
      // clock. A phone that edits a series before pulling that booking still
      // carries the older state, and its edit can be the later one. Applied
      // as sent, it would move the series back to a date already booked and
      // the job would book the next day again. So when the row says it has
      // booked later than the phone knows (lastCreated behind the stored
      // one, or null), the stored nextDate and lastCreated are kept and
      // the rest of the edit applies. The phone pulls the merged row, since
      // this write moves its serverUpdatedAt. routes/recurring.ts applies
      // the same rule (keepsBookingState).
      const json = JSON.stringify(ops.map(({ id, cu, values: v }) => ({
        id, accountId: resolveAccountId(v.accountId, ownAccounts), name: v.name, amount: v.amount,
        category: v.category, type: v.type, isImpulse: v.isImpulse, frequency: v.frequency,
        startDate: v.startDate, nextDate: v.nextDate, lastCreated: v.lastCreated, isActive: v.isActive,
        currency: v.currency, createdAt: v.createdAt, cu,
      })));
      const behind = Prisma.sql`(r."lastCreated" IS NOT NULL AND
        (v."lastCreated" IS NULL OR v."lastCreated" COLLATE "C" < r."lastCreated" COLLATE "C"))`;
      await tx.$executeRaw`
        UPDATE "RecurringTransaction" AS r SET
          "accountId" = v."accountId", "name" = v."name", "amount" = v."amount", "category" = v."category",
          "type" = v."type", "isImpulse" = v."isImpulse", "frequency" = v."frequency", "startDate" = v."startDate",
          "nextDate" = CASE WHEN ${behind} THEN r."nextDate" ELSE v."nextDate" END,
          "lastCreated" = CASE WHEN ${behind} THEN r."lastCreated" ELSE v."lastCreated" END,
          "isActive" = v."isActive", "currency" = v."currency",
          "createdAt" = ${recordMs("createdAt")}, "clientUpdatedAt" = ${recordMs("cu")}, "updatedAt" = ${SQL_NOW}
          FROM jsonb_to_recordset(${json}::jsonb) AS v(
            "id" text, "accountId" text, "name" text, "amount" double precision, "category" text,
            "type" text, "isImpulse" boolean, "frequency" text, "startDate" text, "nextDate" text,
            "lastCreated" text, "isActive" boolean, "currency" text,
            "createdAt" double precision, "cu" double precision)
         WHERE r."id" = v."id" AND r."userId" = ${userId}`;
    },
    async remove(tx, userId, ids) {
      // Occurrences already booked stay in the ledger: they are transactions.
      await tx.recurringTransaction.deleteMany({ where: { userId, id: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "RecurringTransaction" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])`;
    },
  },

  billReminders: {
    async lockLive(tx, _userId, ids) {
      return liveRows(await tx.$queryRaw`
        SELECT "id" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "BillReminder" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      // lastNotifiedAt starts unset: a new bill notifies when it falls due.
      await tx.billReminder.createMany({
        data: ops.map(({ id, cu, values: v }) => ({
          id, userId, name: v.name, amount: v.amount, dueDay: v.dueDay, category: v.category,
          isRecurring: v.isRecurring, isPaid: v.isPaid, paidAt: v.paidAt === null ? null : at(v.paidAt),
          nextDueDate: v.nextDueDate, createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      if (ops.length === 0) return;
      // lastNotifiedAt is the server's (not on the wire). An edit that moves
      // nextDueDate later re-arms the notifier for the new date; any other
      // edit keeps it, so moving a bill back to a date it already fired for,
      // or re-sending the same date, does not fire it again. The REST route
      // applies the same rule (rearmsNotifier in jobs/bill-reminder-checker).
      const json = JSON.stringify(ops.map(({ id, cu, values: v }) => ({
        id, name: v.name, amount: v.amount, dueDay: v.dueDay, category: v.category, isRecurring: v.isRecurring,
        isPaid: v.isPaid, paidAt: v.paidAt, nextDueDate: v.nextDueDate, createdAt: v.createdAt, cu,
      })));
      await tx.$executeRaw`
        UPDATE "BillReminder" AS b SET
          "name" = v."name", "amount" = v."amount", "dueDay" = v."dueDay", "category" = v."category",
          "isRecurring" = v."isRecurring", "isPaid" = v."isPaid", "paidAt" = ${recordMs("paidAt")},
          "lastNotifiedAt" = CASE WHEN v."nextDueDate" COLLATE "C" > b."nextDueDate" COLLATE "C"
                                  THEN NULL ELSE b."lastNotifiedAt" END,
          "nextDueDate" = v."nextDueDate",
          "createdAt" = ${recordMs("createdAt")}, "clientUpdatedAt" = ${recordMs("cu")}, "updatedAt" = ${SQL_NOW}
          FROM jsonb_to_recordset(${json}::jsonb) AS v(
            "id" text, "name" text, "amount" double precision, "dueDay" integer, "category" text,
            "isRecurring" boolean, "isPaid" boolean, "paidAt" double precision, "nextDueDate" text,
            "createdAt" double precision, "cu" double precision)
         WHERE b."id" = v."id" AND b."userId" = ${userId}`;
    },
    async remove(tx, userId, ids) {
      await tx.billReminder.deleteMany({ where: { userId, id: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "BillReminder" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])`;
    },
  },

  categoryBudgets: {
    async lockLive(tx, userId, ids) {
      // Keyed by category within the caller's rows: two users' "Food" budgets
      // are two rows, as with category names.
      return liveRows(await tx.$queryRaw`
        SELECT "category" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "CategoryBudget" WHERE "userId" = ${userId} AND "category" = ANY(${ids}::text[])
         ORDER BY "category" FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      // The row id is the server's own and never on the wire.
      await tx.categoryBudget.createMany({
        data: ops.map(({ id, cu, values: v }) => ({
          id: newCategoryBudgetId(), userId, category: id, amount: v.amount, period: v.period,
          createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      for (const { id, cu, values: v } of ops) {
        await tx.categoryBudget.update({
          where: { userId_category: { userId, category: id } },
          data: { amount: v.amount, period: v.period, createdAt: at(v.createdAt), clientUpdatedAt: at(cu) },
        });
      }
    },
    async remove(tx, userId, ids) {
      await tx.categoryBudget.deleteMany({ where: { userId, category: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "CategoryBudget" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "category" = ANY(${ids}::text[])`;
    },
  },

  netWorth: {
    async lockLive(tx, _userId, ids) {
      return liveRows(await tx.$queryRaw`
        SELECT "id" AS id, "userId" AS owner, ${cuOf("clientUpdatedAt")} AS cu
          FROM "NetWorthEntry" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
    },
    async insert(tx, userId, ops) {
      await tx.netWorthEntry.createMany({
        data: ops.map(({ id, cu, values: v }) => ({
          id, userId, ...netWorthColumns(v), createdAt: at(v.createdAt), clientUpdatedAt: at(cu),
        })),
      });
    },
    async update(tx, userId, ops) {
      for (const { id, cu, values: v } of ops) {
        await tx.netWorthEntry.update({
          where: { id, userId },
          data: { ...netWorthColumns(v), createdAt: at(v.createdAt), clientUpdatedAt: at(cu) },
        });
      }
    },
    async remove(tx, userId, ids) {
      await tx.netWorthEntry.deleteMany({ where: { userId, id: { in: ids } } });
    },
    async touch(tx, userId, ids) {
      await tx.$executeRaw`
        UPDATE "NetWorthEntry" SET "serverUpdatedAt" = "serverUpdatedAt"
         WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])`;
    },
  },
};

/** A category budget's row id: the server's own, never on the wire. */
export function newCategoryBudgetId(): string {
  return `catbud_${crypto.randomUUID()}`;
}

/** The Phase 6 columns of a stored subscription, as a Prisma select. */
const PHASE6_SELECT = Object.fromEntries(PHASE6_SUBSCRIPTION_FIELDS.map((f) => [f, true])) as {
  [F in (typeof PHASE6_SUBSCRIPTION_FIELDS)[number]]: true;
};

/**
 * A pushed subscription's stored columns, but createdAt and clientUpdatedAt.
 * `stored` is the live row's Phase 6 columns, or null when the push creates it.
 */
function subscriptionColumns(v: SyncRowValues<"subscriptions">, stored: Phase6SubscriptionColumns | null) {
  return {
    merchantDisplay: v.merchantDisplay, merchantNormalized: v.merchantNormalized, cadence: v.cadence,
    typicalAmount: v.typicalAmount, currency: v.currency, confidenceScore: v.confidenceScore,
    lastChargedAt: v.lastChargedAt, nextExpectedAt: v.nextExpectedAt, cancelUrl: v.cancelUrl,
    cancelNotes: v.cancelNotes, source: v.source,
    ...resolveSubscriptionWrite(v, stored),
  };
}

/** A net-worth snapshot's stored columns: netWorth is always assets − liabilities. */
function netWorthColumns(v: SyncRowValues<"netWorth">) {
  return {
    date: v.date, assets: v.assets, liabilities: v.liabilities,
    netWorth: v.assets - v.liabilities, breakdown: v.breakdown,
  };
}

/** The account ids that a batch's upserts name. */
function accountRefs(ops: readonly WriteOp<{ accountId: string | null }>[]): string[] {
  return ops.flatMap((op) => (op.kind === "insert" || op.kind === "update") && op.values.accountId ? [op.values.accountId] : []);
}

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

          const referenced = [...new Set([
            ...accountRefs(plans.transactions.ops), ...accountRefs(plans.recurring.ops),
          ])];
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
