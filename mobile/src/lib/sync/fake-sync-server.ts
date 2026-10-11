/**
 * An in-memory stand-in for the server's half of I-WIRE, for the engine's
 * tests: last writer wins by clientUpdatedAt with ties to the server,
 * tombstones that a newer upsert resurrects, unknown account ids (of a
 * transaction or a recurring series) stored as null, a cursor over a write sequence, paged snapshots with `fullResync`,
 * and a 400 `invalid_cursor` for a cursor it did not issue. Every request
 * goes through JSON, as on the wire.
 *
 * Imported only by tests.
 */
import {
  INVALID_CURSOR_CODE,
  SYNC_ENTITIES,
  SyncTransportError,
  type PullDeletion,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushResult,
  type PushRow,
  type SyncEntity,
  type SyncTransport,
  type WireRow,
} from './protocol';

interface Live {
  entity: SyncEntity;
  row: WireRow;
  seq: number;
}

interface Tomb {
  entity: SyncEntity;
  id: string;
  clientUpdatedAt: string;
  seq: number;
}

const key = (entity: SyncEntity, id: string) => `${entity}\u0000${id}`;
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class FakeSyncServer {
  live = new Map<string, Live>();
  tombs = new Map<string, Tomb>();
  seq = 0;
  /** Requests as received, in order. */
  pushes: PushRequest[] = [];
  pulls: { cursor: string | null; limit: number }[] = [];
  /** Ids answered `invalid` / `forbidden`, by `entity:id`. */
  invalid = new Set<string>();
  forbidden = new Set<string>();
  /** Ids answered with `""`, as a row the server could not identify. */
  unidentifiable = new Set<string>();
  /** Called after a push is applied and before it is answered. */
  onPush: ((request: PushRequest) => void | Promise<void>) | null = null;
  /** Fail the next push / pull with this error, once. */
  failPush: Error | null = null;
  failPull: Error | null = null;
  /** Fail the pull after this many successful pages (one shot). */
  failPullAfterPages: number | null = null;
  /** Every pull answers this cursor, unchanged (a broken server). */
  stuckCursor: string | null = null;

  /** Write a row as another device or the server itself would. */
  put(entity: SyncEntity, row: WireRow): void {
    this.live.set(key(entity, row.id), { entity, row: wire(row), seq: ++this.seq });
    this.tombs.delete(key(entity, row.id));
  }

  /** Delete a row as another device or the server itself would. */
  remove(entity: SyncEntity, id: string, clientUpdatedAt: string): void {
    this.live.delete(key(entity, id));
    this.tombs.set(key(entity, id), { entity, id, clientUpdatedAt, seq: ++this.seq });
    if (entity === 'accounts') {
      // ON DELETE SET NULL, which re-stamps the transactions and recurring
      // series it touches.
      for (const l of this.live.values()) {
        if ((l.entity === 'transactions' || l.entity === 'recurring') && l.row.accountId === id) {
          l.row = { ...l.row, accountId: null };
          l.seq = ++this.seq;
        }
      }
    }
  }

  get(entity: SyncEntity, id: string): WireRow | undefined {
    return this.live.get(key(entity, id))?.row;
  }

  private applyPush(request: PushRequest): PushResponse {
    const results = {} as Record<SyncEntity, PushResult[]>;
    for (const entity of SYNC_ENTITIES) {
      results[entity] = [];
      for (const row of (request.changes[entity] ?? []) as PushRow[]) {
        const k = key(entity, row.id);
        if (this.unidentifiable.has(k)) {
          results[entity].push({ id: '', status: 'invalid' });
          continue;
        }
        if (this.forbidden.has(k)) {
          results[entity].push({ id: row.id, status: 'forbidden' });
          continue;
        }
        if (this.invalid.has(k)) {
          results[entity].push({ id: row.id, status: 'invalid' });
          continue;
        }
        const serverAt = this.live.get(k)?.row.clientUpdatedAt ?? this.tombs.get(k)?.clientUpdatedAt;
        if (serverAt !== undefined && serverAt >= row.clientUpdatedAt) {
          results[entity].push({ id: row.id, status: 'stale' });
          continue;
        }
        if (row.deleted) {
          this.remove(entity, row.id, row.clientUpdatedAt);
        } else {
          const { deleted: _deleted, ...fields } = row;
          void _deleted;
          if (
            (entity === 'transactions' || entity === 'recurring') &&
            fields.accountId != null &&
            !this.live.has(key('accounts', String(fields.accountId)))
          ) {
            fields.accountId = null;
          }
          this.put(entity, fields as WireRow);
        }
        results[entity].push({ id: row.id, status: 'applied' });
      }
    }
    return { results, serverTime: new Date().toISOString() };
  }

  private snapshotOrder(): Live[] {
    return [...this.live.values()].sort((a, b) => {
      const ea = SYNC_ENTITIES.indexOf(a.entity);
      const eb = SYNC_ENTITIES.indexOf(b.entity);
      return ea !== eb ? ea - eb : a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    });
  }

  private page(rows: Live[], deletions: Tomb[], cursor: string, hasMore: boolean, fullResync: boolean): PullResponse {
    const changes: PullResponse['changes'] = {};
    for (const entity of SYNC_ENTITIES) changes[entity] = [];
    for (const l of rows) changes[l.entity]!.push(l.row);
    const dels: PullDeletion[] = deletions.map((t) => ({ entity: t.entity, id: t.id, clientUpdatedAt: t.clientUpdatedAt }));
    return { changes, deletions: dels, cursor, hasMore, fullResync, serverTime: new Date().toISOString() };
  }

  private answerPull(cursor: string | null, limit: number): PullResponse {
    if (this.stuckCursor) {
      return this.page([], [], this.stuckCursor, true, false);
    }
    // Snapshot: no cursor, or the next page of one ("snap:<offset>:<seqAtStart>").
    if (cursor === null || cursor.startsWith('snap:')) {
      let offset = 0;
      let atStart = this.seq;
      if (cursor !== null) {
        const [, o, s] = cursor.split(':');
        offset = Number(o);
        atStart = Number(s);
      }
      const all = this.snapshotOrder();
      const slice = all.slice(offset, offset + limit);
      const hasMore = offset + limit < all.length;
      const next = hasMore ? `snap:${offset + limit}:${atStart}` : `seq:${atStart}`;
      return this.page(slice, [], next, hasMore, true);
    }
    const match = /^seq:(\d+)$/.exec(cursor);
    if (!match) throw new SyncTransportError('http', 'Invalid cursor', 400, INVALID_CURSOR_CODE);
    const after = Number(match[1]);
    const items = [
      ...[...this.live.values()].map((l) => ({ seq: l.seq, live: l as Live | null, tomb: null as Tomb | null })),
      ...[...this.tombs.values()].map((t) => ({ seq: t.seq, live: null as Live | null, tomb: t as Tomb | null })),
    ]
      .filter((i) => i.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const slice = items.slice(0, limit);
    const hasMore = items.length > limit;
    const last = slice.length > 0 ? slice[slice.length - 1]!.seq : after;
    return this.page(
      slice.flatMap((i) => (i.live ? [i.live] : [])),
      slice.flatMap((i) => (i.tomb ? [i.tomb] : [])),
      `seq:${last}`,
      hasMore,
      false,
    );
  }

  transport(): SyncTransport {
    return {
      push: async (request) => {
        const body = wire(request);
        this.pushes.push(body);
        if (this.failPush) {
          const e = this.failPush;
          this.failPush = null;
          throw e;
        }
        const response = this.applyPush(body);
        if (this.onPush) await this.onPush(body);
        return wire(response);
      },
      pull: async (cursor, limit) => {
        this.pulls.push({ cursor, limit });
        if (this.failPull) {
          const e = this.failPull;
          this.failPull = null;
          throw e;
        }
        if (this.failPullAfterPages !== null) {
          if (this.failPullAfterPages === 0) {
            this.failPullAfterPages = null;
            throw new SyncTransportError('network', 'connection lost');
          }
          this.failPullAfterPages -= 1;
        }
        return wire(this.answerPull(cursor, limit));
      },
    };
  }
}
