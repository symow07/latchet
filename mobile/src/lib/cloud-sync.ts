/**
 * Two-way cloud sync for the signed-in user: the engine (lib/sync/engine.ts)
 * over the user's own database (lib/sync/sqlite-store.ts), wired to its
 * triggers and to the network.
 *
 * Triggers:
 *   - a local write              debounced LOCAL_CHANGE_DEBOUNCE_MS (db.ts onLocalMutation)
 *   - the app coming to the front
 *   - every SYNC_INTERVAL_MS while the app is in front
 *   - activation                 the root layout calls syncNow(); on a fresh
 *                                database that is the full pull (no cursor yet)
 *   - explicit                   syncNow() / requestPull(): recurring run-now
 *                                (syncNow first, so a series made offline reaches
 *                                the server before it is run; requestPull after),
 *                                bank link and bank sync, after server-side work
 *   - leaving for the background, if a local write is still waiting to go
 *   - sign-out                   flushBeforeSignOut()
 *
 * Beside the sync, the same triggers report the phone's time zone to the
 * server (lib/timezone-report.ts), which dates recurring bookings and bill
 * reminders by the user's own day: after activation, then whenever it has
 * changed, checked as the app comes to the front and on the interval. Fire
 * and forget: a failed report waits for the next trigger and blocks nothing.
 *
 * Every outbound payload goes through redactDeviceOnly (sync-redaction.ts).
 *
 * A sync belongs to one user's database. The engine is created for the user
 * whose database is active, and every store operation checks, under db.ts's
 * write lock, that the same database is still the active one — so a cycle
 * still running when that user signs out or another signs in fails instead
 * of writing into the wrong ledger.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { ApiError, NetworkError, TimeoutError, api } from './api/api';
import { activeUserId, countUnsyncedChanges, getDatabase, onLocalMutation, withWriteLock, type SqlDb } from './db';
import { redactDeviceOnly } from './sync-redaction';
import { createSyncEngine, type SyncEngine, type SyncReport } from './sync/engine';
import {
  SyncTransportError,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncTransport,
} from './sync/protocol';
import { createSqliteSyncStore, type SyncDbAccess, type SyncSqlDb } from './sync/sqlite-store';
import { createTimezoneReporter, deviceTimeZone } from './timezone-report';

export type { SyncReport };

/** How often the app syncs while it is in front. */
export const SYNC_INTERVAL_MS = 60_000;
/** A burst of local writes (one add screen, an import) goes as one cycle. */
const LOCAL_CHANGE_DEBOUNCE_MS = 2_000;

// db.ts's database must be what the store expects. A compile-time check, so
// the store can stay free of db.ts (and of expo-sqlite) at runtime.
const sqlDbFitsStore = (db: SqlDb): SyncSqlDb => db;
void sqlDbFitsStore;

/** The store operation found a different database active than the one it was created for. */
class SyncUserChangedError extends Error {
  constructor() {
    super('The signed-in user changed during sync');
    this.name = 'SyncUserChangedError';
  }
}

