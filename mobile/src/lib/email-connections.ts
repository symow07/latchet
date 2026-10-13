/**
 * The email client, on the phone (I-EMAIL-API, I-RUNNER).
 *
 * The server reads the user's mail — Gmail and Outlook through their APIs,
 * anything else by forwarding — and keeps only findings: what a billing email
 * says (merchant, amount, dates, kind). The phone pulls those findings into a
 * local cache (db.ts email_findings) and the one detection engine reads them
 * beside the ledger (subscription-detection.ts). Email never creates a
 * transaction.
 *
 *   connect     POST /connect/:provider with the app's return link, then the
 *               provider's sign-in in the system browser session; on success,
 *               wait (showing progress) for the first year's backfill, pull
 *               the findings and run detection.
 *   sync        POST /sync, wait briefly for the server's pass, pull, run
 *               detection — on the app coming to the front when an inbox is
 *               connected and the last sync is over half an hour old.
 *   pull        GET /findings?after=<the server's time at the last pull>,
 *               paged; a full refresh whenever the set of connections has
 *               changed (a disconnect elsewhere took its findings with it).
 *   disconnect  DELETE on the server, then this connection's findings here.
 *
 * Everything that decides something takes its effects as arguments
 * (createEmailClient), so email-connections.test.ts runs it without a device;
 * the network, the browser, storage and the database are imported lazily by
 * the app's own dependencies at the bottom. Requests reject with an
 * ApiFailure (lib/api-errors), whose message is in the reader's language.
 * Nothing here logs an address, a subject or an amount.
 */
import { request, toApiFailure } from './api-errors';
import type { LocalEmailFinding } from './db';
import { runDetection } from './subscription-detection';

export const EMAIL_CONNECTIONS_QUERY_KEY = ['email-connections'] as const;

export type EmailProvider = 'gmail' | 'outlook' | 'forwarding';
export type ConnectableProvider = 'gmail' | 'outlook';

/** One connected inbox, as GET /connections lists it. */
export interface EmailConnectionDTO {
  id: string;
  provider: EmailProvider;
  /** The account's address — for the screen that lists it, never for a log. */
  address: string;
  status: 'active' | 'needs_reauth' | 'error';
  syncState: 'idle' | 'backfilling' | 'syncing';
  lastSyncedAt: string | null;
  backfillDoneAt: string | null;
  messagesScanned: number;
  findingsCount: number;
  /** A short code, never mail text. */
  lastError: string | null;
  forwardingVerified?: boolean;
}

/** Which providers this server can connect. */
export interface EmailProvidersDTO {
  gmail: { configured: boolean; verified: boolean; capReached: boolean };
  outlook: { configured: boolean };
  forwarding: { configured: boolean };
}

export interface EmailConnectionsDTO {
  connections: EmailConnectionDTO[];
  providers: EmailProvidersDTO;
}

/**
 * How a disconnect left the provider's grant. Google's is revoked through its
 * API; Microsoft has no such call for personal accounts, so the server names
 * the page where the user removes Budget's access themselves.
 */
export interface DisconnectResult {
  revoked: boolean;
  /** Where to remove the access by hand, when it could not be revoked. */
  manualRevokeUrl: string | null;
}

/** The private forwarding address, as GET /inbox-address returns it. */
export interface ForwardingAddress {
  address: string;
  /** Mail has arrived at it (the forwarding works). */
  verified: boolean;
  /**
   * The code Gmail sends to confirm a new forwarding address, read by the
   * server from that email — the user types it back into Gmail. Null when
   * none has arrived.
   */
  confirmationCode: string | null;
}

/** One finding, as GET /findings sends it: the cache's own shape. */
export type EmailFindingDTO = LocalEmailFinding;

interface FindingsPage {
  findings: EmailFindingDTO[];
  serverTime: string;
  more: boolean;
}

/**
 * How a connect attempt ended. `reason`: 'not_configured' (the server has no
 * keys for this provider), 'cap_reached' (Gmail's unverified 100-user cap),
 * 'locked' (another browser session is open), 'browser', a server's own
 * reason from the return link, or an ApiFailure kind ('network', 'server'…).
 */
export interface ConnectResult {
  result: 'success' | 'cancel' | 'denied' | 'error';
  reason?: string;
}

export interface ConnectProgress {
  phase: 'authorizing' | 'backfilling' | 'pulling' | 'done';
  /** The connection being filled, once the server lists it. */
  connection: EmailConnectionDTO | null;
}

