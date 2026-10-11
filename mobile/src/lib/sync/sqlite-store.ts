/**
 * The sync engine's store over the phone's per-user SQLite database.
 *
 * Part of the pure sync core: relative imports only, nothing native. It does
 * not import db.ts (which imports expo-sqlite); it declares the four methods it
 * uses, which db.ts's `SqlDb` — expo-sqlite's database — satisfies
 * structurally, and so does the bun:sqlite adapter the tests use.
 *
 * Every operation goes through `access.run`, which in the app is db.ts's
 * withWriteLock: the store's reads see no other write half-done, and its
 * writes queue behind the user's own. `run` is not re-entrant, so nothing in
 * here calls back into db.ts.
 *
 * What it guarantees, beyond the SQL:
 *   - Applying server rows never marks them dirty, never stamps them, and never
 *     tells the local-mutation listeners: that would push every pulled row
 *     straight back.
 *   - A pushed row is marked clean only if it still reads exactly as it did
 *     when it was read for the push. A write in between keeps it dirty.
 *   - 0/1 become booleans on the way out, booleans become 0/1 on the way in,
 *     and a malformed server row is skipped and reported, never half-written.
 *     A net-worth breakdown is JSON text on the wire and in its column alike;
 *     only db.ts parses it.
 *   - When the set of synced entities grows (a phone upgraded from a build
 *     that synced fewer), the next pull is a full one: rows of the new
 *     entities that the old build skipped are behind its cursor, and nothing
 *     else would ever send them (SYNC_ENTITY_SIGNATURE).
 */
import { EPOCH_ISO, LOCAL_SYNC_TABLES, SETTINGS_SYNC_ID, type SyncEntity } from '../local-schema';
import type { ApplyCounts, ApplyOptions, PendingChange, PullState, PushOutcome, SettleCounts, SyncStore } from './engine';
import { SYNC_ENTITIES, entityFields, type PullDeletion, type PullResponse, type PushRow, type WireRow } from './protocol';

export type SyncBindValue = string | number | null | boolean | Uint8Array;
export type SyncBindParams = SyncBindValue[] | Record<string, SyncBindValue>;

/** The slice of expo-sqlite's database this store uses — db.ts's `SqlDb`. */
export interface SyncSqlDb {
  getAllAsync<T>(source: string, params?: SyncBindParams): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: SyncBindParams): Promise<T | null>;
  runAsync(source: string, params?: SyncBindParams): Promise<{ lastInsertRowId: number; changes: number }>;
  execAsync(source: string): Promise<void>;
}

/** Exclusive access to the user's database, one operation at a time. */
export interface SyncDbAccess {
  run<T>(fn: (db: SyncSqlDb) => Promise<T>): Promise<T>;
}

/** sync_meta keys. */
export const SYNC_META = {
  cursor: 'pull_cursor',
  resyncActive: 'pull_resync_active',
  serverTime: 'pull_server_time',
  /** The SYNC_ENTITY_SIGNATURE of the build that stored the cursor. */
  entities: 'pull_entities',
} as const;

/**
 * The entities this build syncs, stored with every cursor. A stored cursor is
 * only good for the entity set it was read under: a build that synced five
 * entities pulled past rows of the other four without keeping them. When the
 * stored signature is not this one (missing, on a database from such a
 * build), the store reports no cursor — and no snapshot in progress, since
 * one the old build started skipped those rows too — so the engine pulls a
 * full snapshot. Its first page stores this signature with its cursor, so an
 * interrupted snapshot then continues instead of starting over.
 */
export const SYNC_ENTITY_SIGNATURE = SYNC_ENTITIES.join(',');

type ColumnKind = 'number' | 'text' | 'nullableText' | 'boolean' | 'json';

interface ColumnSpec {
  kind: ColumnKind;
  /** Used when the server leaves the field out. `required` fields have none: the row is malformed. */
  fallback?: number | string | null;
  required?: boolean;
}

