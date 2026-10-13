import { describe, expect, test } from 'bun:test';
import type { LocalEmailFinding } from './db';
import {
  EMPTY_SYNC_STATE,
  FINDINGS_OVERLAP_MS,
  confirmationCodeOf,
  createEmailClient,
  emailSyncDue,
  parseSyncState,
  readDisconnect,
  readEmailBrowserResult,
  type BrowserResult,
  type ConnectProgress,
  type EmailClientDeps,
  type EmailConnectionDTO,
  type EmailSyncState,
} from './email-connections';

/**
 * The email client against a stand-in server (I-EMAIL-API, as leaf 6.5
 * builds it), a stand-in browser session and an in-memory findings cache.
 * Nothing here talks to Google, Microsoft or the network.
 */

/** What api/api.ts throws for a response that is not ok. */
const apiError = (status: number, body: unknown) =>
  Object.assign(new Error(`HTTP ${status}`), { name: 'ApiError', status, body });

const connection = (over: Partial<EmailConnectionDTO> & Pick<EmailConnectionDTO, 'id'>): EmailConnectionDTO => ({
  provider: 'gmail',
  address: 'someone@example.com',
  status: 'active',
  syncState: 'idle',
  lastSyncedAt: '2026-10-12T08:00:00.000Z',
  backfillDoneAt: '2026-10-01T08:00:00.000Z',
  messagesScanned: 120,
  findingsCount: 3,
  lastError: null,
  ...over,
});

const finding = (id: string, receivedAt: string, connectionId = 'conn_g'): LocalEmailFinding => ({
  id,
  connectionId,
  source: 'gmail',
  kind: 'receipt',
  merchant: 'Netflix',
  senderDomain: 'netflix.com',
  billedVia: null,
  amount: 15.49,
  currency: 'USD',
  cadence: 'monthly',
  chargedISO: '2026-10-01',
  emailDateISO: '2026-10-01',
  nextChargeISO: null,
  trialEndsISO: null,
  previousAmount: null,
  confidence: 0.9,
  receivedAt,
});

interface World {
  connections: EmailConnectionDTO[];
  findings: LocalEmailFinding[];
  providers: { gmail: { configured: boolean; verified: boolean; capReached: boolean }; outlook: { configured: boolean }; forwarding: { configured: boolean } };
  pageSize: number;
  serverTime: string;
  calls: string[];
  connectError: unknown;
  syncError: unknown;
  deleteError: unknown;
  /** What DELETE /connections/:id answers for a connection (I-EMAIL-API, leaf 6.5). */
  deleteBody: (conn: EmailConnectionDTO | undefined) => unknown;
  /** What GET /inbox-address answers. */
  inbox: Record<string, unknown>;
  browser: BrowserResult | Error;
  /** Called on every GET /connections: lets a test move the server along. */
  onPoll: (n: number) => void;
}

