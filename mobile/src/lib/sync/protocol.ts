/**
 * The sync protocol, the phone's side of it (I-WIRE in .unlazy/phase3/PLAN.md).
 *
 * Wire types and constants only. Part of the pure sync core: it imports nothing
 * but relative modules that import nothing native, because the end-to-end test
 * loads it into the backend's test runner. No react-native, no expo, no `@/`.
 *
 * The server's half of the same contract is backend/src/lib/sync/schemas.ts
 * (SYNC_ROW_SCHEMAS); a contract test compares SYNC_FIELDS with it entity by
 * entity, so a field added on one side and not the other fails a gate rather
 * than being dropped silently on every sync.
 */
import { SYNC_ENTITIES, type SyncEntity } from '../local-schema';

export { SYNC_ENTITIES, type SyncEntity };

/** Rows in one push request. The server accepts 1,000; half leaves headroom. */
export const PUSH_BATCH_SIZE = 500;
/** Rows and deletions asked for per pull page. */
export const PULL_PAGE_SIZE = 500;
/** The server's limit on rows in one push (413 above it). */
export const MAX_SYNC_ROWS = 1000;

/** Fields every row carries on the wire. */
export const SYNC_COMMON_FIELDS = ['id', 'clientUpdatedAt'] as const;

/**
 * Every field of a row on the wire, per entity. `id` is the sync id: the
 * category's name for categories, the category for category budgets,
 * `'settings'` for the one settings row. `deleted` is not listed: it only
 * travels in a push, as the delete flag. `balance` is not listed either: it is
 * derived on both sides (decision 4). Neither is a bill's `lastNotifiedAt`,
 * which is the server's own, nor a budget's row id, which never leaves it.
 *
 * On the wire, booleans are booleans, dates YYYY-MM-DD, `paidAt` an ISO time
 * or null, and `breakdown` the JSON text of an object of amounts or null
 * (I-WIRE-4); the store converts at its boundary (sqlite-store.ts).
 */
export const SYNC_FIELDS: Record<SyncEntity, readonly string[]> = {
  settings: [
    ...SYNC_COMMON_FIELDS,
    'monthlyBudget',
    'startingBalance',
    'hourlyValue',
    'showTimeCost',
    'currency',
    'currencySymbol',
    'monthlyIncome',
    'savingsGoal',
    'spendingStyle',
    'primaryGoal',
    'locale',
  ],
  categories: [...SYNC_COMMON_FIELDS, 'icon', 'color', 'createdAt'],
  accounts: [
    ...SYNC_COMMON_FIELDS,
    'name',
    'type',
    'openingBalance',
    'currency',
    'color',
    'icon',
    'isDefault',
    'createdAt',
  ],
  transactions: [
    ...SYNC_COMMON_FIELDS,
    'amount',
    'category',
    'type',
    'isImpulse',
    'note',
    'dateISO',
    'accountId',
    'currency',
    'createdAt',
  ],
  subscriptions: [
    ...SYNC_COMMON_FIELDS,
    'merchantDisplay',
    'merchantNormalized',
    'cadence',
    'typicalAmount',
    'currency',
    'confidenceScore',
    'lastChargedAt',
    'nextExpectedAt',
    'status',
    'cancelUrl',
    'cancelNotes',
    'source',
    'createdAt',
  ],
  recurring: [
    ...SYNC_COMMON_FIELDS,
    'accountId',
    'name',
    'amount',
    'category',
    'type',
    'isImpulse',
    'frequency',
    'startDate',
    'nextDate',
    'lastCreated',
    'isActive',
    'currency',
    'createdAt',
  ],
  billReminders: [
    ...SYNC_COMMON_FIELDS,
    'name',
    'amount',
    'dueDay',
    'category',
    'isRecurring',
    'isPaid',
    'paidAt',
    'nextDueDate',
    'createdAt',
  ],
  categoryBudgets: [...SYNC_COMMON_FIELDS, 'amount', 'period', 'createdAt'],
  netWorth: [...SYNC_COMMON_FIELDS, 'date', 'assets', 'liabilities', 'netWorth', 'breakdown', 'createdAt'],
};

/** The fields of an entity other than `id` and `clientUpdatedAt`. */
export function entityFields(entity: SyncEntity): readonly string[] {
  return SYNC_FIELDS[entity].filter((f) => f !== 'id' && f !== 'clientUpdatedAt');
}

/** A row as it travels: the common fields plus the entity's own. */
export interface WireRow {
  id: string;
  /** ISO 8601, UTC, with milliseconds. Last writer wins by this value. */
  clientUpdatedAt: string;
  [field: string]: unknown;
}

