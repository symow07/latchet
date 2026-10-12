/**
 * The sync protocol's row schemas (PLAN.md I-WIRE), and the field rules the
 * REST routes share with them.
 *
 * One definition per field, used twice: the REST routes (transactions.ts,
 * accounts.ts, settings.ts, recurring.ts, bill-reminders.ts,
 * category-budgets.ts, net-worth.ts) wrap these with their own optional/default
 * handling, and SYNC_ROW_SCHEMAS requires every field, since a sync row is a
 * whole row and replaces the stored one — except a subscription's Phase 6
 * fields, which older phones do not send (subscriptionFields). A rule changed
 * here changes both.
 *
 * Dependency-free apart from zod: the root contract test imports this file on
 * its own to compare SYNC_ROW_SCHEMAS with the phone's SYNC_FIELDS, so nothing
 * here may pull in Prisma, auth or env.
 */
import { z } from "zod";
import { isoDate, transactionType, accountType, money, signedMoney, recurrenceFrequency, MAX_MONEY } from "../schemas";
import type { SyncEntity } from "./constants";
import {
  BILLED_VIA, SUBSCRIPTION_ALERTS, SUBSCRIPTION_DECISIONS, SUBSCRIPTION_STATUSES,
} from "./subscription-fields";

/** Half of a UTF-16 surrogate pair with no other half: not encodable as UTF-8. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * A string Postgres can store. Text columns refuse NUL (U+0000) and anything
 * that is not valid UTF-8 (a lone surrogate), and inside a sync push either
 * would abort the whole batch instead of failing one row.
 */
export function storableText(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !s.includes("\u0000") && !LONE_SURROGATE.test(s), "Text Postgres cannot store");
}

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Epoch milliseconds of an ISO-8601 date or UTC/offset date-time, or null.
 *
 * Strict on purpose: a date-time without a zone would be read in the server's
 * local time, so it is refused rather than guessed. Fractions beyond
 * milliseconds are truncated (the columns hold milliseconds). A date alone is
 * midnight UTC.
 */