export interface SyncOptions {
  /**
   * The user asked for it and is looking at the result (pull to refresh): its
   * finds are on screen rather than announced, and detection may ask for
   * notification permission. A background sync leaves it unset.
   */
  watched?: boolean;
}

export interface ConnectOptions {
  onProgress?: (progress: ConnectProgress) => void;
  /** Set `aborted` to stop waiting for the backfill (the screen went away); the rest still runs. */
  signal?: { aborted: boolean };
  /**
   * Whether the detection run after the backfill may ask for notification
   * permission (true by default: the user is here and acting). Onboarding
   * passes false, so the one prompt comes at its payoff instead.
   */
  interactive?: boolean;
}

/** What expo-web-browser's openAuthSessionAsync resolves with. */
export interface BrowserResult {
  type: string;
  url?: string;
}

/** Stored per user (storage-keys.ts email_sync_state_v1). */
export interface EmailSyncState {
  /** The server's time at the end of the last pull: the next pull's `after`. */
  serverTime: string | null;
  /** The connections that pull covered, sorted. A different set means a full refresh. */
  connectionIds: string[];
  /** When this phone last finished an email sync (ISO). */
  lastSyncAt: string | null;
}

export const EMPTY_SYNC_STATE: EmailSyncState = { serverTime: null, connectionIds: [], lastSyncAt: null };

/** Paths under the server's /api/v1/email. */
export interface EmailClientDeps {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  /** The link the provider's sign-in returns to: realbudget://email/connected. */
  createReturnUrl(): Promise<string>;
  openAuthSession(url: string, returnUrl: string): Promise<BrowserResult>;
  readState(): Promise<EmailSyncState>;
  writeState(state: EmailSyncState): Promise<void>;
  upsertFindings(rows: readonly LocalEmailFinding[]): Promise<number>;
  getFindings(): Promise<LocalEmailFinding[]>;
  deleteFindings(ids?: readonly string[]): Promise<number>;
  /**
   * Run detection over the new evidence. `watched`: the user is waiting on it
   * (the inbox they just connected): its finds are on screen rather than
   * announced, and it may ask for notification permission unless
   * `interactive` is false.
   */
  detect(watched: boolean, interactive?: boolean): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

// ── Pure decisions ───────────────────────────────────────────────────────────

/** The server's findings window reaches this far behind `after` (I-EMAIL-API). */
export const FINDINGS_OVERLAP_MS = 10 * 60 * 1000;
/** A cursor older than every finding: a full refresh. */
const EPOCH = '1970-01-01T00:00:00.000Z';
/** A runaway guard: 1000 findings a page. */
const MAX_PAGES = 200;
/** How stale the last sync may be before the app coming to the front syncs again. */
export const FOREGROUND_SYNC_AFTER_MS = 30 * 60 * 1000;
const POLL_MS = 2_500;
/** A year of mail takes a while; after this the backfill carries on, and later syncs pull the rest. */
export const BACKFILL_WAIT_MS = 3 * 60 * 1000;
/** How long a sync waits for the server's pass before pulling what is there. */
const SYNC_WAIT_MS = 30_000;

/** The query of a return link, without URLSearchParams (React Native's lacks parts of it). */
export function queryParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const query = (url.split('?')[1] ?? '').split('#')[0] ?? '';
  for (const part of query.split('&')) {
    if (!part) continue;
    const [k, ...v] = part.split('=');
    try {
      out[decodeURIComponent(k!)] = decodeURIComponent(v.join('=').replace(/\+/g, ' '));
    } catch {
      // A malformed escape: skip that pair rather than fail the whole link.
    }
  }
  return out;
}

/**
 * Read the browser session's outcome. Closed by the user: cancel. Back on the
 * return link: what the server's callback said (success, denied — the user
 * refused access — or error, with its reason).
 */
export function readEmailBrowserResult(r: BrowserResult | null | undefined): ConnectResult {
  if (!r) return { result: 'error', reason: 'browser' };
  if (r.type === 'cancel' || r.type === 'dismiss') return { result: 'cancel' };
  if (r.type === 'locked') return { result: 'error', reason: 'locked' };
  if (r.type !== 'success') return { result: 'error', reason: 'browser' };
  const params = queryParams(r.url ?? '');
  const reason = params.reason || undefined;
  switch (params.result) {
    case 'success':
      return { result: 'success' };
    case 'denied':
      return reason ? { result: 'denied', reason } : { result: 'denied' };
    case 'error':
      return { result: 'error', reason: reason ?? 'server' };
    default:
      return { result: 'error', reason: 'no_result' };
  }
}

