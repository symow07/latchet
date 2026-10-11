/**
 * The two-way sync engine (I-SYNC-CLIENT). Pure: it knows the protocol and the
 * order of a cycle, and nothing about SQLite, React Native or the network.
 * The store (sqlite-store.ts) and the transport (cloud-sync.ts) are handed in.
 *
 * One cycle, `syncOnce()`:
 *
 *   1. Push. Every dirty row the server has not refused, and every local
 *      deletion, in entity order — settings, categories, accounts,
 *      transactions, subscriptions, recurring, billReminders,
 *      categoryBudgets, netWorth (SYNC_ENTITIES) — at most PUSH_BATCH_SIZE
 *      rows a request. Entity order across requests matters: a transaction
 *      or a recurring series pushed before its account would be stored by the
 *      server with its account set to null.
 *      Each row's status is settled at once:
 *        applied, stale   → clean (stale: the pull brings the server's version)
 *        invalid,
 *        forbidden        → the reason is recorded on the row, which is not
 *                           sent again until the user edits it
 *      but only if the row has not changed since it was read; an edit made
 *      while the request was in flight stays dirty and goes next cycle.
 *   2. Pull, page by page until `hasMore` is false, from the stored cursor.
 *      Each page is applied in one database transaction together with the new
 *      cursor, so a cycle cut short (the app backgrounded, the network gone)
 *      resumes where it stopped. A local row edited after its last push is
 *      not overwritten by an older server version (last writer wins by
 *      clientUpdatedAt, ties to the server). `fullResync` empties the
 *      non-dirty synced rows before the first page of the snapshot only — the
 *      store remembers a snapshot in progress across cycles, so a page
 *      boundary is never mistaken for a new snapshot.
 *   3. Recompute account balances once, if anything was applied.
 *
 * Single flight: overlapping triggers never run two cycles at once.
 * `syncOnce()` joins the cycle in progress; `requestCycle()` waits for it and
 * then runs one more (shared by everyone who asks meanwhile), for callers that
 * need a cycle which *starts* after their own change.
 */
import {
  PULL_PAGE_SIZE,
  PUSH_BATCH_SIZE,
  SYNC_ENTITIES,
  SyncTransportError,
  assertPullResponse,
  assertPushResponse,
  isInvalidCursorError,
  type PullResponse,
  type PushRequest,
  type PushRow,
  type PushStatus,
  type SyncEntity,
  type SyncTransport,
} from './protocol';

/** One local change waiting to be pushed. */
export interface PendingChange {
  entity: SyncEntity;
  /** The sync id, as on the wire. */
  id: string;
  clientUpdatedAt: string;
  /** A local deletion (a tombstone) rather than a row. */
  deleted: boolean;
  /** What is sent. */
  row: PushRow;
  /** Where the store's keyset paging resumes after this change. */
  cursor: string;
  /** The change as it was read; settled only if it still reads the same. */
  snapshot: string;
}

/** What became of one pushed change. `unanswered`: absent from the response. */
export interface PushOutcome {
  change: PendingChange;
  status: PushStatus | 'unanswered';
}

export interface SettleCounts {
  /** Marked clean (or tombstone dropped). */
  settled: number;
  /** Changed locally while the request was in flight: left dirty for the next cycle. */
  changedSinceRead: number;
  /** invalid/forbidden recorded on the row. */
  rejected: number;
}

export interface PullState {
  cursor: string | null;
  /** A snapshot (fullResync) has started and not finished. */
  resyncActive: boolean;
}

export interface ApplyOptions {
  /** Delete every non-dirty synced row before applying this page. */
  wipe: boolean;
  /** Still inside a snapshot after this page. */
  resyncActive: boolean;
}

export interface ApplyCounts {
  /** Rows written, deleted or wiped: local data changed. */
  changed: number;
  /** Server rows not applied because the local row is newer. */
  skipped: number;
  /** Rows the store could not apply (malformed); the page still commits. */
  errors: string[];
}

