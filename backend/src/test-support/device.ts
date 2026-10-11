/**
 * A phone, for the end-to-end sync test: the phone's real per-user database
 * (LOCAL_SCHEMA_SQL on bun:sqlite, seeded as a new phone seeds itself — the
 * epoch-dated settings row and acc_default_<userId>), the phone's real sync
 * engine and SQLite store, and a transport that talks to the real backend app
 * in process with one session's cookie, the way the phone's cloud-sync.ts
 * talks to it over the network.
 *
 * The transport records every exchange, so a test can say exactly which rows
 * a sync sent and received, not only that the two ledgers ended up equal.
 *
 * Imported only by tests.
 */
import type { Database } from "bun:sqlite";
import {
  LOCAL_SYNC_TABLES,
  SETTINGS_SYNC_ID,
  SYNC_ENTITIES,
  SyncTransportError,
  createSqliteSyncStore,
  createSyncEngine,
  defaultAccountId,
  entityFields,
  openTestUserDatabase,
  redactDeviceOnly,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushStatus,
  type SyncEngine,
  type SyncEntity,
  type SyncReport,
  type SyncTransport,
} from "./phone";
import { createPhoneWrites, type PhoneWrites } from "./phone-writes";
import type { Fetcher, Session } from "./session";

export interface PushExchange {
  request: PushRequest;
  response: PushResponse;
}

export interface PullExchange {
  cursor: string | null;
  limit: number;
  response: PullResponse;
}

/** One sync cycle: the engine's report and what went over the wire. */
export interface SyncResult {
  report: SyncReport;
  pushes: PushExchange[];
  pulls: PullExchange[];
  /** Every sync id the server answered for `entity`, with its status. */
  statuses(entity: SyncEntity): Record<string, PushStatus>;
  /** Sync ids of `entity` rows received, every page, in order. */
  pulledIds(entity: SyncEntity): string[];
  /** Every row received, as sent. */
  pulledRows(entity: SyncEntity): Record<string, unknown>[];
  /** Deletions received, as "entity:id". */
  pulledDeletions(): string[];
}

/** A local row in the shape devices are compared in: wire id, wire fields, clientUpdatedAt, and balance for accounts. */
export type LocalRow = Record<string, unknown> & { id: string };

export interface Device {
  label: string;
  userId: string;
  session: Session;
  /** The device's own clock, as ISO — skewed if the device was opened with a skew. */
  now(): string;
  /** db.ts's writes, stamped with this device's clock (phone-writes.ts). */
  write: PhoneWrites;
  engine: SyncEngine;
  /** One cycle (push, then pull until done), recorded. */
  sync(): Promise<SyncResult>;
  /** Every synced row of `entity`, in the comparison shape, ordered by sync id. */
  rows(entity: SyncEntity): Promise<LocalRow[]>;
  /** One synced row with its sync bookkeeping (dirty, syncError), or null. */
  row(entity: SyncEntity, id: string): Promise<Record<string, unknown> | null>;
  /** Everything synced, per entity: what two converged devices must agree on exactly. */
  view(): Promise<Record<SyncEntity, LocalRow[]>>;
  /** Rows still dirty (entity:id) and deletions not yet sent (entity:id). */
  pending(): Promise<{ dirty: string[]; tombstones: string[] }>;
  /** The bare SQLite database, for the rare test that has to reach under the app. */
  raw: Database;
  defaultAccountId: string;
  close(): void;
}

export interface DeviceOptions {
  label: string;
  /** Added to the real clock for every local write (negative: the phone's clock is behind). */
  clockSkewMs?: number;
  pullPageSize?: number;
  pushBatchSize?: number;
}

/**
 * The phone's transport (mobile/src/lib/cloud-sync.ts) against the app in
 * process: the same paths and query, the push redacted the same way, the
 * session cookie in a Cookie header as api.ts sends it, and every failure
 * turned into the SyncTransportError the engine expects — HTTP failures with
 * their status and the server's `code` (or `error`) string, so the engine's
 * invalid-cursor reset and 401 handling run as on the phone.
 */
function appTransport(app: Fetcher, session: Session, log: { pushes: PushExchange[]; pulls: PullExchange[] }): SyncTransport {
  async function call<T>(what: string, method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { cookie: session.cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await app.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      );
    } catch (e) {
      throw new SyncTransportError("network", `${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const b = json as { code?: unknown; error?: unknown } | null;
      const code = typeof b?.code === "string" ? b.code : typeof b?.error === "string" ? b.error : undefined;
      throw new SyncTransportError("http", `${what}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status, code);
    }
    if (json === null) throw new SyncTransportError("protocol", `${what}: the response is not JSON`);
    return json as T;
  }

  return {
    async push(request) {
      const body = redactDeviceOnly(request);
      const response = await call<PushResponse>("push", "POST", "/api/v1/sync/push", body);
      log.pushes.push({ request: structuredClone(body), response: structuredClone(response) });
      return response;
    },
    async pull(cursor, limit) {
      const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await call<PullResponse>("pull", "GET", `/api/v1/sync/pull?${query}`);
      log.pulls.push({ cursor, limit, response: structuredClone(response) });
      return response;
    },
  };
}

