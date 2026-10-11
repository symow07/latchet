/**
 * Last-writer-wins for one entity's rows in one push (PLAN.md decision 5).
 * Pure: the caller reads the stored state, this decides, the caller writes.
 *
 * Each sync id has a state: the live row (its owner and clientUpdatedAt), the
 * caller's tombstone for it (the clientUpdatedAt of the delete), or neither.
 * An incoming row wins only when its clientUpdatedAt is strictly later than
 * whichever of the two is current — ties go to the server. A delete is a write
 * like any other: it carries its own time, beats older edits, and loses to a
 * newer one, which resurrects the row.
 *
 * Rows are decided in the order they were sent, each against the state the
 * previous ones left, so a push that both edits and deletes the same row ends
 * where the one with the later clientUpdatedAt says. Only the final state of
 * each id is written: one operation per id, whatever happened in between.
 */
export type SyncStatus = "applied" | "stale" | "invalid" | "forbidden";

/** What the database holds for one sync id. */
export interface KeyState {
  /** The live row: who owns it, and when it was last changed on a client. */
  live: { owner: string; cu: number } | null;
  /** The clientUpdatedAt of the caller's tombstone for this id, if any. */
  tomb: number | null;
}

export const EMPTY_STATE: KeyState = { live: null, tomb: null };

/** Decide one row against one state. */
export function decide(
  state: KeyState,
  row: { clientUpdatedAt: number; deleted: boolean },
  userId: string
): { status: Exclude<SyncStatus, "invalid">; next: KeyState } {
  const { live, tomb } = state;
  // Ids are global for accounts, transactions, recurring series, bill
  // reminders and net-worth snapshots: one that exists for another user is
  // theirs, whatever the timestamps say. (Settings, categories, subscriptions
  // and category budgets are keyed within the caller's own rows.)
  if (live && live.owner !== userId) return { status: "forbidden", next: state };

  const current = live ? live.cu : tomb;
  if (current !== null && row.clientUpdatedAt <= current) return { status: "stale", next: state };

  if (row.deleted) {
    // The delete's own time is what a later edit has to beat.
    return { status: "applied", next: { live: null, tomb: Math.max(tomb ?? row.clientUpdatedAt, row.clientUpdatedAt) } };
  }
  // A live row supersedes any tombstone for the same id.
  return { status: "applied", next: { live: { owner: userId, cu: row.clientUpdatedAt }, tomb: null } };
}

/** The one write a push makes for one sync id. */
export type WriteOp<V> =
  /** The id has no live row yet: insert it, removing a tombstone if there is one. */
  | { kind: "insert"; id: string; cu: number; values: V; dropTombstone: boolean }
  /** The caller's live row changes. */
  | { kind: "update"; id: string; cu: number; values: V; dropTombstone: boolean }
  /** The caller's live row is deleted; its tombstone carries `cu`. */
  | { kind: "delete"; id: string; cu: number }
  /** No live row before or after: record (or move forward) the tombstone. */
  | { kind: "tombstone"; id: string; cu: number };

/** One row of a batch: validated (an upsert with values, or a delete), or not. */
export type BatchRow<V> =
  | { ok: true; row: { id: string; clientUpdatedAt: number; deleted: true } | { id: string; clientUpdatedAt: number; deleted: false; values: V } }
  | { ok: false; id: string };

export interface BatchPlan<V> {
  /** One result per row, in the order the rows were sent. */
  results: { id: string; status: SyncStatus }[];
  /** One operation per id that changed, in the order each id first appeared. */
  ops: WriteOp<V>[];
}

/**
 * Decide a batch of rows for one entity. `rows` holds each row as validated
 * (a row that failed validation is reported invalid under the id it was sent
 * with); `initial` is the stored state of every id the batch names.
 */
export function planBatch<V>(
  rows: readonly BatchRow<V>[],
  initial: ReadonlyMap<string, KeyState>,
  userId: string
): BatchPlan<V> {
  const state = new Map(initial);
  const last = new Map<string, { cu: number; deleted: boolean; values?: V }>();
  const results: BatchPlan<V>["results"] = [];

  for (const parsed of rows) {
    if (!parsed.ok) {
      results.push({ id: parsed.id, status: "invalid" });
      continue;
    }
    const { row } = parsed;
    const { status, next } = decide(state.get(row.id) ?? EMPTY_STATE, row, userId);
    results.push({ id: row.id, status });
    if (status !== "applied") continue;
    state.set(row.id, next);
    // Map.set on an id already present keeps its first position, which is
    // the order the ops below come out in.
    last.set(row.id, row.deleted
      ? { cu: row.clientUpdatedAt, deleted: true }
      : { cu: row.clientUpdatedAt, deleted: false, values: row.values });
  }

  const ops: WriteOp<V>[] = [];
  for (const [id, write] of last) {
    const before = initial.get(id) ?? EMPTY_STATE;
    const after = state.get(id)!;
    if (!write.deleted) {
      const dropTombstone = before.tomb !== null;
      ops.push(before.live
        ? { kind: "update", id, cu: write.cu, values: write.values as V, dropTombstone }
        : { kind: "insert", id, cu: write.cu, values: write.values as V, dropTombstone });
    } else {
      ops.push(before.live
        ? { kind: "delete", id, cu: after.tomb! }
        : { kind: "tombstone", id, cu: after.tomb! });
    }
  }
  return { results, ops };
}

/**
 * The account a pushed transaction is stored against: its own accountId when
 * that account is the caller's and exists once this push's accounts are
 * applied, otherwise null — the transaction is kept, unlinked (I-WIRE).
 */
export function resolveAccountId(accountId: string | null, ownAccounts: ReadonlySet<string>): string | null {
  if (!accountId) return null;
  return ownAccounts.has(accountId) ? accountId : null;
}

/**
 * The caller's account ids that exist once this push's account operations are
 * applied: those that existed before, plus the inserted, minus the deleted.
 */
export function accountsAfter(existingOwn: ReadonlySet<string>, accountOps: readonly WriteOp<unknown>[]): Set<string> {
  const ids = new Set(existingOwn);
  for (const op of accountOps) {
    if (op.kind === "insert" || op.kind === "update") ids.add(op.id);
    else ids.delete(op.id);
  }
  return ids;
}