/** The engine's view of the local database (sqlite-store.ts implements it). */
export interface SyncStore {
  /**
   * Up to `limit` pending changes of one entity, after `after` (a cursor from
   * a previous change, or null): dirty rows not refused by the server, then
   * tombstones of rows that no longer exist locally.
   */
  readPending(entity: SyncEntity, after: string | null, limit: number): Promise<PendingChange[]>;
  /** Settle a push: clean, record the refusal, or leave alone — see SettleCounts. */
  settlePush(outcomes: PushOutcome[]): Promise<SettleCounts>;
  getPullState(): Promise<PullState>;
  /** Forget the cursor (and any snapshot in progress): the next pull is a snapshot. */
  resetPullState(): Promise<void>;
  /** Apply one pull page and store its cursor, atomically. */
  applyPullPage(page: PullResponse, options: ApplyOptions): Promise<ApplyCounts>;
  /** balance = openingBalance + ledger, for every account. */
  recomputeBalances(): Promise<void>;
}

export interface SyncReport {
  /** The cycle ran to the end with no request or database failure. */
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  pushed: {
    requests: number;
    rows: number;
    applied: number;
    stale: number;
    invalid: number;
    forbidden: number;
    unanswered: number;
    /** Left dirty: edited while in flight. */
    changedSinceRead: number;
  };
  pulled: {
    pages: number;
    rows: number;
    deletions: number;
    /** Local rows changed by the pull. */
    changed: number;
    skipped: number;
    /** A snapshot page was seen this cycle. */
    fullResync: boolean;
    /** The pull reached the end (`hasMore: false`). */
    complete: boolean;
    /** The server refused the stored cursor; the pull restarted as a snapshot. */
    cursorReset: boolean;
  };
  errors: string[];
}

export interface SyncEngine {
  /** Run a cycle, or join the one in progress. Never rejects. */
  syncOnce(): Promise<SyncReport>;
  /** A cycle that starts after this call: joins a queued one, or queues one. Never rejects. */
  requestCycle(): Promise<SyncReport>;
  /** A cycle is running. */
  isRunning(): boolean;
}

export interface SyncEngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  /** ISO timestamp; injectable for tests. */
  now: () => string;
  pushBatchSize?: number;
  pullPageSize?: number;
  /** Safety stop for a server that keeps saying hasMore. */
  maxPullPages?: number;
}

/** The pull did not finish in a sane number of pages, or its cursor stood still. */
export class PullLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PullLoopError';
  }
}

function describe(stage: string, e: unknown): string {
  return `${stage}: ${e instanceof Error ? e.message : String(e)}`;
}

function emptyReport(startedAt: string): SyncReport {
  return {
    ok: false,
    startedAt,
    finishedAt: startedAt,
    pushed: { requests: 0, rows: 0, applied: 0, stale: 0, invalid: 0, forbidden: 0, unanswered: 0, changedSinceRead: 0 },
    pulled: { pages: 0, rows: 0, deletions: 0, changed: 0, skipped: 0, fullResync: false, complete: false, cursorReset: false },
    errors: [],
  };
}

