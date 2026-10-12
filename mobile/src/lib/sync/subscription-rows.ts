/**
 * How a subscription row is written on the phone (I-LOCAL in
 * .unlazy/phase6/PLAN.md): the detection engine's write, the user's decision,
 * and moving charge history between two rows the engine merged.
 *
 * Phase 6 decision 3, "user decisions win", is enforced here, in the SQL:
 * the engine's write never names `decision` or `canceledAt` on an existing
 * row, and its UPDATE sets `status` from the row's own decision whenever there
 * is one, whatever the engine proposed. A caller cannot get this wrong.
 *
 * Part of the pure sync core's family: relative imports only, nothing native,
 * so db.ts runs it on expo-sqlite and the backend's end-to-end sync test runs
 * the very same statements on bun:sqlite. It does no locking and tells no
 * listeners: db.ts wraps each call in its write lock and a transaction, and
 * notifies when something changed.
 */
import type { SyncBindValue, SyncSqlDb } from './sqlite-store';

/** The user's decision about a subscription. */
export type SubscriptionDecision = 'keep' | 'cancel' | 'dismiss';

/**
 * A subscription's status: the engine's reading (possible, active, trial,
 * ended) while the user has not decided, and the one following their decision
 * (confirmed, canceled, dismissed) once they have.
 */
export type SubscriptionStatus = 'possible' | 'active' | 'trial' | 'ended' | 'confirmed' | 'canceled' | 'dismissed';

export const SUBSCRIPTION_DECISIONS: readonly SubscriptionDecision[] = ['keep', 'cancel', 'dismiss'];

/** The status that follows each decision. */
export const DECISION_STATUS: Readonly<Record<SubscriptionDecision, SubscriptionStatus>> = {
  keep: 'confirmed',
  cancel: 'canceled',
  dismiss: 'dismissed',
};

/** The status of a row the user has not decided about, after they take a decision back. */
export const UNDECIDED_STATUS: SubscriptionStatus = 'possible';

export function isSubscriptionDecision(value: unknown): value is SubscriptionDecision {
  return typeof value === 'string' && (SUBSCRIPTION_DECISIONS as readonly string[]).includes(value);
}

/** DECISION_STATUS as SQL over the row's own `decision`, falling back to `otherwise`. */
const STATUS_FROM_DECISION = (otherwise: string) =>
  `CASE decision ${SUBSCRIPTION_DECISIONS.map((d) => `WHEN '${d}' THEN '${DECISION_STATUS[d]}'`).join(' ')} ELSE ${otherwise} END`;

/**
 * Every column the engine writes, in one order: the synced fields but
 * createdAt, and not the user's three — decision, canceledAt (the user's
 * write sets them) and cancelNotes (their own notes; updateSubscriptionCancelInfo).
 * `status` is among them, but on an existing row it is the engine's proposal
 * only while the row has no decision.
 */
export const ENGINE_FIELDS = [
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
  'source',
  'trialEndsAt',
  'previousAmount',
  'priceChangedAt',
  'alert',
  'sources',
  'billedVia',
] as const;
export type EngineField = (typeof ENGINE_FIELDS)[number];

/** The fields the engine leaves alone on an existing row. */
export const USER_FIELDS = ['decision', 'canceledAt', 'cancelNotes'] as const;
export type UserField = (typeof USER_FIELDS)[number];

/**
 * One engine write. A field left undefined keeps the stored value (a caller
 * that predates it does not erase it); null writes null. On a new row an
 * undefined field takes the column's default.
 */
export interface DetectedSubscriptionWrite {
  id: string;
  values: Partial<Record<EngineField | UserField, SyncBindValue | undefined>>;
  /** For a new row; defaults to `at`. */
  createdAt?: string;
  /** The device's "now": clientUpdatedAt of a write that changes something. */
  at: string;
}

type StoredRow = Record<EngineField | UserField, SyncBindValue>;

/** The column defaults a new row falls back to, as LOCAL_SCHEMA_SQL declares them. */
const NEW_ROW_DEFAULTS: Partial<Record<EngineField | UserField, SyncBindValue>> = {
  cadence: 'monthly',
  typicalAmount: 0,
  currency: 'USD',
  confidenceScore: 0,
  status: UNDECIDED_STATUS,
  source: 'transaction',
  sources: '',
};

/**
 * The detection engine's write: insert the subscription, or update what it
 * found about it. Returns true when a row was written; a re-run that finds
 * nothing new writes nothing, stamps nothing and leaves the row clean.
 *
 * On an existing row it never changes decision, canceledAt or cancelNotes,
 * and while there is a decision the status stays the one that follows it. A
 * new row takes a decision only if the write carries one (the engine moving a
 * decision onto a merged row's new id), and its status follows it too.
 */