function toWireId(entity: SyncEntity, key: unknown): string {
  return entity === "settings" ? SETTINGS_SYNC_ID : String(key);
}

/** A phone signed in as `session`'s user, with a brand-new database. */
export function openDevice(app: Fetcher, session: Session, options: DeviceOptions): Device {
  const skew = options.clockSkewMs ?? 0;
  const now = () => new Date(Date.now() + skew).toISOString();
  const db = openTestUserDatabase(session.userId, now());
  let closed = false;
  const store = createSqliteSyncStore(db.access);
  const log = { pushes: [] as PushExchange[], pulls: [] as PullExchange[] };
  const engine = createSyncEngine({
    store,
    transport: appTransport(app, session, log),
    now,
    pullPageSize: options.pullPageSize,
    pushBatchSize: options.pushBatchSize,
  });

  const columns = (entity: SyncEntity) => [
    LOCAL_SYNC_TABLES[entity].idColumn,
    "clientUpdatedAt",
    ...entityFields(entity),
    ...(entity === "accounts" ? ["balance"] : []),
  ];

  async function rows(entity: SyncEntity): Promise<LocalRow[]> {
    const { table, idColumn } = LOCAL_SYNC_TABLES[entity];
    const raw = await db.access.run((sql) =>
      sql.getAllAsync<Record<string, unknown>>(`SELECT ${columns(entity).join(", ")} FROM ${table} ORDER BY ${idColumn}`)
    );
    return raw.map((r) => {
      const { [idColumn]: key, ...rest } = r;
      return { id: toWireId(entity, key), ...rest };
    });
  }

  async function sync(): Promise<SyncResult> {
    const pushesBefore = log.pushes.length;
    const pullsBefore = log.pulls.length;
    const report = await engine.syncOnce();
    const pushes = log.pushes.slice(pushesBefore);
    const pulls = log.pulls.slice(pullsBefore);
    const pulledRows = (entity: SyncEntity) =>
      pulls.flatMap((p) => (p.response.changes[entity] ?? []) as Record<string, unknown>[]);
    return {
      report,
      pushes,
      pulls,
      statuses: (entity) =>
        Object.fromEntries(pushes.flatMap((p) => (p.response.results[entity] ?? []).map((r) => [r.id, r.status]))),
      pulledRows,
      pulledIds: (entity) => pulledRows(entity).map((r) => String(r.id)),
      pulledDeletions: () => pulls.flatMap((p) => p.response.deletions.map((d) => `${d.entity}:${d.id}`)),
    };
  }

  return {
    label: options.label,
    userId: session.userId,
    session,
    now,
    write: createPhoneWrites({ access: db.access, now }),
    engine,
    sync,
    rows,
    async row(entity, id) {
      const { table, idColumn } = LOCAL_SYNC_TABLES[entity];
      const key = entity === "settings" ? 1 : id;
      return db.access.run((sql) =>
        sql.getFirstAsync<Record<string, unknown>>(
          `SELECT ${columns(entity).join(", ")}, dirty, syncError FROM ${table} WHERE ${idColumn} = ?`,
          [key]
        )
      );
    },
    async view() {
      const out = {} as Record<SyncEntity, LocalRow[]>;
      for (const entity of SYNC_ENTITIES) out[entity] = await rows(entity);
      return out;
    },
    async pending() {
      return db.access.run(async (sql) => {
        const dirty: string[] = [];
        for (const entity of SYNC_ENTITIES) {
          const { table, idColumn } = LOCAL_SYNC_TABLES[entity];
          const keys = await sql.getAllAsync<{ k: unknown }>(`SELECT ${idColumn} AS k FROM ${table} WHERE dirty = 1 ORDER BY ${idColumn}`);
          dirty.push(...keys.map((r) => `${entity}:${toWireId(entity, r.k)}`));
        }
        const tombs = await sql.getAllAsync<{ entity: string; id: string }>(
          `SELECT entity, id FROM sync_tombstones ORDER BY entity, id`
        );
        return { dirty, tombstones: tombs.map((t) => `${t.entity}:${t.id}`) };
      });
    },
    raw: db.db.raw,
    defaultAccountId: defaultAccountId(session.userId),
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