const num = (fallback: number): ColumnSpec => ({ kind: 'number', fallback });
const text = (fallback: string): ColumnSpec => ({ kind: 'text', fallback });
const nullableText: ColumnSpec = { kind: 'nullableText', fallback: null };
const bool: ColumnSpec = { kind: 'boolean', fallback: 0 };
const boolTrue: ColumnSpec = { kind: 'boolean', fallback: 1 };
const requiredNum: ColumnSpec = { kind: 'number', required: true };
const requiredText: ColumnSpec = { kind: 'text', required: true };
/** JSON text, or null. An object from the server is stored as its JSON text. */
const jsonText: ColumnSpec = { kind: 'json', fallback: null };
/** createdAt falls back to the row's clientUpdatedAt. */
const createdAt: ColumnSpec = { kind: 'text' };

/**
 * The local column behind every synced field, and how to read a server value
 * into it. Defaults mirror LOCAL_SCHEMA_SQL; sqlite-store.test.ts checks that
 * this covers SYNC_FIELDS exactly and that every column exists.
 */
export const SYNC_COLUMNS: Record<SyncEntity, Record<string, ColumnSpec>> = {
  settings: {
    monthlyBudget: num(0),
    startingBalance: num(0),
    hourlyValue: num(0),
    showTimeCost: bool,
    currency: text('USD'),
    currencySymbol: text('$'),
    monthlyIncome: num(0),
    savingsGoal: num(0),
    spendingStyle: text('moderate'),
    primaryGoal: text('track'),
    locale: text('en'),
  },
  categories: {
    icon: text(''),
    color: text('#94a3b8'),
    createdAt,
  },
  accounts: {
    name: requiredText,
    type: text('other'),
    openingBalance: num(0),
    currency: text('USD'),
    color: text('#a855f7'),
    icon: text('wallet'),
    isDefault: bool,
    createdAt,
  },
  transactions: {
    amount: requiredNum,
    category: requiredText,
    type: requiredText,
    isImpulse: bool,
    note: nullableText,
    dateISO: requiredText,
    accountId: nullableText,
    currency: text('USD'),
    createdAt,
  },
  subscriptions: {
    merchantDisplay: requiredText,
    merchantNormalized: requiredText,
    cadence: text('monthly'),
    typicalAmount: num(0),
    currency: text('USD'),
    confidenceScore: num(0),
    lastChargedAt: nullableText,
    nextExpectedAt: nullableText,
    status: text('possible'),
    cancelUrl: nullableText,
    cancelNotes: nullableText,
    source: text('transaction'),
    createdAt,
  },
  recurring: {
    // Null, or an account this phone may no longer have: the server books an
    // unknown or unlinked account's occurrences onto the default account.
    accountId: nullableText,
    name: requiredText,
    amount: requiredNum,
    category: requiredText,
    type: requiredText,
    isImpulse: bool,
    frequency: text('monthly'),
    startDate: requiredText,
    nextDate: requiredText,
    lastCreated: nullableText,
    isActive: boolTrue,
    currency: text('USD'),
    createdAt,
  },
  billReminders: {
    name: requiredText,
    amount: requiredNum,
    dueDay: requiredNum,
    category: text('Other'),
    isRecurring: boolTrue,
    isPaid: bool,
    paidAt: nullableText,
    nextDueDate: requiredText,
    createdAt,
  },
  categoryBudgets: {
    amount: requiredNum,
    period: text('monthly'),
    createdAt,
  },
  netWorth: {
    date: requiredText,
    assets: num(0),
    liabilities: num(0),
    netWorth: num(0),
    breakdown: jsonText,
    createdAt,
  },
};

/** Largest IN (...) list per statement, well under SQLite's variable limit. */
const IN_CHUNK = 400;

type LocalKey = string | number;
type RawRow = Record<string, unknown>;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

function table(entity: SyncEntity): { table: string; idColumn: string } {
  return LOCAL_SYNC_TABLES[entity];
}

/** The settings row is `'settings'` on the wire and row 1 here. */
function toLocalKey(entity: SyncEntity, wireId: string): LocalKey {
  return entity === 'settings' ? 1 : wireId;
}

function toWireId(entity: SyncEntity, key: unknown): string {
  return entity === 'settings' ? SETTINGS_SYNC_ID : String(key);
}