/** A row in a push. `deleted: true` deletes it; its other fields may be omitted. */
export interface PushRow extends WireRow {
  deleted?: boolean;
}

export type SyncChanges<Row> = Partial<Record<SyncEntity, Row[]>>;

/** POST /api/v1/sync/push */
export interface PushRequest {
  changes: SyncChanges<PushRow>;
}

/**
 * What the server did with one pushed row.
 *   applied    written (insert, update or delete).
 *   stale      the server's row or tombstone is at least as new; nothing changed.
 *   invalid    failed validation.
 *   forbidden  the id belongs to another user.
 */
export type PushStatus = 'applied' | 'stale' | 'invalid' | 'forbidden';

export const PUSH_STATUSES: readonly PushStatus[] = ['applied', 'stale', 'invalid', 'forbidden'];

/**
 * `results` carries a key for every entity the server syncs. A row the server could not identify
 * comes back with id `""`: it matches nothing, and the row it was stays dirty.
 */
export interface PushResult {
  id: string;
  status: PushStatus;
}

export interface PushResponse {
  results: Partial<Record<SyncEntity, PushResult[]>>;
  serverTime: string;
}

export interface PullDeletion {
  entity: SyncEntity;
  id: string;
  clientUpdatedAt: string;
}

/** GET /api/v1/sync/pull?cursor=<opaque>&limit=<1..1000> */
export interface PullResponse {
  changes: SyncChanges<WireRow>;
  deletions: PullDeletion[];
  /** Opaque. Stored as given and sent back on the next pull. */
  cursor: string;
  hasMore: boolean;
  /**
   * This page belongs to a snapshot of every live row (no cursor, one too old
   * to continue from — cursors expire after 59 days — or another user's).
   * Before the first page of a snapshot the client deletes its non-dirty
   * synced rows: a row the snapshot does not mention no longer exists on the
   * server. A page after a `fullResync` page with `hasMore` continues the same
   * snapshot (the server never restarts one in progress) and wipes nothing.
   * Within one page, `changes` and `deletions` never name the same row.
   */
  fullResync: boolean;
  serverTime: string;
}

/**
 * A request that did not produce a usable answer.
 *
 * `network` means the server was never reached (offline, timeout): there is no
 * point trying the pull after a push failed that way. `http` carries the
 * status; a 401 is treated the same as unreachable — the session is gone.
 */
export class SyncTransportError extends Error {
  readonly kind: 'network' | 'http' | 'protocol';
  readonly status?: number;
  /** The server's error code, when it sent one (e.g. INVALID_CURSOR_CODE). */
  readonly code?: string;

  constructor(kind: 'network' | 'http' | 'protocol', message: string, status?: number, code?: string) {
    super(message);
    this.name = 'SyncTransportError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }

  /** The next request would fail the same way. */
  get unreachable(): boolean {
    return this.kind === 'network' || this.status === 401;
  }
}

/**
 * A pull answered 400 with this code: the stored cursor cannot be read (not
 * one of the server's, or damaged). The client forgets it and pulls without
 * one, which starts a snapshot.
 */
export const INVALID_CURSOR_CODE = 'invalid_cursor';

export function isInvalidCursorError(e: unknown): boolean {
  return e instanceof SyncTransportError && e.status === 400 && e.code === INVALID_CURSOR_CODE;
}

/** The network half the engine talks to: one push, one pull page. */
export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: string | null, limit: number): Promise<PullResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Reject a pull response that is not shaped like one, rather than half-apply it. */
export function assertPullResponse(value: unknown): asserts value is PullResponse {
  if (!isRecord(value)) throw new SyncTransportError('protocol', 'pull: response is not an object');
  if (!isRecord(value.changes)) throw new SyncTransportError('protocol', 'pull: changes missing');
  for (const [entity, rows] of Object.entries(value.changes)) {
    if (!(SYNC_ENTITIES as readonly string[]).includes(entity)) continue;
    if (!Array.isArray(rows)) throw new SyncTransportError('protocol', `pull: changes.${entity} is not a list`);
  }
  if (!Array.isArray(value.deletions)) throw new SyncTransportError('protocol', 'pull: deletions missing');
  if (typeof value.cursor !== 'string' || value.cursor.length === 0) {
    throw new SyncTransportError('protocol', 'pull: cursor missing');
  }
  if (typeof value.hasMore !== 'boolean' || typeof value.fullResync !== 'boolean') {
    throw new SyncTransportError('protocol', 'pull: hasMore/fullResync missing');
  }
}

/** Reject a push response that is not shaped like one. */
export function assertPushResponse(value: unknown): asserts value is PushResponse {
  if (!isRecord(value) || !isRecord(value.results)) {
    throw new SyncTransportError('protocol', 'push: results missing');
  }
}
