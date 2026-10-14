import { z } from "zod";

/**
 * Field-level building blocks shared by the route schemas.
 *
 * Several routes previously splatted `await c.req.json()` straight into Prisma,
 * which meant a missing field became `undefined`, arithmetic on it became NaN,
 * and NaN was written to the database as a permanent, unfixable value.
 * Zod rejects NaN and Infinity for `z.number()` by default, so validating at
 * the edge closes that whole class.
 */

export const MAX_MONEY = 10_000_000;

/** A non-negative monetary amount. */
export const money = z.number().min(0).max(MAX_MONEY);

/** A monetary amount that may be negative (balances, net worth). */
export const signedMoney = z.number().min(-MAX_MONEY).max(MAX_MONEY);

/** Category names are free-form — users can define their own. */
export const categoryName = z.string().min(1).max(50);

/** YYYY-MM-DD, the app's date format everywhere. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const transactionType = z.enum(["Expense", "Income"]);

export const recurrenceFrequency = z.enum([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
]);

export const accountType = z.enum([
  "cash",
  "checking",
  "savings",
  "credit",
  "investment",
  "loan",
  "other",
]);

/**
 * Upper bound on rows accepted by a bulk-sync endpoint.
 *
 * The sync routes accepted unbounded arrays and ran a findUnique per row in a
 * serial loop before a single $transaction — 10,000 rows meant 10,000
 * sequential database round-trips inside one request before the write began.
 *
 * Defined once, with the rest of the sync protocol's constants.
 */
export { MAX_SYNC_ROWS } from "./sync/constants";