function selectColumns(entity: SyncEntity): string {
  const { idColumn } = table(entity);
  return [idColumn, 'clientUpdatedAt', 'dirty', 'syncError', ...entityFields(entity)].join(', ');
}

/** What a row read for a push looked like; compared again before it is marked clean. */
function rowSnapshot(entity: SyncEntity, raw: RawRow): string {
  return JSON.stringify([raw.clientUpdatedAt, raw.dirty, raw.syncError, ...entityFields(entity).map((f) => raw[f] ?? null)]);
}

/** A local row as it is sent: booleans as booleans, NULL as null. */
function toWireRow(entity: SyncEntity, raw: RawRow): PushRow {
  const row: PushRow = {
    id: toWireId(entity, raw[table(entity).idColumn]),
    clientUpdatedAt: String(raw.clientUpdatedAt),
  };
  for (const field of entityFields(entity)) {
    const value = raw[field];
    row[field] = SYNC_COLUMNS[entity][field]!.kind === 'boolean' ? value === 1 || value === true : (value ?? null);
  }
  return row;
}

/**
 * A server row as local column values, or the reason it cannot be applied.
 * Values the server omitted take the column's default; a required one missing
 * makes the row malformed.
 */
export function toLocalValues(entity: SyncEntity, row: WireRow): { values: Record<string, SyncBindValue> } | { error: string } {
  const values: Record<string, SyncBindValue> = {};
  for (const field of entityFields(entity)) {
    const spec = SYNC_COLUMNS[entity][field]!;
    const value = row[field];
    switch (spec.kind) {
      case 'boolean':
        values[field] = value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : (spec.fallback as number);
        break;
      case 'json':
        values[field] =
          typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : null;
        break;
      case 'number': {
        const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
        if (Number.isFinite(n)) values[field] = n;
        else if (spec.required) return { error: `${entity} ${row.id}: ${field} is not a number` };
        else values[field] = spec.fallback as number;
        break;
      }
      case 'nullableText':
        values[field] = value === null || value === undefined ? null : String(value);
        break;
      case 'text':
        if (typeof value === 'string') values[field] = value;
        else if (typeof value === 'number') values[field] = String(value);
        else if (spec.required) return { error: `${entity} ${row.id}: ${field} missing` };
        else values[field] = field === 'createdAt' ? row.clientUpdatedAt : (spec.fallback as string);
        break;
    }
  }
  return { values };
}

function sameContent(entity: SyncEntity, local: RawRow, values: Record<string, SyncBindValue>, clientUpdatedAt: string): boolean {
  if (local.dirty !== 0 || local.syncError !== null || local.clientUpdatedAt !== clientUpdatedAt) return false;
  return entityFields(entity).every((f) => (local[f] ?? null) === values[f]);
}

async function inTransaction<T>(db: SyncSqlDb, fn: () => Promise<T>): Promise<T> {
  await db.execAsync('BEGIN');
  try {
    const result = await fn();
    await db.execAsync('COMMIT');
    return result;
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      // Nothing to roll back, or the connection is already gone.
    }
    throw e;
  }
}

async function readRowsByKey(db: SyncSqlDb, entity: SyncEntity, keys: LocalKey[]): Promise<Map<LocalKey, RawRow>> {
  const { table: name, idColumn } = table(entity);
  const out = new Map<LocalKey, RawRow>();
  for (const part of chunks(keys, IN_CHUNK)) {
    const rows = await db.getAllAsync<RawRow>(
      `SELECT ${selectColumns(entity)} FROM ${name} WHERE ${idColumn} IN (${placeholders(part.length)})`,
      part,
    );
    for (const r of rows) out.set(r[idColumn] as LocalKey, r);
  }
  return out;
}

async function readTombstonesById(db: SyncSqlDb, entity: SyncEntity, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(ids, IN_CHUNK)) {
    const rows = await db.getAllAsync<{ id: string; clientUpdatedAt: string }>(
      `SELECT id, clientUpdatedAt FROM sync_tombstones WHERE entity = ? AND id IN (${placeholders(part.length)})`,
      [entity, ...part],
    );
    for (const r of rows) out.set(r.id, r.clientUpdatedAt);
  }
  return out;
}