export async function writeDetectedSubscription(db: SyncSqlDb, write: DetectedSubscriptionWrite): Promise<boolean> {
  const { id, values, at } = write;
  const columns = [...ENGINE_FIELDS, ...USER_FIELDS];
  const existing = await db.getFirstAsync<StoredRow>(`SELECT ${columns.join(', ')} FROM subscriptions WHERE id = ?`, [
    id,
  ]);

  if (!existing) {
    const row = Object.fromEntries(
      columns.map((f) => [f, values[f] !== undefined ? values[f]! : (NEW_ROW_DEFAULTS[f] ?? null)]),
    ) as StoredRow;
    if (!row.merchantDisplay || row.merchantNormalized === null) {
      throw new Error(`subscription ${id}: merchantDisplay and merchantNormalized are required`);
    }
    if (!isSubscriptionDecision(row.decision)) row.decision = null;
    if (row.decision !== 'cancel') row.canceledAt = null;
    if (isSubscriptionDecision(row.decision)) row.status = DECISION_STATUS[row.decision];
    await db.runAsync(
      `INSERT INTO subscriptions (id, ${columns.join(', ')}, createdAt, clientUpdatedAt, dirty, syncError)
       VALUES (?, ${columns.map(() => '?').join(', ')}, ?, ?, 1, NULL)`,
      [id, ...columns.map((f) => row[f]), write.createdAt ?? at, at],
    );
    // Re-creating a row deleted here is newer than its deletion.
    await db.runAsync(`DELETE FROM sync_tombstones WHERE entity = 'subscriptions' AND id = ?`, [id]);
    return true;
  }

  const next = Object.fromEntries(
    ENGINE_FIELDS.map((f) => [f, values[f] !== undefined ? values[f]! : existing[f]]),
  ) as Record<EngineField, SyncBindValue>;
  // What the UPDATE below will store as the status, for the no-change test.
  const decided = isSubscriptionDecision(existing.decision) ? DECISION_STATUS[existing.decision] : null;
  const unchanged = ENGINE_FIELDS.every((f) =>
    f === 'status' ? (decided ?? next.status) === existing.status : (existing[f] ?? null) === (next[f] ?? null),
  );
  if (unchanged) return false;

  const assigned = ENGINE_FIELDS.filter((f) => f !== 'status');
  await db.runAsync(
    `UPDATE subscriptions
        SET ${assigned.map((f) => `${f} = ?`).join(', ')},
            status = ${STATUS_FROM_DECISION('?')},
            clientUpdatedAt = ?, dirty = 1, syncError = NULL
      WHERE id = ?`,
    [...assigned.map((f) => next[f] ?? null), next.status ?? UNDECIDED_STATUS, at, id],
  );
  return true;
}

/**
 * The user's decision: keep → confirmed, cancel → canceled (canceledAt the
 * given date), dismiss → dismissed, null (take it back) → possible, which the
 * engine's next run re-reads. Any decision but cancel clears canceledAt.
 * Stamps the row and marks it for sync; returns false, writing nothing, when
 * the row is missing or already says exactly this.
 */
export async function writeSubscriptionDecision(
  db: SyncSqlDb,
  id: string,
  decision: SubscriptionDecision | null,
  opts: { canceledAt: string | null; at: string },
): Promise<boolean> {
  const status = decision ? DECISION_STATUS[decision] : UNDECIDED_STATUS;
  const canceledAt = decision === 'cancel' ? opts.canceledAt : null;
  const result = await db.runAsync(
    `UPDATE subscriptions
        SET decision = ?, canceledAt = ?, status = ?, clientUpdatedAt = ?, dirty = 1, syncError = NULL
      WHERE id = ? AND (decision IS NOT ? OR canceledAt IS NOT ? OR status IS NOT ?)`,
    [decision, canceledAt, status, opts.at, id, decision, canceledAt, status],
  );
  return result.changes > 0;
}

/**
 * Move one subscription's charge history onto another (the engine merged
 * `fromId` into `toId`). A charge the target already holds — the same
 * transaction, or for a charge with none the same date and amount — is
 * dropped rather than counted twice. Local only: occurrences never sync.
 * Returns how many moved.
 */
export async function moveOccurrenceRows(db: SyncSqlDb, fromId: string, toId: string): Promise<number> {
  if (fromId === toId) return 0;
  await db.runAsync(
    `DELETE FROM subscription_occurrences
      WHERE subscriptionId = ?
        AND EXISTS (
          SELECT 1 FROM subscription_occurrences t
           WHERE t.subscriptionId = ?
             AND (t.transactionId = subscription_occurrences.transactionId
                  OR (t.transactionId IS NULL AND subscription_occurrences.transactionId IS NULL
                      AND t.chargedAt = subscription_occurrences.chargedAt
                      AND t.amount = subscription_occurrences.amount)))`,
    [fromId, toId],
  );
  const moved = await db.runAsync(`UPDATE subscription_occurrences SET subscriptionId = ? WHERE subscriptionId = ?`, [
    toId,
    fromId,
  ]);
  return moved.changes;
}

/**
 * Record one charge against a subscription, once. Ids are deterministic, and
 * a charge moved here from a merged row keeps its old id, so the same
 * transaction under the same subscription is also recognised by its
 * transactionId. Returns true when it was new.
 */
export async function insertOccurrenceRow(
  db: SyncSqlDb,
  occ: { id: string; subscriptionId: string; transactionId: string | null; chargedAt: string; amount: number },
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO subscription_occurrences (id, subscriptionId, transactionId, chargedAt, amount)
     SELECT ?, ?, ?, ?, ?
      WHERE ? IS NULL
         OR NOT EXISTS (SELECT 1 FROM subscription_occurrences WHERE subscriptionId = ? AND transactionId = ?)`,
    [
      occ.id,
      occ.subscriptionId,
      occ.transactionId,
      occ.chargedAt,
      occ.amount,
      occ.transactionId,
      occ.subscriptionId,
      occ.transactionId,
    ],
  );
  return result.changes > 0;
}