/** Whether a connection's first year has been read. */
export function backfillDone(c: EmailConnectionDTO): boolean {
  return !!c.backfillDoneAt;
}

/**
 * The connection a connect attempt filled: a new one for the provider, else
 * (a reconnect, the same account) the provider's busiest or latest one.
 */
export function connectedOne(
  list: readonly EmailConnectionDTO[],
  provider: ConnectableProvider,
  before: ReadonlySet<string>,
): EmailConnectionDTO | null {
  const mine = list.filter((c) => c.provider === provider);
  const fresh = mine.find((c) => !before.has(c.id));
  if (fresh) return fresh;
  const busy = mine.find((c) => c.syncState !== 'idle');
  if (busy) return busy;
  return [...mine].sort((a, b) => (b.lastSyncedAt ?? '').localeCompare(a.lastSyncedAt ?? ''))[0] ?? null;
}

/** The app came to the front: sync email when an inbox is connected and the last sync is stale. */
export function emailSyncDue(input: { connections: number; lastSyncAt: string | null; now: number }): boolean {
  if (input.connections <= 0) return false;
  const last = Date.parse(input.lastSyncAt ?? '');
  return !Number.isFinite(last) || input.now - last >= FOREGROUND_SYNC_AFTER_MS || last > input.now;
}

export function parseSyncState(raw: string | null | undefined): EmailSyncState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<EmailSyncState>) : null;
    if (!v || typeof v !== 'object') return { ...EMPTY_SYNC_STATE };
    return {
      serverTime: typeof v.serverTime === 'string' ? v.serverTime : null,
      connectionIds: Array.isArray(v.connectionIds) ? v.connectionIds.filter((x): x is string => typeof x === 'string').sort() : [],
      lastSyncAt: typeof v.lastSyncAt === 'string' ? v.lastSyncAt : null,
    };
  } catch {
    return { ...EMPTY_SYNC_STATE };
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function shiftISO(iso: string, ms: number): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + ms).toISOString() : null;
}

function normalizeConnections(raw: Partial<EmailConnectionsDTO> | null | undefined): EmailConnectionsDTO {
  const p = (raw?.providers ?? {}) as Partial<EmailProvidersDTO>;
  return {
    connections: Array.isArray(raw?.connections) ? raw!.connections.filter((c) => !!c?.id) : [],
    providers: {
      gmail: {
        configured: !!p.gmail?.configured,
        verified: !!p.gmail?.verified,
        capReached: !!p.gmail?.capReached,
      },
      outlook: { configured: !!p.outlook?.configured },
      forwarding: { configured: !!p.forwarding?.configured },
    },
  };
}

/**
 * The server's answer to a disconnect. An older server answered `{ ok: true }`
 * alone, which said nothing about the grant: read as revoked, as it then was
 * for every provider it could revoke. A manual page is only ever an https link.
 */
export function readDisconnect(res: { revoked?: unknown; manualRevokeUrl?: unknown } | null | undefined): DisconnectResult {
  const url = typeof res?.manualRevokeUrl === 'string' && /^https:\/\/[^\s]+$/.test(res.manualRevokeUrl) ? res.manualRevokeUrl : null;
  const revoked = typeof res?.revoked === 'boolean' ? res.revoked : !url;
  return { revoked, manualRevokeUrl: revoked ? null : url };
}

/** Gmail's forwarding confirmation code: digits only (nine today; the server reads 6 to 12), else none. */
export function confirmationCodeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return /^\d{6,12}$/.test(code) ? code : null;
}

// ── The client ───────────────────────────────────────────────────────────────

export interface EmailClient {
  getEmailConnections(): Promise<EmailConnectionsDTO>;
  connectEmailProvider(provider: ConnectableProvider, options?: ConnectOptions): Promise<ConnectResult>;
  disconnectEmailConnection(id: string): Promise<DisconnectResult>;
  syncEmailNow(options?: SyncOptions): Promise<{ newFindings: number }>;
  pullEmailFindings(options?: { full?: boolean }): Promise<{ newFindings: number; full: boolean }>;
  getForwardingAddress(): Promise<ForwardingAddress>;
  syncEmailIfDue(options?: { refresh?: boolean }): Promise<boolean>;
}