async function setMeta(db: SyncSqlDb, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.runAsync(`DELETE FROM sync_meta WHERE key = ?`, [key]);
    return;
  }
  await db.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** Write one server row: an upsert that leaves it clean, and the account's balance derived later. */
async function upsertServerRow(db: SyncSqlDb, entity: SyncEntity, key: LocalKey, values: Record<string, SyncBindValue>, clientUpdatedAt: string): Promise<void> {
  const { table: name, idColumn } = table(entity);
  const fields = entityFields(entity);
  const insertColumns = [idColumn, ...fields, 'clientUpdatedAt', 'dirty', 'syncError'];
  const insertValues: SyncBindValue[] = [key, ...fields.map((f) => values[f]!), clientUpdatedAt, 0, null];
  if (entity === 'accounts') {
    // A new account starts at its opening balance; the recompute at the end
    // of the cycle adds its ledger. An existing one keeps its balance until then.
    insertColumns.push('balance');
    insertValues.push(values.openingBalance!);
  }
  const updates = [...fields.map((f) => `${f} = excluded.${f}`), 'clientUpdatedAt = excluded.clientUpdatedAt', 'dirty = 0', 'syncError = NULL'];
  await db.runAsync(
    `INSERT INTO ${name} (${insertColumns.join(', ')}) VALUES (${placeholders(insertColumns.length)})
     ON CONFLICT(${idColumn}) DO UPDATE SET ${updates.join(', ')}`,
    insertValues,
  );
}

/** Remove a row the server deleted, and what hangs off it locally. Returns rows changed. */
async function deleteLocalRow(db: SyncSqlDb, entity: SyncEntity, key: LocalKey): Promise<number> {
  const { table: name, idColumn } = table(entity);
  if (entity === 'settings') {
    // The app always has a settings row. Back to the seeded default, clean:
    // the server holds none, and nobody has configured this one.
    await db.runAsync(`DELETE FROM settings WHERE id = 1`);
    await db.runAsync(`INSERT INTO settings (id, clientUpdatedAt, dirty) VALUES (1, ?, 0)`, [EPOCH_ISO]);
    return 1;
  }
  if (entity === 'subscriptions') {
    await db.runAsync(`DELETE FROM subscription_occurrences WHERE subscriptionId = ?`, [key]);
  }
  const result = await db.runAsync(`DELETE FROM ${name} WHERE ${idColumn} = ?`, [key]);
  let changed = result.changes;
  if (entity === 'accounts') {
    // What the server's ON DELETE SET NULL already did to its copies of these
    // transactions and recurring series: none may point at an account that no
    // longer exists. Not stamped and not dirty — the server made the same
    // change, and re-sends the rows it changed.
    const detached = await db.runAsync(`UPDATE transactions SET accountId = NULL WHERE accountId = ?`, [key]);
    const unlinked = await db.runAsync(`UPDATE recurring_transactions SET accountId = NULL WHERE accountId = ?`, [key]);
    changed += detached.changes + unlinked.changes;
  }
  return changed;
}

/** The first page of a snapshot: drop what the snapshot is about to restate. */
async function wipeSyncedRows(db: SyncSqlDb): Promise<number> {
  let changed = 0;
  for (const entity of SYNC_ENTITIES) {
    // The settings row stays: there is always exactly one, and the snapshot
    // overwrites it if the server has one.
    if (entity === 'settings') continue;
    const { table: name } = table(entity);
    const result = await db.runAsync(`DELETE FROM ${name} WHERE dirty = 0`);
    changed += result.changes;
  }
  // Charge history (subscription_occurrences) stays until the snapshot is
  // complete: the subscriptions it belongs to may be on a later page.
  return changed;
}

/**
 * When the server sends both a row and a deletion for one id in a page (a
 * delete and a re-create racing the read), the later write is the truth. On
 * a tie the deletion stands: only a strictly newer upsert resurrects.
 */