function resultKey(entity: SyncEntity, id: string): string {
  return `${entity}\u0000${id}`;
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { store, transport, now } = options;
  const pushBatchSize = Math.max(1, Math.min(options.pushBatchSize ?? PUSH_BATCH_SIZE, PUSH_BATCH_SIZE));
  const pullPageSize = Math.max(1, options.pullPageSize ?? PULL_PAGE_SIZE);
  const maxPullPages = options.maxPullPages ?? 10_000;

  async function sendBatch(batch: PendingChange[], report: SyncReport): Promise<void> {
    const changes: PushRequest['changes'] = {};
    for (const change of batch) (changes[change.entity] ??= []).push(change.row);

    report.pushed.requests += 1;
    report.pushed.rows += batch.length;
    const response = await transport.push({ changes });
    assertPushResponse(response);

    const statuses = new Map<string, PushStatus>();
    for (const entity of SYNC_ENTITIES) {
      for (const result of response.results[entity] ?? []) {
        // id "" is a row the server could not identify: it matches nothing,
        // so the change it was stays unanswered, and dirty.
        if (result && typeof result.id === 'string' && result.id !== '') {
          statuses.set(resultKey(entity, result.id), result.status);
        }
      }
    }

    const outcomes: PushOutcome[] = batch.map((change) => {
      const status = statuses.get(resultKey(change.entity, change.id));
      const known = status === 'applied' || status === 'stale' || status === 'invalid' || status === 'forbidden';
      return { change, status: known ? status : 'unanswered' };
    });
    for (const { status } of outcomes) report.pushed[status] += 1;

    const counts = await store.settlePush(outcomes);
    report.pushed.changedSinceRead += counts.changedSinceRead;
  }

  /** Push everything pending, entity by entity, in batches. Throws on a failed request. */
  async function pushAll(report: SyncReport): Promise<void> {
    let batch: PendingChange[] = [];
    for (const entity of SYNC_ENTITIES) {
      let after: string | null = null;
      for (;;) {
        const room = pushBatchSize - batch.length;
        const page = await store.readPending(entity, after, room);
        batch.push(...page);
        if (page.length > 0) after = page[page.length - 1]!.cursor;
        if (batch.length >= pushBatchSize) {
          await sendBatch(batch, report);
          batch = [];
        }
        // Fewer than asked for: this entity has nothing more pending.
        if (page.length < room) break;
      }
    }
    if (batch.length > 0) await sendBatch(batch, report);
  }

  /** Pull until the server has nothing more. Throws on a failed request. */
  async function pullAll(report: SyncReport): Promise<void> {
    let { cursor, resyncActive } = await store.getPullState();
    let cursorRejected = false;
    for (let pages = 0; ; pages++) {
      if (pages >= maxPullPages) throw new PullLoopError(`pull did not finish within ${maxPullPages} pages`);

      let page: PullResponse;
      try {
        page = await transport.pull(cursor, pullPageSize);
      } catch (e) {
        // The server cannot read the stored cursor: forget it and start over
        // with a snapshot. Once — a second refusal is a real failure.
        if (cursor === null || cursorRejected || !isInvalidCursorError(e)) throw e;
        cursorRejected = true;
        report.pulled.cursorReset = true;
        await store.resetPullState();
        cursor = null;
        resyncActive = false;
        continue;
      }
      assertPullResponse(page);

      // The first page of a snapshot empties what the snapshot will replace.
      // A later page of the same snapshot — this cycle or a later one, after
      // an interruption — must not, or it would delete the earlier pages.
      const continuing = resyncActive && cursor !== null;
      const wipe = page.fullResync && !continuing;
      const stillResyncing = page.fullResync && page.hasMore;

      const counts = await store.applyPullPage(page, { wipe, resyncActive: stillResyncing });
      report.pulled.pages += 1;
      for (const entity of SYNC_ENTITIES) report.pulled.rows += page.changes[entity]?.length ?? 0;
      report.pulled.deletions += page.deletions.length;
      report.pulled.changed += counts.changed;
      report.pulled.skipped += counts.skipped;
      if (page.fullResync) report.pulled.fullResync = true;
      for (const error of counts.errors) report.errors.push(describe('apply', error));

      if (!page.hasMore) {
        report.pulled.complete = true;
        return;
      }
      if (page.cursor === cursor) throw new PullLoopError('pull cursor did not advance');
      cursor = page.cursor;
      resyncActive = stillResyncing;
    }
  }

  async function runCycle(): Promise<SyncReport> {
    const report = emptyReport(now());
    let skipPull = false;
    try {
      await pushAll(report);
    } catch (e) {
      report.errors.push(describe('push', e));
      // Offline, timed out, or signed out: the pull would fail the same way.
      // Any other failure (a 500, a malformed answer) is the push's alone, and
      // the device should still receive what the server has.
      skipPull = e instanceof SyncTransportError && e.unreachable;
    }

    if (!skipPull) {
      try {
        await pullAll(report);
      } catch (e) {
        report.errors.push(describe('pull', e));
      }
    }

    if (report.pulled.changed > 0) {
      try {
        await store.recomputeBalances();
      } catch (e) {
        report.errors.push(describe('balances', e));
      }
    }

    report.ok = report.errors.length === 0;
    report.finishedAt = now();
    return report;
  }

  let running: Promise<SyncReport> | null = null;
  let queued: Promise<SyncReport> | null = null;

  function syncOnce(): Promise<SyncReport> {
    if (running) return running;
    const cycle = runCycle().catch((e: unknown) => {
      // runCycle catches its own failures; this is the last line, so that a
      // bug in it can never wedge the single-flight guard.
      const report = emptyReport(now());
      report.errors.push(describe('cycle', e));
      return report;
    });
    running = cycle.finally(() => {
      running = null;
    });
    return running;
  }

  function requestCycle(): Promise<SyncReport> {
    if (!running) return syncOnce();
    if (!queued) {
      queued = running.then(() => {
        queued = null;
        return syncOnce();
      });
    }
    return queued;
  }

  return { syncOnce, requestCycle, isRunning: () => running !== null };
}
