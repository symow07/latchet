/**
 * GET /sync/pull: one page of the caller's live rows and tombstones after a
 * cursor, in (t, entity, id) order. The ordering, the cursor and the safety
 * lag are explained in cursor.ts; this file reads the page.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { PULL_SAFETY_LAG_MS, SYNC_ENTITIES, type SyncEntity } from "./constants";
import {
  compareKeys, cutPage, decodeCursor, encodeCursor, planPull, userTag,
  type PullPlan, type SyncKey,
} from "./cursor";
import { databaseNowMs, sqlMillis, sqlTimestamp, type Db } from "./sql";
import { toWireTimestamp } from "./schemas";

export type WireRow = { id: string; clientUpdatedAt: string } & Record<string, unknown>;

export interface PullResponse {
  changes: Record<SyncEntity, WireRow[]>;
  deletions: { entity: SyncEntity; id: string; clientUpdatedAt: string }[];
  cursor: string;
  hasMore: boolean;
  fullResync: boolean;
  serverTime: string;
}

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid sync cursor");
  }
}

interface Item extends SyncKey {
  e: SyncEntity;
  deleted: boolean;
  data: Record<string, unknown>;
}

/** How each synced table is read: its sync id and its wire fields. */
const SOURCES: Record<SyncEntity, { table: Prisma.Sql; key: Prisma.Sql; fields: Prisma.Sql }> = {
  settings: {
    table: Prisma.sql`"UserSettings"`,
    key: Prisma.sql`'settings'::text`,
    fields: Prisma.sql`jsonb_build_object(
      'monthlyBudget', x."monthlyBudget", 'startingBalance', x."startingBalance",
      'hourlyValue', x."hourlyValue", 'showTimeCost', x."showTimeCost",
      'currency', x."currency", 'currencySymbol', x."currencySymbol",
      'monthlyIncome', x."monthlyIncome", 'savingsGoal', x."savingsGoal",
      'spendingStyle', x."spendingStyle", 'primaryGoal', x."primaryGoal", 'locale', x."locale",
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  categories: {
    table: Prisma.sql`"CustomCategory"`,
    key: Prisma.sql`x."name"`,
    fields: Prisma.sql`jsonb_build_object(
      'icon', x."icon", 'color', x."color",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  accounts: {
    // openingBalance, never balance: the phone derives balance itself (decision 4).
    table: Prisma.sql`"BankAccount"`,
    key: Prisma.sql`x."id"`,
    fields: Prisma.sql`jsonb_build_object(
      'name', x."name", 'type', x."type", 'openingBalance', x."openingBalance",
      'currency', x."currency", 'color', x."color", 'icon', x."icon", 'isDefault', x."isDefault",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  transactions: {
    table: Prisma.sql`"Transaction"`,
    key: Prisma.sql`x."id"`,
    fields: Prisma.sql`jsonb_build_object(
      'amount', x."amount", 'category', x."category", 'type', x."type",
      'isImpulse', x."isImpulse", 'note', x."note", 'dateISO', x."dateISO",
      'accountId', x."accountId", 'currency', x."currency",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  subscriptions: {
    // The Phase 6 fields always go out, null included: a phone that predates
    // them ignores them, one that has them stores them as sent.
    table: Prisma.sql`"Subscription"`,
    key: Prisma.sql`x."syncId"`,
    fields: Prisma.sql`jsonb_build_object(
      'merchantDisplay', x."merchantDisplay", 'merchantNormalized', x."merchantNormalized",
      'cadence', x."cadence", 'typicalAmount', x."typicalAmount", 'currency', x."currency",
      'confidenceScore', x."confidenceScore", 'lastChargedAt', x."lastChargedAt",
      'nextExpectedAt', x."nextExpectedAt", 'status', x."status",
      'cancelUrl', x."cancelUrl", 'cancelNotes', x."cancelNotes", 'source', x."source",
      'decision', x."decision", 'canceledAt', x."canceledAt", 'trialEndsAt', x."trialEndsAt",
      'previousAmount', x."previousAmount", 'priceChangedAt', x."priceChangedAt", 'alert', x."alert",
      'sources', x."sources", 'billedVia', x."billedVia",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  // The four Phase 4 entities (I-WIRE-4): booleans as booleans, dates as
  // YYYY-MM-DD, paidAt as ISO or null, breakdown as the stored JSON text.
  recurring: {
    table: Prisma.sql`"RecurringTransaction"`,
    key: Prisma.sql`x."id"`,
    fields: Prisma.sql`jsonb_build_object(
      'accountId', x."accountId", 'name', x."name", 'amount', x."amount", 'category', x."category",
      'type', x."type", 'isImpulse', x."isImpulse", 'frequency', x."frequency",
      'startDate', x."startDate", 'nextDate', x."nextDate", 'lastCreated', x."lastCreated",
      'isActive', x."isActive", 'currency', x."currency",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  billReminders: {
    // lastNotifiedAt stays on the server: it is the notifier's, not the user's.
    table: Prisma.sql`"BillReminder"`,
    key: Prisma.sql`x."id"`,
    fields: Prisma.sql`jsonb_build_object(
      'name', x."name", 'amount', x."amount", 'dueDay', x."dueDay", 'category', x."category",
      'isRecurring', x."isRecurring", 'isPaid', x."isPaid",
      'paidAt', ${sqlMillis(Prisma.sql`x."paidAt"`)}, 'nextDueDate', x."nextDueDate",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  categoryBudgets: {
    // Keyed by category; the row's own id never leaves the server.
    table: Prisma.sql`"CategoryBudget"`,
    key: Prisma.sql`x."category"`,
    fields: Prisma.sql`jsonb_build_object(
      'amount', x."amount", 'period', x."period",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
  netWorth: {
    table: Prisma.sql`"NetWorthEntry"`,
    key: Prisma.sql`x."id"`,
    fields: Prisma.sql`jsonb_build_object(
      'date', x."date", 'assets', x."assets", 'liabilities', x."liabilities",
      'netWorth', x."netWorth", 'breakdown', x."breakdown",
      'createdAt', ${sqlMillis(Prisma.sql`x."createdAt"`)},
      'clientUpdatedAt', ${sqlMillis(Prisma.sql`x."clientUpdatedAt"`)})`,
  },
};

/** Whether a live row with the tombstone's sync id exists, per entity. */
const LIVE_FOR_TOMBSTONE: Record<SyncEntity, Prisma.Sql> = {
  settings: Prisma.sql`SELECT 1 FROM "UserSettings" x WHERE x."userId" = s."userId"`,
  categories: Prisma.sql`SELECT 1 FROM "CustomCategory" x WHERE x."userId" = s."userId" AND x."name" = s."syncId"`,
  accounts: Prisma.sql`SELECT 1 FROM "BankAccount" x WHERE x."userId" = s."userId" AND x."id" = s."syncId"`,
  transactions: Prisma.sql`SELECT 1 FROM "Transaction" x WHERE x."userId" = s."userId" AND x."id" = s."syncId"`,
  subscriptions: Prisma.sql`SELECT 1 FROM "Subscription" x WHERE x."userId" = s."userId" AND x."syncId" = s."syncId"`,
  recurring: Prisma.sql`SELECT 1 FROM "RecurringTransaction" x WHERE x."userId" = s."userId" AND x."id" = s."syncId"`,
  billReminders: Prisma.sql`SELECT 1 FROM "BillReminder" x WHERE x."userId" = s."userId" AND x."id" = s."syncId"`,
  categoryBudgets: Prisma.sql`SELECT 1 FROM "CategoryBudget" x WHERE x."userId" = s."userId" AND x."category" = s."syncId"`,
  netWorth: Prisma.sql`SELECT 1 FROM "NetWorthEntry" x WHERE x."userId" = s."userId" AND x."id" = s."syncId"`,
};

/**
 * "Strictly after `after`" for one table whose items all carry the same
 * entity: the entity is a constant there, so the three-part comparison
 * collapses to a range on t (index-friendly) plus, at most, an id comparison.
 */
function afterCondition(entity: SyncEntity, t: Prisma.Sql, key: Prisma.Sql, after: SyncKey | null): Prisma.Sql {
  if (!after) return Prisma.empty;
  const at = sqlTimestamp(after.t);
  const order = compareKeys({ t: 0, e: entity, k: "" }, { t: 0, e: after.e, k: "" });
  if (order > 0) return Prisma.sql`AND ${t} >= ${at}`;
  if (order < 0) return Prisma.sql`AND ${t} > ${at}`;
  return Prisma.sql`AND ${t} >= ${at} AND (${t} > ${at} OR ${key} COLLATE "C" > ${after.k} COLLATE "C")`;
}

/**
 * Read up to `n` items after `plan.after`, in pull order, in one statement —
 * one snapshot, so a row and its tombstone can never both appear in a page.
 */
async function readItems(db: Db, userId: string, plan: PullPlan, n: number): Promise<Item[]> {
  const branches = SYNC_ENTITIES.map((entity) => {
    const src = SOURCES[entity];
    const t = Prisma.sql`x."serverUpdatedAt"`;
    return Prisma.sql`(
      SELECT ${sqlMillis(t)} AS t, ${entity}::text AS e, ${src.key} AS k, false AS d, ${src.fields} AS data
        FROM ${src.table} x
       WHERE x."userId" = ${userId} ${afterCondition(entity, t, src.key, plan.after)}
       ORDER BY ${t}, ${src.key} COLLATE "C"
       LIMIT ${n})`;
  });

  if (!plan.snapshot) {
    // A tombstone whose row is live again (re-created after the delete, by a
    // push or by the server) is not sent: the live row is the truth, and it is
    // sent in its own place. Without this, a re-create stamped just before a
    // concurrent delete's tombstone would reach the phone as row-then-delete.
    const t = Prisma.sql`s."deletedAt"`;
    const after = plan.after;
    const position = after
      ? Prisma.sql`AND ${t} >= ${sqlTimestamp(after.t)} AND (
          ${t} > ${sqlTimestamp(after.t)}
          OR s."entity" COLLATE "C" > ${after.e} COLLATE "C"
          OR (s."entity" = ${after.e} AND s."syncId" COLLATE "C" > ${after.k} COLLATE "C"))`
      : Prisma.empty;
    const notLive = Prisma.join(
      SYNC_ENTITIES.map((entity) => Prisma.sql`(s."entity" = ${entity} AND EXISTS (${LIVE_FOR_TOMBSTONE[entity]}))`),
      " OR "
    );
    branches.push(Prisma.sql`(
      SELECT ${sqlMillis(t)} AS t, s."entity" AS e, s."syncId" AS k, true AS d,
             jsonb_build_object('clientUpdatedAt', ${sqlMillis(Prisma.sql`s."clientUpdatedAt"`)}) AS data
        FROM "SyncTombstone" s
       WHERE s."userId" = ${userId} ${position}
         AND s."entity" IN (${Prisma.join([...SYNC_ENTITIES])})
         AND NOT (${notLive})
       ORDER BY ${t}, s."entity" COLLATE "C", s."syncId" COLLATE "C"
       LIMIT ${n})`);
  }

  const rows = await db.$queryRaw<{ t: bigint; e: SyncEntity; k: string; d: boolean; data: Record<string, unknown> }[]>`
    SELECT t, e, k, d, data FROM (${Prisma.join(branches, " UNION ALL ")}) AS items
     ORDER BY t, e COLLATE "C", k COLLATE "C"
     LIMIT ${n}`;
  return rows.map((r) => ({ t: Number(r.t), e: r.e, k: r.k, deleted: r.d, data: r.data }));
}

/**
 * The wire fields read as epoch milliseconds (sqlMillis) and sent as ISO
 * timestamps; null stays null.
 */
const TIMESTAMP_FIELDS = ["createdAt", "paidAt"] as const;

/** A row as the phone receives it: sync id, ISO timestamps. */
function toWireRow(item: Item): WireRow {
  const { clientUpdatedAt, ...fields } = item.data as { clientUpdatedAt: number } & Record<string, unknown>;
  for (const field of TIMESTAMP_FIELDS) {
    if (!(field in fields)) continue;
    const ms = fields[field];
    fields[field] = ms === null ? null : toWireTimestamp(Number(ms));
  }
  return { id: item.k, clientUpdatedAt: toWireTimestamp(Number(clientUpdatedAt)), ...fields };
}

/**
 * One pull page for `userId`. `cursorParam` is the request's cursor (undefined
 * or "" for none); throws InvalidCursorError for one this server never issued.
 */
export async function pullPage(
  userId: string,
  cursorParam: string | undefined,
  limit: number,
  db: Db = prisma
): Promise<PullResponse> {
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  if (cursorParam && !cursor) throw new InvalidCursorError();

  // The clock is read before the page, so everything stamped before the
  // horizon had committed by the time the page's snapshot was taken.
  const nowMs = await databaseNowMs(db);
  const tag = userTag(userId);
  const plan = planPull(cursor, tag, nowMs);
  const read = await readItems(db, userId, plan, limit + 1);
  const page = cutPage(read, limit, plan, tag, nowMs - PULL_SAFETY_LAG_MS);

  const changes = Object.fromEntries(SYNC_ENTITIES.map((e) => [e, [] as WireRow[]])) as Record<SyncEntity, WireRow[]>;
  const deletions: PullResponse["deletions"] = [];
  for (const item of page.items) {
    if (item.deleted) {
      deletions.push({
        entity: item.e,
        id: item.k,
        clientUpdatedAt: toWireTimestamp(Number(item.data.clientUpdatedAt)),
      });
    } else {
      changes[item.e].push(toWireRow(item));
    }
  }

  return {
    changes,
    deletions,
    cursor: encodeCursor(page.cursor),
    hasMore: page.hasMore,
    fullResync: plan.snapshot,
    serverTime: toWireTimestamp(nowMs),
  };
}