function setup(over: Partial<World> = {}) {
  const world: World = {
    connections: [],
    findings: [],
    providers: { gmail: { configured: true, verified: false, capReached: false }, outlook: { configured: true }, forwarding: { configured: true } },
    pageSize: 1000,
    serverTime: '2026-10-12T12:00:00.000Z',
    calls: [],
    connectError: null,
    syncError: null,
    deleteError: null,
    // The server's answer: Google's grant is revoked through its API; Microsoft
    // has no such call for personal accounts, so it names the page.
    deleteBody: (conn) =>
      conn?.provider === 'outlook'
        ? { ok: true, revoked: false, manualRevokeUrl: 'https://account.live.com/consent/Manage' }
        : { ok: true, revoked: true },
    inbox: { address: 'u-7f3a@in.realbudget.app', verified: true, confirmationCode: null },
    browser: { type: 'success', url: 'realbudget://email/connected?provider=gmail&result=success' },
    onPoll: () => {},
    ...over,
  };
  const cache = new Map<string, LocalEmailFinding>();
  let state: EmailSyncState = { ...EMPTY_SYNC_STATE };
  let clock = Date.parse('2026-10-12T12:00:00.000Z');
  let polls = 0;
  let detections: boolean[] = [];
  /** Whether each run may ask for notification permission. */
  let interactives: boolean[] = [];

  const deps: EmailClientDeps = {
    get: async <T>(path: string): Promise<T> => {
      world.calls.push(`GET ${path}`);
      if (path === '/connections') {
        world.onPoll(++polls);
        return { connections: world.connections, providers: world.providers } as T;
      }
      if (path.startsWith('/findings?after=')) {
        const after = Date.parse(decodeURIComponent(path.slice('/findings?after='.length)));
        // The server's window: what arrived after `after`, less ten minutes; oldest first.
        const rows = world.findings
          .filter((f) => Date.parse(f.receivedAt) > after - FINDINGS_OVERLAP_MS)
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
        return { findings: rows.slice(0, world.pageSize), serverTime: world.serverTime, more: rows.length > world.pageSize } as T;
      }
      if (path === '/inbox-address') return world.inbox as T;
      throw apiError(404, { error: 'Not found' });
    },
    post: async <T>(path: string, body: unknown): Promise<T> => {
      world.calls.push(`POST ${path} ${JSON.stringify(body)}`);
      if (path.startsWith('/connect/')) {
        if (world.connectError) throw world.connectError;
        return { authUrl: 'https://accounts.example.test/o/oauth2/auth?state=abc' } as T;
      }
      if (path === '/sync') {
        if (world.syncError) throw world.syncError;
        return { started: world.connections.length } as T;
      }
      throw apiError(404, { error: 'Not found' });
    },
    del: async <T>(path: string): Promise<T> => {
      world.calls.push(`DELETE ${path}`);
      if (world.deleteError) throw world.deleteError;
      const id = decodeURIComponent(path.split('/').pop()!);
      const gone = world.connections.find((c) => c.id === id);
      world.connections = world.connections.filter((c) => c.id !== id);
      world.findings = world.findings.filter((f) => f.connectionId !== id);
      return world.deleteBody(gone) as T;
    },
    createReturnUrl: async () => 'realbudget://email/connected',
    openAuthSession: async (url, returnUrl) => {
      world.calls.push(`BROWSER ${url} -> ${returnUrl}`);
      if (world.browser instanceof Error) throw world.browser;
      return world.browser;
    },
    readState: async () => ({ ...state, connectionIds: [...state.connectionIds] }),
    writeState: async (s) => {
      state = { ...s, connectionIds: [...s.connectionIds] };
    },
    upsertFindings: async (rows) => {
      let fresh = 0;
      for (const r of rows) {
        if (!cache.has(r.id)) fresh++;
        cache.set(r.id, r);
      }
      return fresh;
    },
    getFindings: async () => [...cache.values()],
    deleteFindings: async (ids) => {
      if (ids === undefined) {
        const n = cache.size;
        cache.clear();
        return n;
      }
      let n = 0;
      for (const id of ids) if (cache.delete(id)) n++;
      return n;
    },
    detect: async (watched, interactive) => {
      detections.push(watched);
      interactives.push(interactive ?? watched);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return {
    world,
    cache,
    client: createEmailClient(deps),
    state: () => state,
    setState: (s: Partial<EmailSyncState>) => {
      state = { ...state, ...s };
    },
    detections: () => detections,
    interactives: () => interactives,
    resetDetections: () => {
      detections = [];
      interactives = [];
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('email client', () => {
  test('the browser session’s outcome: success, cancel, denied, error, and a session already open', async () => {
    expect(readEmailBrowserResult({ type: 'success', url: 'realbudget://email/connected?provider=gmail&result=success' })).toEqual({ result: 'success' });
    expect(readEmailBrowserResult({ type: 'cancel' })).toEqual({ result: 'cancel' });
    expect(readEmailBrowserResult({ type: 'dismiss' })).toEqual({ result: 'cancel' });
    expect(readEmailBrowserResult({ type: 'success', url: 'realbudget://email/connected?provider=outlook&result=denied' })).toEqual({ result: 'denied' });
    expect(
      readEmailBrowserResult({ type: 'success', url: 'realbudget://email/connected?provider=gmail&result=error&reason=scope_missing#_' }),
    ).toEqual({ result: 'error', reason: 'scope_missing' });
    expect(readEmailBrowserResult({ type: 'success', url: 'realbudget://email/connected' })).toEqual({ result: 'error', reason: 'no_result' });
    expect(readEmailBrowserResult({ type: 'locked' })).toEqual({ result: 'error', reason: 'locked' });
    expect(readEmailBrowserResult(null)).toEqual({ result: 'error', reason: 'browser' });

    // Through connect: the browser opens on the server's URL and returns to the app's link.
    for (const [browser, expected] of [
      [{ type: 'cancel' }, { result: 'cancel' }],
      [{ type: 'success', url: 'realbudget://email/connected?provider=gmail&result=denied' }, { result: 'denied' }],
      [{ type: 'success', url: 'realbudget://email/connected?provider=gmail&result=error&reason=state_expired' }, { result: 'error', reason: 'state_expired' }],
      [new Error('ASWebAuthenticationSession failed'), { result: 'error', reason: 'browser' }],
    ] as const) {
      const t = setup({ browser: browser as BrowserResult | Error });
      expect(await t.client.connectEmailProvider('gmail')).toEqual(expected);
      expect(t.world.calls).toContain('POST /connect/gmail {"returnUrl":"realbudget://email/connected"}');
      expect(t.world.calls).toContain('BROWSER https://accounts.example.test/o/oauth2/auth?state=abc -> realbudget://email/connected');
      // Nothing pulled, nothing detected, for a connection that did not happen.
      expect(t.world.calls.some((c) => c.startsWith('GET /findings'))).toBe(false);
      expect(t.detections()).toEqual([]);
    }
  });

  test('unconfigured providers are reported, and a refusal never opens the browser', async () => {
    const t = setup({
      providers: { gmail: { configured: false, verified: false, capReached: false }, outlook: { configured: true }, forwarding: { configured: false } },
    });
    const listed = await t.client.getEmailConnections();
    expect(listed.providers).toEqual({
      gmail: { configured: false, verified: false, capReached: false },
      outlook: { configured: true },
      forwarding: { configured: false },
    });

    // The list says Gmail is not set up: no connect request, no browser.
    expect(await t.client.connectEmailProvider('gmail')).toEqual({ result: 'error', reason: 'not_configured' });
    expect(t.world.calls.some((c) => c.startsWith('POST /connect'))).toBe(false);
    t.world.providers.gmail = { configured: true, verified: false, capReached: true };
    expect(await t.client.connectEmailProvider('gmail')).toEqual({ result: 'error', reason: 'cap_reached' });

    // The server's own refusals, when its list could not say (or changed since).
    t.world.providers.gmail = { configured: true, verified: false, capReached: false };
    t.world.connectError = apiError(503, { error: 'not_configured' });
    expect(await t.client.connectEmailProvider('gmail')).toEqual({ result: 'error', reason: 'not_configured' });
    t.world.connectError = apiError(409, { error: 'cap_reached' });
    expect(await t.client.connectEmailProvider('gmail')).toEqual({ result: 'error', reason: 'cap_reached' });
    t.world.connectError = Object.assign(new Error('Network request failed'), { name: 'NetworkError' });
    expect(await t.client.connectEmailProvider('outlook')).toEqual({ result: 'error', reason: 'network' });
    expect(t.world.calls.some((c) => c.startsWith('BROWSER'))).toBe(false);

    // A server that sends a partial answer still reads as "not configured", never as a crash.
    const partial = setup();
    (partial.world as { providers: unknown }).providers = {};
    expect((await partial.client.getEmailConnections()).providers.outlook).toEqual({ configured: false });
  });

  test('a connect that succeeds waits for the year’s backfill, showing progress, then pulls the findings and runs detection', async () => {
    const t = setup({ connections: [connection({ id: 'conn_old', provider: 'outlook' })] });
    const fresh = connection({ id: 'conn_new', syncState: 'backfilling', backfillDoneAt: null, messagesScanned: 0, findingsCount: 0 });
    t.world.onPoll = (n) => {
      // The callback has run by the second poll; the backfill finishes on the fourth.
      if (n === 2) t.world.connections = [...t.world.connections, fresh];
      if (n === 3) fresh.messagesScanned = 800;
      if (n === 4) {
        Object.assign(fresh, { syncState: 'idle', backfillDoneAt: '2026-10-12T12:01:00.000Z', messagesScanned: 2400, findingsCount: 2 });
        t.world.findings = [finding('f1', '2026-10-12T12:00:30.000Z', 'conn_new'), finding('f2', '2026-10-12T12:00:40.000Z', 'conn_new')];
      }
    };
    const progress: ConnectProgress[] = [];
    const result = await t.client.connectEmailProvider('gmail', { onProgress: (p) => progress.push(structuredClone(p)) });

    expect(result).toEqual({ result: 'success' });
    expect(progress.map((p) => [p.phase, p.connection?.id ?? null, p.connection?.messagesScanned ?? null])).toEqual([
      ['authorizing', null, null],
      ['backfilling', 'conn_new', 0],
      ['backfilling', 'conn_new', 800],
      ['backfilling', 'conn_new', 2400],
      ['pulling', 'conn_new', 2400],
      ['done', 'conn_new', 2400],
    ]);
    expect([...t.cache.keys()].sort()).toEqual(['f1', 'f2']);
    // The user is waiting on this run: it may ask for notification permission.
    expect(t.detections()).toEqual([true]);
    expect(t.interactives()).toEqual([true]);
    expect(t.state().connectionIds).toEqual(['conn_new', 'conn_old']);
    expect(t.state().serverTime).toBe('2026-10-12T12:00:00.000Z');
    expect(t.state().lastSyncAt).not.toBeNull();
  });

  test('a connect made during onboarding can keep its detection from asking for notification permission', async () => {
    const t = setup();
    t.world.onPoll = (n) => {
      if (n === 2) t.world.connections = [connection({ id: 'conn_new' })];
    };
    expect(await t.client.connectEmailProvider('gmail', { interactive: false })).toEqual({ result: 'success' });
    // Still watched (its finds are on screen, not announced), but it asks for nothing.
    expect(t.detections()).toEqual([true]);
    expect(t.interactives()).toEqual([false]);

    // Left out, it is interactive as before.
    t.resetDetections();
    t.world.connections = [];
    t.world.onPoll = (n) => {
      if (n >= 1) t.world.connections = [connection({ id: 'conn_other', provider: 'outlook' })];
    };
    expect(await t.client.connectEmailProvider('outlook')).toEqual({ result: 'success' });
    expect(t.interactives().at(-1)).toBe(true);
  });

  test('sync, then pull from the stored cursor, then detection; a sync refused for being too soon still pulls', async () => {
    const t = setup({ connections: [connection({ id: 'conn_g' })] });
    t.world.findings = [finding('old1', '2026-10-01T09:00:00.000Z')];
    t.setState({ serverTime: '2026-10-11T12:00:00.000Z', connectionIds: ['conn_g'] });
    t.cache.set('old1', t.world.findings[0]!);
    t.world.findings.push(finding('new1', '2026-10-12T11:58:00.000Z'), finding('new2', '2026-10-12T11:59:00.000Z'));
    t.world.serverTime = '2026-10-12T12:00:05.000Z';

    expect(await t.client.syncEmailNow()).toEqual({ newFindings: 2 });
    expect(t.world.calls).toContain('POST /sync {}');
    // Asked from the stored server time, not from the start.
    expect(t.world.calls).toContain(`GET /findings?after=${encodeURIComponent('2026-10-11T12:00:00.000Z')}`);
    expect(t.state().serverTime).toBe('2026-10-12T12:00:05.000Z');
    expect(t.detections()).toEqual([false]);

    // Within the minute: 429. What the last pass found is pulled all the same.
    t.world.syncError = apiError(429, { error: 'Too many requests', retryAfter: 40 });
    t.world.findings.push(finding('new3', '2026-10-12T12:00:20.000Z'));
    expect(await t.client.syncEmailNow()).toEqual({ newFindings: 1 });
    expect(t.world.calls.at(-1)).toBe(`GET /findings?after=${encodeURIComponent('2026-10-12T12:00:05.000Z')}`);
    expect(t.detections()).toEqual([false, false]);

    // Pulled to refresh: the user is looking, so detection runs as watched.
    t.world.syncError = null;
    await t.client.syncEmailNow({ watched: true });
    expect(t.detections()).toEqual([false, false, true]);
  });

  test('paging moves past the server’s ten-minute overlap, keeps findings stored in the same instant, and ends', async () => {
    const t = setup({ connections: [connection({ id: 'conn_g' })], pageSize: 3 });
    t.world.findings = [
      finding('a', '2026-10-12T10:00:00.000Z'),
      finding('b', '2026-10-12T10:00:01.000Z'),
      finding('c', '2026-10-12T10:00:01.000Z'),
      // The first page ends between c and d, stored in the same instant.
      finding('d', '2026-10-12T10:00:01.000Z'),
      finding('e', '2026-10-12T10:05:00.000Z'),
      finding('f', '2026-10-12T10:06:00.000Z'),
    ];
    const pulled = await t.client.pullEmailFindings();
    expect(pulled).toEqual({ newFindings: 6, full: true });
    expect([...t.cache.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(t.world.calls.filter((c) => c.startsWith('GET /findings')).length).toBeLessThan(6);

    // More findings in one instant than a page holds cannot all be reached
    // through a time cursor; the pull still ends, and gets past them.
    const crowded = setup({ connections: [connection({ id: 'conn_g' })], pageSize: 2 });
    crowded.world.findings = ['p', 'q', 'r', 's'].map((id) => finding(id, '2026-10-12T10:00:01.000Z')).concat(finding('z', '2026-10-12T11:00:00.000Z'));
    await crowded.client.pullEmailFindings();
    expect(crowded.cache.has('z')).toBe(true);
    expect(crowded.world.calls.filter((c) => c.startsWith('GET /findings')).length).toBeLessThan(6);
  });

  test('a changed set of connections means a full refresh: findings the server no longer has go here too', async () => {
    const t = setup({ connections: [connection({ id: 'conn_g' })] });
    t.setState({ serverTime: '2026-10-12T11:00:00.000Z', connectionIds: ['conn_g', 'conn_gone'] });
    t.cache.set('kept', finding('kept', '2026-10-01T09:00:00.000Z'));
    t.cache.set('orphan', finding('orphan', '2026-10-01T09:00:00.000Z', 'conn_gone'));
    t.world.findings = [finding('kept', '2026-10-01T09:00:00.000Z')];
    expect(await t.client.pullEmailFindings()).toEqual({ newFindings: 0, full: true });
    expect(t.world.calls).toContain(`GET /findings?after=${encodeURIComponent('1970-01-01T00:00:00.000Z')}`);
    expect([...t.cache.keys()]).toEqual(['kept']);
    expect(t.state().connectionIds).toEqual(['conn_g']);
    // Unchanged set next time: incremental again.
    expect((await t.client.pullEmailFindings()).full).toBe(false);
  });

  test('disconnect deletes on the server, then that connection’s findings here and nothing else', async () => {
    const t = setup({ connections: [connection({ id: 'conn_g' }), connection({ id: 'conn_o', provider: 'outlook' })] });
    t.setState({ serverTime: '2026-10-12T11:00:00.000Z', connectionIds: ['conn_g', 'conn_o'] });
    t.cache.set('g1', finding('g1', '2026-10-01T09:00:00.000Z', 'conn_g'));
    t.cache.set('o1', finding('o1', '2026-10-02T09:00:00.000Z', 'conn_o'));
    await t.client.disconnectEmailConnection('conn_g');
    expect(t.world.calls).toContain('DELETE /connections/conn_g');
    expect([...t.cache.keys()]).toEqual(['o1']);
    expect(t.state().connectionIds).toEqual(['conn_o']);

    // A server refusal rejects in the reader's language, and leaves the local findings alone.
    t.world.deleteError = apiError(500, { error: 'boom' });
    await expect(t.client.disconnectEmailConnection('conn_o')).rejects.toMatchObject({ name: 'ApiFailure', kind: 'server' });
    expect([...t.cache.keys()]).toEqual(['o1']);
  });

  test('disconnect says whether the grant was revoked, and for Outlook the page where the user removes it', async () => {
    const t = setup({ connections: [connection({ id: 'conn_g' }), connection({ id: 'conn_o', provider: 'outlook' })] });
    t.setState({ connectionIds: ['conn_g', 'conn_o'] });
    expect(await t.client.disconnectEmailConnection('conn_g')).toEqual({ revoked: true, manualRevokeUrl: null });
    expect(await t.client.disconnectEmailConnection('conn_o')).toEqual({
      revoked: false,
      manualRevokeUrl: 'https://account.live.com/consent/Manage',
    });
    expect(t.state().connectionIds).toEqual([]);

    // Google refused the revoke: the server names Google's page instead.
    const g = setup({ connections: [connection({ id: 'conn_g2' })] });
    g.world.deleteBody = () => ({ ok: true, revoked: false, manualRevokeUrl: 'https://myaccount.google.com/permissions' });
    expect(await g.client.disconnectEmailConnection('conn_g2')).toEqual({
      revoked: false,
      manualRevokeUrl: 'https://myaccount.google.com/permissions',
    });

    // What the answer can be: an older server's bare ok, junk, a link that is not https.
    expect(readDisconnect({ ok: true } as never)).toEqual({ revoked: true, manualRevokeUrl: null });
    expect(readDisconnect(null)).toEqual({ revoked: true, manualRevokeUrl: null });
    expect(readDisconnect({ revoked: false })).toEqual({ revoked: false, manualRevokeUrl: null });
    expect(readDisconnect({ revoked: false, manualRevokeUrl: 'javascript:alert(1)' })).toEqual({ revoked: false, manualRevokeUrl: null });
    expect(readDisconnect({ revoked: true, manualRevokeUrl: 'https://account.live.com/consent/Manage' })).toEqual({
      revoked: true,
      manualRevokeUrl: null,
    });
  });

  test('the forwarding address carries Gmail’s confirmation code once it has come, and nothing else', async () => {
    const t = setup();
    expect(await t.client.getForwardingAddress()).toEqual({
      address: 'u-7f3a@in.realbudget.app',
      verified: true,
      confirmationCode: null,
    });
    t.world.inbox = { address: 'u-7f3a@in.realbudget.app', verified: false, confirmationCode: '583920174' };
    expect(await t.client.getForwardingAddress()).toEqual({
      address: 'u-7f3a@in.realbudget.app',
      verified: false,
      confirmationCode: '583920174',
    });
    // An older server sends no code at all.
    t.world.inbox = { address: 'u-7f3a@in.realbudget.app' };
    expect((await t.client.getForwardingAddress()).confirmationCode).toBeNull();

    expect(confirmationCodeOf(' 583920174 ')).toBe('583920174');
    expect(confirmationCodeOf('12345')).toBeNull();
    expect(confirmationCodeOf('58392017x')).toBeNull();
    expect(confirmationCodeOf(583920174)).toBeNull();
    expect(confirmationCodeOf(undefined)).toBeNull();
  });

  test('the app coming to the front syncs only when an inbox is connected and the last sync is over half an hour old', async () => {
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    expect(emailSyncDue({ connections: 0, lastSyncAt: null, now })).toBe(false);
    expect(emailSyncDue({ connections: 1, lastSyncAt: null, now })).toBe(true);
    expect(emailSyncDue({ connections: 1, lastSyncAt: '2026-10-12T11:45:00.000Z', now })).toBe(false);
    expect(emailSyncDue({ connections: 2, lastSyncAt: '2026-10-12T11:29:00.000Z', now })).toBe(true);
    // A clock that went backwards does not stop syncing for ever.
    expect(emailSyncDue({ connections: 1, lastSyncAt: '2026-10-13T11:00:00.000Z', now })).toBe(true);

    // A new phone knows of no inbox until it asks the server (once per activation).
    const t = setup({ connections: [connection({ id: 'conn_g' })] });
    expect(await t.client.syncEmailIfDue()).toBe(false);
    expect(await t.client.syncEmailIfDue({ refresh: true })).toBe(true);
    expect(t.detections()).toEqual([false]);
    // Synced just now: the next return to the front leaves it.
    expect(await t.client.syncEmailIfDue()).toBe(false);
    t.advance(31 * 60 * 1000);
    expect(await t.client.syncEmailIfDue()).toBe(true);
  });

  test('stored state survives junk', () => {
    expect(parseSyncState(null)).toEqual(EMPTY_SYNC_STATE);
    expect(parseSyncState('{')).toEqual(EMPTY_SYNC_STATE);
    expect(parseSyncState(JSON.stringify({ serverTime: 5, connectionIds: ['b', 'a', 3], lastSyncAt: 'x' }))).toEqual({
      serverTime: null,
      connectionIds: ['a', 'b'],
      lastSyncAt: 'x',
    });
  });
});
