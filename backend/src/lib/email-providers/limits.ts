/**
 * Bounds on how much mail one connection reads. Billing mail is small; these
 * keep a huge mailbox, or one enormous message, from costing more than the
 * findings are worth.
 */

/** Messages larger than this are skipped, never downloaded in full (a PDF invoice is far smaller). */
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

/** The one-year backfill downloads at most this many messages. */
export const BACKFILL_MAX_MESSAGES = 1_500;

/** Outlook lists every message to prefilter on headers: at most this many in the backfill. */
export const BACKFILL_MAX_LISTED = 30_000;

/** One incremental pass downloads at most this many. */
export const INCREMENTAL_MAX_MESSAGES = 500;

/** An incremental pass re-reads this much before the last one, so nothing slips between passes. */
export const INCREMENTAL_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** How far back the first sync reads. */
export const BACKFILL_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/** Messages downloaded and parsed at once. */
export const FETCH_CONCURRENCY = 4;

/** AI fallback calls per user per day (OPENAI_API_KEY set). */
export const AI_DAILY_CAP_PER_USER = 40;

/** Manual syncs: one per connection per minute. */
export const MANUAL_SYNC_WINDOW_MS = 60_000;