/** Translate api.ts's failures into the engine's transport errors. */
function transportError(e: unknown, what: string): SyncTransportError {
  if (e instanceof SyncTransportError) return e;
  if (e instanceof NetworkError || e instanceof TimeoutError) return new SyncTransportError('network', `${what}: ${e.message}`);
  if (e instanceof ApiError) {
    const body = e.body as { code?: unknown; error?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' ? body.error : undefined;
    return new SyncTransportError('http', `${what}: ${e.message}`, e.status, code);
  }
  return new SyncTransportError('protocol', `${what}: ${e instanceof Error ? e.message : String(e)}`);
}

const transport: SyncTransport = {
  async push(request: PushRequest): Promise<PushResponse> {
    try {
      return await api.post<PushResponse>('/api/v1/sync/push', redactDeviceOnly(request));
    } catch (e) {
      throw transportError(e, 'push');
    }
  },
  async pull(cursor: string | null, limit: number): Promise<PullResponse> {
    const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    try {
      return await api.get<PullResponse>(`/api/v1/sync/pull?${query}`);
    } catch (e) {
      throw transportError(e, 'pull');
    }
  },
};

/**
 * The store's access to one activation's database: db.ts's write lock, and a
 * check that the database it hands over is still that one — not another
 * user's, and not this user's next file after a sign-out and sign-in.
 */
function accessFor(userId: string, handle: SqlDb): SyncDbAccess {
  return {
    run: (fn) =>
      withWriteLock(async (db, activeId) => {
        if (activeId !== userId || db !== handle) throw new SyncUserChangedError();
        return fn(db);
      }),
  };
}

/** One activation's sync: its engine (and so its single-flight guard) and store. */
interface Session {
  userId: string;
  handle: SqlDb;
  engine: SyncEngine;
  store: ReturnType<typeof createSqliteSyncStore>;
  /** Sign-out has flushed: no cycle may start until resumed or replaced. */
  suspended: boolean;
}

let session: Session | null = null;
let onRemoteChange: ((report: SyncReport) => void) | null = null;
let lastReported: SyncReport | null = null;
let lastWarning = '';

/**
 * The sync of the database active now; null when nobody's is. One per
 * activation, keyed on the database handle, so every trigger of that
 * activation shares one engine and never runs two cycles at once.
 */
async function currentSession(): Promise<Session | null> {
  const userId = activeUserId();
  if (!userId) return null;
  let handle: SqlDb;
  try {
    handle = await getDatabase();
  } catch {
    return null;
  }
  // Switched while waiting: whoever is active now gets asked again next time.
  if (activeUserId() !== userId) return null;
  if (!session || session.userId !== userId || session.handle !== handle) {
    const store = createSqliteSyncStore(accessFor(userId, handle));
    session = {
      userId,
      handle,
      store,
      engine: createSyncEngine({ store, transport, now: () => new Date().toISOString() }),
      suspended: false,
    };
  }
  return session;
}

function afterCycle(report: SyncReport): SyncReport {
  // Offline, the same failure repeats every minute: say it once.
  const warning = report.ok ? '' : report.errors.slice(0, 5).join(' | ');
  if (warning && warning !== lastWarning) console.warn('[sync] cycle finished with errors:', warning);
  lastWarning = warning;
  // Several triggers can join one cycle; screens refresh once for it.
  if (report !== lastReported) {
    lastReported = report;
    if (report.pulled.changed > 0) {
      try {
        onRemoteChange?.(report);
      } catch (e) {
        console.warn('[sync] refresh after pull failed', e);
      }
    }
  }
  return report;
}

/**
 * The phone's time zone, reported for the signed-in user (PUT /me/timezone).
 * Not while sign-out is under way: that user is leaving.
 */
const timezoneReporter = createTimezoneReporter({
  userId: () => {
    const userId = activeUserId();
    return session?.userId === userId && session.suspended ? null : userId;
  },
  zone: deviceTimeZone,
  // Like every payload this file sends: it carries nothing device-only, and
  // stays that way by construction (sync-redaction.ts).
  send: (timeZone) => api.put('/api/v1/me/timezone', redactDeviceOnly({ timeZone })),
  // A 400 is the server refusing this zone; anything else may pass.
  isRejected: (e) => e instanceof ApiError && e.status === 400,
});

function reportTimezone(): void {
  void timezoneReporter.report();
}

/**
 * Run a sync cycle that starts now or after the one in progress, and resolve
 * with its report. Null when nobody is signed in, or sign-out has begun.
 */
export async function syncNow(): Promise<SyncReport | null> {
  const s = await currentSession();
  if (!s || s.suspended) return null;
  return afterCycle(await s.engine.requestCycle());
}

/**
 * Ask for the server's latest, without waiting: after the server itself
 * changed this user's data (recurring run-now, a bank link or bank sync).
 */
export function requestPull(): void {
  void syncNow();
}

/** A periodic or foreground cycle: joining one already running is enough. */
function syncSoon(): void {
  void currentSession().then((s) => {
    if (!s || s.suspended) return;
    return s.engine.syncOnce().then(afterCycle);
  });
}

/** This database has never completed a pull: the first one is a full snapshot. */
export async function needsFirstPull(): Promise<boolean> {
  const s = await currentSession();
  if (!s) return false;
  const state = await s.store.getPullState();
  return state.cursor === null || state.resyncActive;
}

/** Local changes the server does not have yet (edits and deletions). */
export async function pendingChangeCount(): Promise<number> {
  return (await countUnsyncedChanges()).total;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
/** The teardown of the triggers startCloudSync wired, while they are wired. */
let unsubscribeAll: (() => void) | null = null;

function cancelDebounce(): boolean {
  if (!debounceTimer) return false;
  clearTimeout(debounceTimer);
  debounceTimer = null;
  return true;
}

function scheduleAfterLocalChange(): void {
  cancelDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow();
  }, LOCAL_CHANGE_DEBOUNCE_MS);
}