export function parseIsoTimestamp(value: string): number | null {
  const m = ISO_TIMESTAMP.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const ms = (frac ?? "").padEnd(3, "0").slice(0, 3);
  const normalised = h === undefined
    ? `${y}-${mo}-${d}T00:00:00.000Z`
    : `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}.${ms}${zone}`;
  const parsed = Date.parse(normalised);
  if (!Number.isFinite(parsed)) return null;
  // Date.parse rolls 2026-02-31 over to March; a real date round-trips.
  if (h === undefined && new Date(parsed).toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null;
  return parsed;
}

/** An ISO timestamp on the wire, as epoch milliseconds once parsed. */
export const isoTimestamp = z
  .string()
  .max(40)
  .refine((s) => parseIsoTimestamp(s) !== null, "Expected an ISO-8601 timestamp with a zone")
  .transform((s) => parseIsoTimestamp(s)!);

/** Epoch milliseconds as the wire's ISO string: UTC, always with milliseconds. */
export function toWireTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * A YYYY-MM-DD date that exists on the calendar. The recurring job and the
 * bill checker do date arithmetic on these, and 2026-02-31 would send a
 * series somewhere nobody asked for.
 */
export const calendarDate = isoDate.refine((s) => parseIsoTimestamp(s) !== null, "Not a calendar date");

/** The most a net-worth breakdown may hold, as JSON text, however it is written. */
export const MAX_BREAKDOWN_CHARS = 10_000;

/** A net-worth breakdown: amounts by name. */
export const breakdownObject = z.record(z.string(), signedMoney);

/**
 * A breakdown as POST /net-worth accepts it: an object, stored as its JSON
 * text, which must fit what a push accepts (breakdownText) — or a phone that
 * pulled it could never push the snapshot back.
 */
export const breakdownInput = breakdownObject.refine(
  (b) => JSON.stringify(b).length <= MAX_BREAKDOWN_CHARS,
  `A breakdown may be at most ${MAX_BREAKDOWN_CHARS} characters as JSON`
);

/**
 * A net-worth breakdown on the wire: the JSON text of a breakdownObject, as
 * the column stores it (the phone parses it), or null.
 */
export const breakdownText = storableText(2, MAX_BREAKDOWN_CHARS)
  .refine((s) => {
    try {
      return breakdownObject.safeParse(JSON.parse(s)).success;
    } catch {
      return false;
    }
  }, "Expected the JSON text of an object of amounts")
  .nullable();

// ─── Field rules ─────────────────────────────────────────────────────────────

/** Transaction fields; the bounds the REST route has always applied. */
export const transactionFields = {
  amount: z.number().positive().max(1_000_000),
  // Free-form, not an enum: users create their own categories, and an enum
  // here once silently dropped every custom-category row during bulk sync.
  category: storableText(1, 50),
  type: transactionType,
  isImpulse: z.boolean(),
  note: storableText(0, 500).nullable(),
  dateISO: isoDate,
  // An id the caller does not own, or that does not exist, is stored as null
  // (the transaction is kept, unlinked): see resolveAccountId in push.ts.
  accountId: storableText(0, 200).nullable(),
  currency: storableText(1, 5),
};

/**
 * Account fields. `openingBalance` is the one balance input: the server
 * derives `balance` from it and the ledger (a trigger), so no client sends
 * `balance` and none is accepted here.
 */
export const accountFields = {
  name: storableText(1, 100),
  type: accountType,
  openingBalance: z.number(),
  currency: storableText(1, 5),
  color: storableText(0, 100),
  icon: storableText(0, 100),
  isDefault: z.boolean(),
};

/**
 * The supported UI languages. Must match SUPPORTED_LOCALES in
 * mobile/src/lib/i18n/core.ts; routes/settings.ts repeats the list where
 * locale-parity.test.ts reads it, and schemas.test.ts here checks the two agree.
 */
export const LOCALES = ["en", "fr", "zh", "ar"] as const;

/** Settings fields: the rules of routes/settings.ts, every one required. */
export const settingsFields = {
  monthlyBudget: z.number().min(0).max(MAX_MONEY),
  startingBalance: z.number().min(-MAX_MONEY).max(MAX_MONEY),
  hourlyValue: z.number().min(0).max(100_000),
  showTimeCost: z.boolean(),
  currency: storableText(1, 5),
  currencySymbol: storableText(1, 5),
  monthlyIncome: z.number().min(0).max(MAX_MONEY),
  savingsGoal: z.number().min(0).max(MAX_MONEY),
  spendingStyle: z.enum(["frugal", "moderate", "generous"]),
  // The goals onboarding offers (mobile/src/app/onboarding.tsx).
  primaryGoal: z.enum(["save", "track", "reduce_debt", "budget"]),
  locale: z.enum(LOCALES),
};

/** Custom category fields; the name is the row's sync id. */
export const categoryFields = {
  icon: storableText(0, 100),
  color: storableText(0, 100),
};

/**
 * Where a subscription was seen (SUBSCRIPTION_SOURCES: transaction, import,
 * bank, email, manual), and `sources`, a comma list of them or "". Lower-case
 * words rather than a fixed list: a source a newer phone knows must not make
 * the whole row unpushable here, as an enum once did for custom categories.
 */
const sourceName = storableText(1, 20).regex(/^[a-z_]+$/, "Expected a source");
const sourceList = storableText(0, 200).regex(/^(?:[a-z_]+(?:,[a-z_]+)*)?$/, "Expected a comma list of sources");

/**
 * Subscription fields, as the phone's detection writes them and its user
 * decides them (subscription-fields.ts says what each Phase 6 field means).
 *
 * The Phase 6 fields — decision through billedVia — are optional, the one
 * exception to "a sync row is a whole row": a phone that predates them sends
 * rows without them, and a field left out keeps the stored value rather than
 * becoming null (push.ts, resolveSubscriptionWrite). A phone that has them
 * always sends them, null included.
 */
export const subscriptionFields = {
  merchantDisplay: storableText(1, 200),
  merchantNormalized: storableText(0, 200),
  cadence: storableText(1, 20),
  typicalAmount: z.number().min(0).max(MAX_MONEY),
  currency: storableText(1, 5),
  confidenceScore: z.number(),
  lastChargedAt: storableText(0, 40).nullable(),
  nextExpectedAt: storableText(0, 40).nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  cancelUrl: storableText(0, 2000).nullable(),
  cancelNotes: storableText(0, 2000).nullable(),
  // Phase 5 phones send transaction or email; Phase 6 adds import, bank, manual.
  source: sourceName,
  decision: z.enum(SUBSCRIPTION_DECISIONS).nullable().optional(),
  canceledAt: calendarDate.nullable().optional(),
  trialEndsAt: calendarDate.nullable().optional(),
  previousAmount: z.number().min(0).max(MAX_MONEY).nullable().optional(),
  priceChangedAt: calendarDate.nullable().optional(),
  alert: z.enum(SUBSCRIPTION_ALERTS).nullable().optional(),
  sources: sourceList.optional(),
  billedVia: z.enum(BILLED_VIA).nullable().optional(),
};

/**
 * Recurring series fields (routes/recurring.ts). `nextDate` and `lastCreated`
 * are also written by the server when it books an occurrence; a push that
 * has not seen the latest booking does not move them back (push.ts).
 */
export const recurringFields = {
  // An account the caller does not own, or that does not exist, is stored as
  // null, as for transactions (resolveAccountId); REST refuses one with a 400.
  accountId: storableText(0, 200).nullable(),
  name: storableText(1, 100),
  amount: money,
  category: storableText(1, 50),
  type: transactionType,
  isImpulse: z.boolean(),
  frequency: recurrenceFrequency,
  startDate: calendarDate,
  nextDate: calendarDate,
  lastCreated: calendarDate.nullable(),
  isActive: z.boolean(),
  currency: storableText(1, 5),
};

/**
 * Bill reminder fields (routes/bill-reminders.ts). lastNotifiedAt is the
 * server's own and never on the wire.
 */
export const billReminderFields = {
  name: storableText(1, 100),
  amount: money,
  dueDay: z.number().int().min(1).max(31),
  category: storableText(1, 50),
  isRecurring: z.boolean(),
  isPaid: z.boolean(),
  /** ISO on the wire, epoch milliseconds once parsed. */
  paidAt: isoTimestamp.nullable(),
  nextDueDate: calendarDate,
};

/** Category budget fields; the category is the row's sync id. */
export const categoryBudgetFields = {
  amount: money,
  period: z.enum(["weekly", "monthly", "yearly"]),
};

/**
 * Net-worth snapshot fields. netWorth is always stored as assets −
 * liabilities, whatever was sent, as POST /net-worth computes it.
 */
export const netWorthFields = {
  date: calendarDate,
  assets: money,
  liabilities: money,
  netWorth: signedMoney,
  breakdown: breakdownText,
};

// ─── Sync rows ───────────────────────────────────────────────────────────────

/**
 * Every synced field per entity, without the envelope (`id`,
 * `clientUpdatedAt`, `deleted`). The phone's SYNC_FIELDS
 * (mobile/src/lib/sync/protocol.ts) must list exactly these keys; the root
 * contract test compares them.
 */
export const SYNC_ROW_SCHEMAS = {
  settings: z.object(settingsFields),
  categories: z.object({ ...categoryFields, createdAt: isoTimestamp }),
  accounts: z.object({ ...accountFields, createdAt: isoTimestamp }),
  transactions: z.object({ ...transactionFields, createdAt: isoTimestamp }),
  subscriptions: z.object({ ...subscriptionFields, createdAt: isoTimestamp }),
  recurring: z.object({ ...recurringFields, createdAt: isoTimestamp }),
  billReminders: z.object({ ...billReminderFields, createdAt: isoTimestamp }),
  categoryBudgets: z.object({ ...categoryBudgetFields, createdAt: isoTimestamp }),
  netWorth: z.object({ ...netWorthFields, createdAt: isoTimestamp }),
} satisfies Record<SyncEntity, z.ZodObject>;

export type SyncRowValues<E extends SyncEntity> = z.output<(typeof SYNC_ROW_SCHEMAS)[E]>;

/**
 * The sync id of a row per entity: the settings row is always "settings", a
 * category is keyed by its name (1–50, as on the phone) and a category budget
 * by its category, anything else by its id — minted by the phone, or by the
 * server for a row made over REST (rec_…, bill_…, nw_…; any existing id).
 *
 * A recurring series' id is at most 100 characters because its occurrences
 * are named tx_rec_<id>_<YYYY-MM-DD>, and those must fit the 200 of a
 * transaction id.
 */
const SYNC_ID_RULES: Record<SyncEntity, z.ZodType<string>> = {
  settings: z.literal("settings"),
  categories: storableText(1, 50),
  accounts: storableText(1, 200),
  transactions: storableText(1, 200),
  subscriptions: storableText(1, 200),
  recurring: storableText(1, 100),
  billReminders: storableText(1, 200),
  categoryBudgets: storableText(1, 50),
  netWorth: storableText(1, 200),
};

/** One pushed row, validated: an upsert with its values, or a delete. */
export type PushedRow<E extends SyncEntity = SyncEntity> =
  | { id: string; clientUpdatedAt: number; deleted: true }
  | { id: string; clientUpdatedAt: number; deleted: false; values: SyncRowValues<E> };

export type ParsedPushRow<E extends SyncEntity = SyncEntity> =
  | { ok: true; row: PushedRow<E> }
  | { ok: false; id: string };

/**
 * Validate one pushed row. A failure still reports the id it was sent with
 * (or "" when it had none), so the client can attach the error to its row.
 */
export function parsePushRow<E extends SyncEntity>(entity: E, raw: unknown): ParsedPushRow<E> {
  const rawId = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
  const reportedId = typeof rawId === "string" ? rawId : rawId === undefined || rawId === null ? "" : String(rawId);

  const envelope = z
    .object({ id: SYNC_ID_RULES[entity] as z.ZodType<string>, clientUpdatedAt: isoTimestamp, deleted: z.boolean().optional() })
    .safeParse(raw);
  if (!envelope.success) return { ok: false, id: reportedId };
  const { id, clientUpdatedAt, deleted } = envelope.data as { id: string; clientUpdatedAt: number; deleted?: boolean };

  if (deleted === true) return { ok: true, row: { id, clientUpdatedAt, deleted: true } };

  const values = SYNC_ROW_SCHEMAS[entity].safeParse(raw);
  if (!values.success) return { ok: false, id: reportedId };
  return {
    ok: true,
    row: { id, clientUpdatedAt, deleted: false, values: values.data as SyncRowValues<E> },
  };
}