export function createEmailClient(deps: EmailClientDeps): EmailClient {
  let syncing: Promise<{ newFindings: number }> | null = null;
  let pulling: Promise<{ newFindings: number; full: boolean }> | null = null;

  async function getEmailConnections(): Promise<EmailConnectionsDTO> {
    return normalizeConnections(await request(() => deps.get<EmailConnectionsDTO>('/connections')));
  }

  async function pullOnce(full: boolean): Promise<{ newFindings: number; full: boolean }> {
    const state = await deps.readState();
    let ids: string[] | null = null;
    try {
      ids = (await getEmailConnections()).connections.map((c) => c.id).sort();
    } catch {
      ids = null;
    }
    const setChanged = ids !== null && !sameIds(ids, state.connectionIds);
    const whole = full || !state.serverTime || setChanged;

    let after = whole ? EPOCH : state.serverTime!;
    let serverTime: string | null = null;
    const fetched = new Map<string, EmailFindingDTO>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await request(() =>
        deps.get<FindingsPage>(`/findings?after=${encodeURIComponent(after)}`),
      );
      const rows = Array.isArray(res?.findings) ? res.findings : [];
      const held = fetched.size;
      for (const f of rows) if (f?.id) fetched.set(f.id, f);
      if (typeof res?.serverTime === 'string') serverTime = res.serverTime;
      if (!res?.more || rows.length === 0) break;
      // The server sends what arrived after `after` less a 10-minute overlap,
      // oldest first. To page on, move `after` past the overlap to the last
      // one's time, a millisecond short, so findings stored in the same
      // instant as it are not skipped. When that would not move (the page
      // brought nothing new, or ended inside a run of same-instant findings
      // it already began), step strictly past that instant instead.
      const last = rows[rows.length - 1]!.receivedAt;
      let next = shiftISO(last, FINDINGS_OVERLAP_MS - 1);
      if (!next || fetched.size === held || Date.parse(next) <= Date.parse(after)) {
        next = shiftISO(last, FINDINGS_OVERLAP_MS);
      }
      if (!next || Date.parse(next) <= Date.parse(after)) break;
      after = next;
    }

    if (whole) {
      // The server's set is the truth: what it no longer has goes here too.
      const keep = new Set(fetched.keys());
      const gone = (await deps.getFindings()).filter((f) => !keep.has(f.id)).map((f) => f.id);
      if (gone.length > 0) await deps.deleteFindings(gone);
    }
    const newFindings = fetched.size > 0 ? await deps.upsertFindings([...fetched.values()]) : 0;
    const latest = await deps.readState();
    await deps.writeState({
      ...latest,
      serverTime: serverTime ?? latest.serverTime,
      connectionIds: ids ?? latest.connectionIds,
    });
    return { newFindings, full: whole };
  }

  /** One pull at a time: a second caller joins the one running. */
  function pullEmailFindings(options: { full?: boolean } = {}): Promise<{ newFindings: number; full: boolean }> {
    if (pulling && !options.full) return pulling;
    const run = (pulling ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => pullOnce(!!options.full))
      .finally(() => {
        if (pulling === run) pulling = null;
      });
    pulling = run;
    return run;
  }

  /** Wait (bounded) until no connection is in the middle of a sync pass. */
  async function waitForServerPass(): Promise<void> {
    const deadline = deps.now() + SYNC_WAIT_MS;
    await deps.sleep(POLL_MS);
    while (deps.now() < deadline) {
      let list: EmailConnectionDTO[];
      try {
        list = (await getEmailConnections()).connections;
      } catch {
        return;
      }
      if (!list.some((c) => c.syncState === 'syncing')) return;
      await deps.sleep(POLL_MS);
    }
  }

  async function syncOnce(watched: boolean): Promise<{ newFindings: number }> {
    let started = true;
    try {
      const res = await request(() => deps.post<{ started?: number | boolean }>('/sync', {}));
      started = res?.started === undefined ? true : !!res.started;
    } catch (e) {
      // Synced less than a minute ago (429): what it found is ready to pull.
      // Anything else: the server's pass did not start, but its findings so
      // far are still worth pulling.
      started = false;
      if (toApiFailure(e).kind !== 'rateLimited') console.warn('[email] sync request failed', toApiFailure(e).kind);
    }
    if (started) await waitForServerPass();
    const { newFindings } = await pullEmailFindings();
    const state = await deps.readState();
    await deps.writeState({ ...state, lastSyncAt: new Date(deps.now()).toISOString() });
    await deps.detect(watched);
    return { newFindings };
  }

  /** Sync every inbox now, pull, run detection. One at a time; callers join the one running. */
  function syncEmailNow(options: SyncOptions = {}): Promise<{ newFindings: number }> {
    if (syncing) return syncing;
    const run = syncOnce(!!options.watched).finally(() => {
      if (syncing === run) syncing = null;
    });
    syncing = run;
    return run;
  }

  async function waitForBackfill(
    provider: ConnectableProvider,
    before: ReadonlySet<string>,
    options: ConnectOptions,
  ): Promise<EmailConnectionDTO | null> {
    const deadline = deps.now() + BACKFILL_WAIT_MS;
    let target: EmailConnectionDTO | null = null;
    for (;;) {
      if (options.signal?.aborted) break;
      try {
        target = connectedOne((await getEmailConnections()).connections, provider, before) ?? target;
      } catch {
        // A failed poll: try again on the next tick.
      }
      options.onProgress?.({ phase: 'backfilling', connection: target });
      if (target && (backfillDone(target) || target.status !== 'active')) break;
      if (deps.now() >= deadline) break;
      await deps.sleep(POLL_MS);
    }
    return target;
  }

  async function connectEmailProvider(
    provider: ConnectableProvider,
    options: ConnectOptions = {},
  ): Promise<ConnectResult> {
    let returnUrl: string;
    try {
      returnUrl = await deps.createReturnUrl();
    } catch {
      return { result: 'error', reason: 'browser' };
    }

    let before = new Set<string>();
    try {
      const listed = await getEmailConnections();
      // Said up front by the server's own list: no browser for a provider it cannot connect.
      if (!listed.providers[provider].configured) return { result: 'error', reason: 'not_configured' };
      if (provider === 'gmail' && listed.providers.gmail.capReached) return { result: 'error', reason: 'cap_reached' };
      before = new Set(listed.connections.map((c) => c.id));
    } catch {
      // Unknown: the server's answer to the connect request says it instead,
      // and the new connection is found by its state.
    }

    let authUrl: string | undefined;
    try {
      authUrl = (await request(() => deps.post<{ authUrl?: string }>(`/connect/${provider}`, { returnUrl }))).authUrl;
    } catch (e) {
      const failure = toApiFailure(e);
      const code = (failure.body as { error?: unknown } | null)?.error;
      if (code === 'not_configured' || failure.status === 503) return { result: 'error', reason: 'not_configured' };
      if (code === 'cap_reached' || failure.status === 409) return { result: 'error', reason: 'cap_reached' };
      return { result: 'error', reason: failure.kind };
    }
    if (!authUrl) return { result: 'error', reason: 'server' };

    options.onProgress?.({ phase: 'authorizing', connection: null });
    let outcome: ConnectResult;
    try {
      outcome = readEmailBrowserResult(await deps.openAuthSession(authUrl, returnUrl));
    } catch {
      return { result: 'error', reason: 'browser' };
    }
    if (outcome.result !== 'success') return outcome;

    // Connected. The rest is filling it: none of it can undo the connection.
    const connection = await waitForBackfill(provider, before, options);
    options.onProgress?.({ phase: 'pulling', connection });
    try {
      await pullEmailFindings();
      const state = await deps.readState();
      await deps.writeState({ ...state, lastSyncAt: new Date(deps.now()).toISOString() });
    } catch (e) {
      console.warn('[email] first pull failed', toApiFailure(e).kind);
    }
    await deps.detect(true, options.interactive ?? true);
    options.onProgress?.({ phase: 'done', connection });
    return { result: 'success' };
  }

  async function disconnectEmailConnection(id: string): Promise<DisconnectResult> {
    const res = await request(() =>
      deps.del<{ ok?: boolean; revoked?: boolean; manualRevokeUrl?: unknown }>(`/connections/${encodeURIComponent(id)}`),
    );
    // The server deleted its findings; this phone's copy of them goes too.
    const mine = (await deps.getFindings()).filter((f) => f.connectionId === id).map((f) => f.id);
    await deps.deleteFindings(mine);
    const state = await deps.readState();
    await deps.writeState({ ...state, connectionIds: state.connectionIds.filter((x) => x !== id) });
    return readDisconnect(res);
  }

  async function getForwardingAddress(): Promise<ForwardingAddress> {
    const res = await request(() =>
      deps.get<{ address: string; verified?: boolean; confirmationCode?: unknown }>('/inbox-address'),
    );
    return { address: res.address, verified: !!res.verified, confirmationCode: confirmationCodeOf(res.confirmationCode) };
  }

  async function syncEmailIfDue(options: { refresh?: boolean } = {}): Promise<boolean> {
    try {
      const state = await deps.readState();
      let connections = state.connectionIds.length;
      if (options.refresh) {
        try {
          connections = (await getEmailConnections()).connections.length;
        } catch {
          // Offline: decide from what this phone last knew.
        }
      }
      if (!emailSyncDue({ connections, lastSyncAt: state.lastSyncAt, now: deps.now() })) return false;
      await syncEmailNow();
      return true;
    } catch (e) {
      console.warn('[email] background sync failed', toApiFailure(e).kind);
      return false;
    }
  }

  return {
    getEmailConnections,
    connectEmailProvider,
    disconnectEmailConnection,
    syncEmailNow,
    pullEmailFindings,
    getForwardingAddress,
    syncEmailIfDue,
  };
}