function startInterval(): void {
  if (intervalTimer) return;
  intervalTimer = setInterval(() => {
    syncSoon();
    reportTimezone();
  }, SYNC_INTERVAL_MS);
}

function stopInterval(): void {
  if (!intervalTimer) return;
  clearInterval(intervalTimer);
  intervalTimer = null;
}

/**
 * Send what can be sent before an explicit sign-out deletes this user's
 * database, and report what could not be (user-session.ts signOutAndClear
 * asks the user before discarding it).
 *
 * From here on no new cycle starts — no trigger may race the deletion that
 * follows. If the user then decides to stay, resumeCloudSync() lifts that.
 *
 * `send: false` (account deletion) only stops the triggers: the account the
 * changes would go to is already gone, so nothing is sent and nothing counts.
 */
export async function flushBeforeSignOut(options: { send?: boolean } = {}): Promise<{ unsynced: number }> {
  cancelDebounce();
  stopInterval();
  const s = await currentSession();
  if (!s) return { unsynced: options.send === false ? 0 : await pendingChangeCount() };
  s.suspended = true;
  if (options.send === false) return { unsynced: 0 };
  // Waits for a cycle in progress, then runs one more that sends everything left.
  afterCycle(await s.engine.requestCycle());
  return { unsynced: await pendingChangeCount() };
}

/** The user chose to stay signed in after flushBeforeSignOut: sync again. */
export function resumeCloudSync(): void {
  if (session) session.suspended = false;
  if (AppState.currentState === 'active' && unsubscribeAll) startInterval();
  requestPull();
}

export interface CloudSyncOptions {
  /** A pull changed local data: refresh what screens show. */
  onRemoteChange?: (report: SyncReport) => void;
}

/**
 * Wire the triggers for the active user. The root layout starts this once
 * that user's database is ready and calls the returned teardown when the user
 * changes, so no timer set for one user fires into the next one's session.
 * Starting it is the activation: the phone's time zone is reported here.
 */
export function startCloudSync(options: CloudSyncOptions = {}): () => void {
  unsubscribeAll?.();
  onRemoteChange = options.onRemoteChange ?? null;

  const stopLocal = onLocalMutation(scheduleAfterLocalChange);

  const onAppStateChange = (state: AppStateStatus) => {
    if (state === 'active') {
      startInterval();
      syncSoon();
      // The zone may have changed while the app was away (a flight).
      reportTimezone();
    } else if (state === 'background') {
      stopInterval();
      // A write still waiting for its debounce goes now, while iOS still
      // gives the app a moment; otherwise it waits for the next launch.
      if (cancelDebounce()) void syncNow();
    }
  };
  const appState = AppState.addEventListener('change', onAppStateChange);
  if (AppState.currentState === 'active') startInterval();
  // Activation: this user's database is open, so the server learns where they are.
  reportTimezone();

  const teardown = () => {
    stopLocal();
    appState.remove();
    cancelDebounce();
    stopInterval();
    onRemoteChange = null;
    // The session itself is kept: it is keyed on the database handle, so the
    // next activation (even of the same user) gets a new one by itself, and a
    // restart of these triggers for the same database keeps sharing its
    // single-flight guard.
    if (unsubscribeAll === teardown) unsubscribeAll = null;
  };
  unsubscribeAll = teardown;
  return teardown;
}
