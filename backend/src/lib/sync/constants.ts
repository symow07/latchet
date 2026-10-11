/**
 * The sync protocol's fixed values, shared by every server module that reads
 * or writes synced rows (PLAN.md I-SRV-SCHEMA and I-WIRE).
 */

/**
 * The entities the phone syncs, in the order a push is applied: settings and
 * categories first, accounts before the transactions and recurring series
 * that reference them, then subscriptions, and the four Phase 4 entities
 * (Phase 4 decision 1, I-WIRE-4) after the five of Phase 3.
 *
 * A phone that predates an entity ignores its rows in a pull; a deletion of
 * one it reports as an apply error and moves on (the cursor still advances).
 */
export const SYNC_ENTITIES = [
  'settings', 'categories', 'accounts', 'transactions', 'subscriptions',
  'recurring', 'billReminders', 'categoryBudgets', 'netWorth',
] as const;

export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/** Most rows one push may carry, across all entities (413 above it). */
export const MAX_SYNC_ROWS = 1000;

/** Rows and tombstones per pull page when the client names no limit. */
export const PULL_PAGE_DEFAULT = 500;

/**
 * How far behind the database clock a pull cursor is held. serverUpdatedAt is
 * stamped when a row is written, not when its transaction commits, so a write
 * still committing while a page is read can carry an earlier stamp than rows
 * already returned. Holding the cursor back re-sends that window on the next
 * pull; applying is idempotent.
 */
export const PULL_SAFETY_LAG_MS = 5000;

/**
 * How long a tombstone is kept. A client whose cursor is older than this gets a
 * full resync instead of deletions, since some of its deletions may be gone.
 */
export const TOMBSTONE_RETENTION_DAYS = 60;

/**
 * clientUpdatedAt of rows a fresh device creates by itself (the settings row,
 * the default account), so the server's real version always wins over them.
 */
export const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