// ── The app's client ─────────────────────────────────────────────────────────

const BASE = '/api/v1/email';
/** Per user (storage-keys.ts): the findings cursor, the connections it covers, the last sync. */
const SYNC_STATE_KEY = 'email_sync_state_v1';

async function client() {
  return (await import('./api/api')).api;
}

const appDeps: EmailClientDeps = {
  get: async <T>(path: string) => (await client()).get<T>(`${BASE}${path}`),
  post: async <T>(path: string, body: unknown) => (await client()).post<T>(`${BASE}${path}`, body),
  del: async <T>(path: string) => (await client()).delete<T>(`${BASE}${path}`),
  createReturnUrl: async () => (await import('expo-linking')).createURL('email/connected'),
  openAuthSession: async (url, returnUrl) => {
    const WebBrowser = await import('expo-web-browser');
    return WebBrowser.openAuthSessionAsync(url, returnUrl);
  },
  readState: async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const { userKey } = await import('./storage-keys');
    return parseSyncState(await AsyncStorage.getItem(userKey(SYNC_STATE_KEY)));
  },
  writeState: async (state) => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const { userKey } = await import('./storage-keys');
    await AsyncStorage.setItem(userKey(SYNC_STATE_KEY), JSON.stringify(state));
  },
  upsertFindings: async (rows) => (await import('./db')).upsertEmailFindings(rows),
  getFindings: async () => (await import('./db')).getEmailFindings(),
  deleteFindings: async (ids) => (await import('./db')).deleteEmailFindings(ids),
  detect: (watched, interactive = watched) =>
    watched ? runDetection('email', { interactive, announce: false }) : runDetection('email'),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