function resolveDuplicates(page: PullResponse): { rows: Map<SyncEntity, WireRow[]>; deletions: PullDeletion[] } {
  const deletionAt = new Map<string, string>();
  for (const d of page.deletions) {
    if (d && typeof d.id === 'string') deletionAt.set(`${d.entity}\u0000${d.id}`, String(d.clientUpdatedAt));
  }
  const rows = new Map<SyncEntity, WireRow[]>();
  const resurrected = new Set<string>();
  for (const entity of SYNC_ENTITIES) {
    const kept: WireRow[] = [];
    for (const row of page.changes[entity] ?? []) {
      const deletedAt = row && typeof row.id === 'string' ? deletionAt.get(`${entity}\u0000${row.id}`) : undefined;
      if (deletedAt !== undefined) {
        if (String(row.clientUpdatedAt) > deletedAt) resurrected.add(`${entity}\u0000${row.id}`);
        else continue;
      }
      kept.push(row);
    }
    rows.set(entity, kept);
  }
  const deletions = page.deletions.filter((d) => d && !resurrected.has(`${d.entity}\u0000${d.id}`));
  return { rows, deletions };
}

export function createSqliteSyncStore(access: SyncDbAccess): SyncStore {
  async function readPending(entity: SyncEntity, after: string | null, limit: number): Promise<PendingChange[]> {
    if (limit <= 0) return [];
    return access.run(async (db) => {
      const { table: name, idColumn } = table(entity);
      const out: PendingChange[] = [];

      // Rows first, then tombstones; the cursor says which phase it is in.
      const inTombstones = after?.startsWith('t:') ?? false;
      if (!inTombstones) {
        const afterKey: LocalKey | null = after ? (JSON.parse(after.slice(2)) as LocalKey) : null;
        const rows = await db.getAllAsync<RawRow>(
          `SELECT ${selectColumns(entity)} FROM ${name}
           WHERE dirty = 1 AND syncError IS NULL${afterKey !== null ? ` AND ${idColumn} > ?` : ''}
           ORDER BY ${idColumn} LIMIT ?`,
          afterKey !== null ? [afterKey, limit] : [limit],
        );
        for (const raw of rows) {
          const row = toWireRow(entity, raw);
          out.push({
            entity,
            id: row.id,
            clientUpdatedAt: row.clientUpdatedAt,
            deleted: false,
            row,
            cursor: `r:${JSON.stringify(raw[idColumn])}`,
            snapshot: rowSnapshot(entity, raw),
          });
        }
        if (out.length >= limit) return out;
      }

      // The settings row is never deleted, so it has no deletions to send.
      if (entity === 'settings') return out;

      const afterId = inTombstones ? after!.slice(2) : null;
      // A tombstone whose row exists again locally is obsolete: the row is
      // the newer truth and is sent instead (and settling it clears this).
      const tombstones = await db.getAllAsync<{ id: string; clientUpdatedAt: string }>(
        `SELECT t.id, t.clientUpdatedAt FROM sync_tombstones t
         WHERE t.entity = ?${afterId !== null ? ' AND t.id > ?' : ''}
           AND NOT EXISTS (SELECT 1 FROM ${name} x WHERE x.${idColumn} = t.id)
         ORDER BY t.id LIMIT ?`,
        afterId !== null ? [entity, afterId, limit - out.length] : [entity, limit - out.length],
      );
      for (const t of tombstones) {
        out.push({
          entity,
          id: t.id,
          clientUpdatedAt: t.clientUpdatedAt,
          deleted: true,
          row: { id: t.id, clientUpdatedAt: t.clientUpdatedAt, deleted: true },
          cursor: `t:${t.id}`,
          snapshot: t.clientUpdatedAt,
        });
      }
      return out;
    });
  }

  async function settlePush(outcomes: PushOutcome[]): Promise<SettleCounts> {
    const counts: SettleCounts = { settled: 0, changedSinceRead: 0, rejected: 0 };
    const answered = outcomes.filter((o) => o.status !== 'unanswered');
    if (answered.length === 0) return counts;

    return access.run((db) =>
      inTransaction(db, async () => {
        for (const entity of SYNC_ENTITIES) {
          const mine = answered.filter((o) => o.change.entity === entity);
          if (mine.length === 0) continue;
          const { table: name, idColumn } = table(entity);

          for (const { change, status } of mine.filter((o) => o.change.deleted)) {
            // The server has dealt with the deletion — done, ignored as stale,
            // or refused (nothing to edit on a deletion, so nothing to retry).
            // Dropped only if not deleted again since it was read.
            const result = await db.runAsync(
              `DELETE FROM sync_tombstones WHERE entity = ? AND id = ? AND clientUpdatedAt = ?`,
              [entity, change.id, change.snapshot],
            );
            if (result.changes > 0) {
              if (status === 'invalid' || status === 'forbidden') counts.rejected += 1;
              else counts.settled += 1;
            } else counts.changedSinceRead += 1;
          }

          const rows = mine.filter((o) => !o.change.deleted);
          if (rows.length === 0) continue;
          const current = await readRowsByKey(db, entity, rows.map((o) => toLocalKey(entity, o.change.id)));
          for (const { change, status } of rows) {
            const key = toLocalKey(entity, change.id);
            const now = current.get(key);
            if (!now || rowSnapshot(entity, now) !== change.snapshot) {
              counts.changedSinceRead += 1;
              continue;
            }
            if (status === 'invalid' || status === 'forbidden') {
              await db.runAsync(`UPDATE ${name} SET syncError = ? WHERE ${idColumn} = ?`, [status, key]);
              counts.rejected += 1;
              continue;
            }
            await db.runAsync(`UPDATE ${name} SET dirty = 0, syncError = NULL WHERE ${idColumn} = ?`, [key]);
            await db.runAsync(
              `DELETE FROM sync_tombstones WHERE entity = ? AND id = ? AND clientUpdatedAt <= ?`,
              [entity, change.id, change.clientUpdatedAt],
            );
            counts.settled += 1;
          }
        }
        return counts;
      }),
    );
  }

  async function getPullState(): Promise<PullState> {
    return access.run(async (db) => {
      const rows = await db.getAllAsync<{ key: string; value: string | null }>(
        `SELECT key, value FROM sync_meta WHERE key IN (?, ?, ?)`,
        [SYNC_META.cursor, SYNC_META.resyncActive, SYNC_META.entities],
      );
      const meta = new Map(rows.map((r) => [r.key, r.value]));
      // A cursor read under another entity set (an older build's) has passed
      // rows this build keeps and that build did not: start a full pull.
      if (meta.get(SYNC_META.entities) !== SYNC_ENTITY_SIGNATURE) return { cursor: null, resyncActive: false };
      return {
        cursor: meta.get(SYNC_META.cursor) || null,
        resyncActive: meta.get(SYNC_META.resyncActive) === '1',
      };
    });
  }

  async function resetPullState(): Promise<void> {
    await access.run(async (db) => {
      await setMeta(db, SYNC_META.cursor, null);
      await setMeta(db, SYNC_META.resyncActive, null);
    });
  }

  async function applyRows(db: SyncSqlDb, entity: SyncEntity, rows: WireRow[], counts: ApplyCounts): Promise<void> {
    const valid: WireRow[] = [];
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || row.id === '' || typeof row.clientUpdatedAt !== 'string') {
        counts.errors.push(`${entity}: a row without an id or clientUpdatedAt`);
        continue;
      }
      valid.push(row);
    }

    for (const part of chunks(valid, IN_CHUNK)) {
      const locals = await readRowsByKey(db, entity, part.map((r) => toLocalKey(entity, r.id)));
      const tombstones = entity === 'settings' ? new Map<string, string>() : await readTombstonesById(db, entity, part.map((r) => r.id));

      for (const row of part) {
        const key = toLocalKey(entity, row.id);
        const local = locals.get(key);
        // Edited here after the server's version was written: the local edit
        // is newer and is pushed next cycle. Ties go to the server.
        if (local && local.dirty === 1 && String(local.clientUpdatedAt) > row.clientUpdatedAt) {
          counts.skipped += 1;
          continue;
        }
        const tombstone = tombstones.get(row.id);
        // Deleted here, later than the server's version: the deletion wins.
        if (!local && tombstone !== undefined && tombstone > row.clientUpdatedAt) {
          counts.skipped += 1;
          continue;
        }

        const parsed = toLocalValues(entity, row);
        if ('error' in parsed) {
          counts.errors.push(parsed.error);
          continue;
        }
        try {
          if (tombstone !== undefined) {
            await db.runAsync(`DELETE FROM sync_tombstones WHERE entity = ? AND id = ?`, [entity, row.id]);
          }
          if (local && sameContent(entity, local, parsed.values, row.clientUpdatedAt)) continue;
          await upsertServerRow(db, entity, key, parsed.values, row.clientUpdatedAt);
          counts.changed += 1;
        } catch (e) {
          counts.errors.push(`${entity} ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  async function applyDeletion(db: SyncSqlDb, deletion: PullDeletion, counts: ApplyCounts): Promise<void> {
    const entity = deletion.entity;
    if (!(SYNC_ENTITIES as readonly string[]).includes(entity) || typeof deletion.id !== 'string') {
      counts.errors.push(`deletion of unknown entity ${String(entity)}`);
      return;
    }
    const { table: name, idColumn } = table(entity);
    const key = toLocalKey(entity, deletion.id);
    const local = await db.getFirstAsync<{ dirty: number; clientUpdatedAt: string }>(
      `SELECT dirty, clientUpdatedAt FROM ${name} WHERE ${idColumn} = ?`,
      [key],
    );
    // Edited here after the deletion: the edit is newer and resurrects the
    // row when it is pushed.
    if (local && local.dirty === 1 && local.clientUpdatedAt > String(deletion.clientUpdatedAt)) {
      counts.skipped += 1;
      return;
    }
    try {
      counts.changed += await deleteLocalRow(db, entity, key);
      // A local deletion of the same row has nothing left to do.
      await db.runAsync(`DELETE FROM sync_tombstones WHERE entity = ? AND id = ?`, [entity, deletion.id]);
    } catch (e) {
      counts.errors.push(`${entity} ${deletion.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function applyPullPage(page: PullResponse, options: ApplyOptions): Promise<ApplyCounts> {
    const counts: ApplyCounts = { changed: 0, skipped: 0, errors: [] };
    return access.run((db) =>
      inTransaction(db, async () => {
        if (options.wipe) counts.changed += await wipeSyncedRows(db);

        const { rows, deletions } = resolveDuplicates(page);
        for (const entity of SYNC_ENTITIES) {
          const entityRows = rows.get(entity) ?? [];
          if (entityRows.length > 0) await applyRows(db, entity, entityRows, counts);
        }
        for (const deletion of deletions) await applyDeletion(db, deletion, counts);

        // The last page of a snapshot: any subscription not restated by now is
        // gone, and so is the charge history derived for it.
        if (page.fullResync && !page.hasMore) {
          await db.runAsync(
            `DELETE FROM subscription_occurrences WHERE subscriptionId NOT IN (SELECT id FROM subscriptions)`,
          );
        }

        // In the same transaction as the rows: a cycle cut short resumes from
        // exactly what was applied. The signature says the cursor was read by
        // a build that keeps every entity this one does.
        await setMeta(db, SYNC_META.cursor, page.cursor);
        await setMeta(db, SYNC_META.entities, SYNC_ENTITY_SIGNATURE);
        await setMeta(db, SYNC_META.resyncActive, options.resyncActive ? '1' : null);
        await setMeta(db, SYNC_META.serverTime, typeof page.serverTime === 'string' ? page.serverTime : null);
        return counts;
      }),
    );
  }

  async function recomputeBalances(): Promise<void> {
    await access.run((db) =>
      db.runAsync(`
        UPDATE accounts SET balance = openingBalance + COALESCE((
          SELECT SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE -t.amount END)
          FROM transactions t WHERE t.accountId = accounts.id
        ), 0)
      `),
    );
  }

  return { readPending, settlePush, getPullState, resetPullState, applyPullPage, recomputeBalances };
}