const app = createEmailClient(appDeps);

/** The user's connected inboxes, and which providers this server offers. */
export const getEmailConnections = (): Promise<EmailConnectionsDTO> => app.getEmailConnections();

/**
 * Connect Gmail or Outlook: the provider's sign-in in the system browser,
 * back on realbudget://email/connected; on success, the first year's
 * backfill (progress through `onProgress`), the findings, and detection.
 */
export const connectEmailProvider = (provider: ConnectableProvider, options?: ConnectOptions): Promise<ConnectResult> =>
  app.connectEmailProvider(provider, options);

/**
 * Disconnect an inbox: revoked and deleted on the server, its findings gone
 * here. Says whether the provider's grant was revoked, and if not (Outlook's
 * personal accounts) the page where the user removes it.
 */
export const disconnectEmailConnection = (id: string): Promise<DisconnectResult> => app.disconnectEmailConnection(id);

/** Sync every inbox now, pull the findings and run detection. */
export const syncEmailNow = (options?: SyncOptions): Promise<{ newFindings: number }> => app.syncEmailNow(options);

/** Pull new findings into this phone's cache (`full` re-reads them all). */
export const pullEmailFindings = (options?: { full?: boolean }): Promise<{ newFindings: number; full: boolean }> =>
  app.pullEmailFindings(options);

/** This user's private forwarding address (created on first ask), with Gmail's confirmation code once it has come. */
export const getForwardingAddress = (): Promise<ForwardingAddress> => app.getForwardingAddress();

/**
 * Sync email if an inbox is connected and the last sync is over half an hour
 * old: on the app coming to the front, and (with `refresh`, which asks the
 * server which inboxes there are) once per activation. Never rejects.
 */
export const syncEmailIfDue = (options?: { refresh?: boolean }): Promise<boolean> => app.syncEmailIfDue(options);
