import { afterEach, describe, expect, test } from 'bun:test';
import type { LocalEmailFinding } from './db';
import type { EmailConnectionDTO, EmailConnectionsDTO } from './email-connections';
import { setLocale, t } from './i18n/core';
import {
  FORWARDING_PROVIDERS,
  connectOutcome,
  connectionView,
  connectionViews,
  disconnectCopy,
  findingRows,
  forwardingSteps,
  forwardingView,
  gmailCapReached,
  pollInterval,
  progressText,
  providerOptions,
  relativeTime,
  scanCardSummary,
} from './email-screen';

afterEach(() => setLocale('en'));

const NOW = Date.parse('2026-10-13T12:00:00.000Z');

const conn = (over: Partial<EmailConnectionDTO> & Pick<EmailConnectionDTO, 'id'>): EmailConnectionDTO => ({
  provider: 'gmail',
  address: 'sam@example.com',
  status: 'active',
  syncState: 'idle',
  lastSyncedAt: '2026-10-13T11:00:00.000Z',
  backfillDoneAt: '2026-10-01T08:00:00.000Z',
  messagesScanned: 1240,
  findingsCount: 12,
  lastError: null,
  ...over,
});

const dto = (over: { connections?: EmailConnectionDTO[]; gmail?: Partial<EmailConnectionsDTO['providers']['gmail']>; outlook?: boolean; forwarding?: boolean } = {}): EmailConnectionsDTO => ({
  connections: over.connections ?? [],
  providers: {
    gmail: { configured: true, verified: false, capReached: false, ...over.gmail },
    outlook: { configured: over.outlook ?? true },
    forwarding: { configured: over.forwarding ?? true },
  },
});

const finding = (over: Partial<LocalEmailFinding> & Pick<LocalEmailFinding, 'id'>): LocalEmailFinding => ({
  connectionId: 'c1',
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
  receivedAt: '2026-10-01T09:00:00.000Z',
  ...over,
});

describe('email screen', () => {
  test('Gmail and Outlook come first; an unconfigured provider is unavailable, a full Gmail says so, and an unverified Gmail is explained first', () => {
    const fresh = providerOptions(dto());
    expect(fresh.map((p) => [p.provider, p.availability, p.label, p.explainFirst])).toEqual([
      ['gmail', 'available', t('emailConnect.connect', { provider: 'Gmail' }), true],
      ['outlook', 'available', t('emailConnect.connect', { provider: 'Outlook' }), false],
    ]);
    // Verified by Google: no explainer.
    expect(providerOptions(dto({ gmail: { verified: true } }))[0]!.explainFirst).toBe(false);
    // The server has no keys for one of them.
    expect(providerOptions(dto({ outlook: false })).map((p) => p.availability)).toEqual(['available', 'unavailable']);
    expect(providerOptions(dto({ gmail: { configured: false } }))[0]).toMatchObject({ availability: 'unavailable', explainFirst: false });
    // Gmail's unverified cap: closed for now, and forwarding is the way in.
    const full = dto({ gmail: { capReached: true } });
    expect(providerOptions(full)[0]!.availability).toBe('cap_reached');
    expect(gmailCapReached(full)).toBe(true);
    expect(gmailCapReached(dto())).toBe(false);
    // Before the server has answered, nothing is offered as connectable.
    expect(providerOptions(null).map((p) => p.availability)).toEqual(['unavailable', 'unavailable']);
    // One connected: the button connects another.
    expect(providerOptions(dto({ connections: [conn({ id: 'c1' })] }))[0]!.label).toBe(
      t('emailConnect.connectAnother', { provider: 'Gmail' }),
    );
  });

  test('every connection state: reading the first year with progress, up to date, needing to reconnect, failing, retrying', () => {
    const backfilling = connectionView(conn({ id: 'c1', syncState: 'backfilling', backfillDoneAt: null, lastSyncedAt: null, messagesScanned: 380, findingsCount: 4 }), NOW);
    expect(backfilling).toMatchObject({ state: 'backfilling', busy: true, attention: false, stateText: t('emailConnect.state.backfilling') });
    expect(backfilling.detail).toBe(`${t('emailConnect.scanned', { count: 380 })} · ${t('emailConnect.found', { count: 4 })}`);
    // Between two passes of the first year it is still reading, not "up to date".
    expect(connectionView(conn({ id: 'c1', backfillDoneAt: null, lastSyncedAt: null, messagesScanned: 380 }), NOW).state).toBe('backfilling');

    const upToDate = connectionView(conn({ id: 'c2' }), NOW);
    expect(upToDate).toMatchObject({ state: 'up_to_date', busy: false, stateText: t('emailConnect.state.upToDate', { when: t('emailConnect.time.hours', { count: 1 }) }) });

    const reauth = connectionView(conn({ id: 'c3', provider: 'outlook', status: 'needs_reauth', lastError: 'reauth_required' }), NOW);
    expect(reauth).toMatchObject({ state: 'needs_reauth', canReconnect: true, attention: true, providerName: 'Outlook' });

    expect(connectionView(conn({ id: 'c4', status: 'error', lastError: 'mailbox_unavailable' }), NOW).stateText).toBe(t('emailConnect.state.noMailbox'));
    expect(connectionView(conn({ id: 'c5', status: 'error', lastError: 'sync_failed' }), NOW).stateText).toBe(t('emailConnect.state.error'));
    expect(connectionView(conn({ id: 'c6', lastError: 'provider_busy' }), NOW)).toMatchObject({ state: 'retrying', canReconnect: false, attention: true });
    expect(connectionView(conn({ id: 'c7', syncState: 'syncing' }), NOW)).toMatchObject({ state: 'syncing', busy: true });
    expect(connectionView(conn({ id: 'c8', backfillDoneAt: null, lastSyncedAt: null, messagesScanned: 0, findingsCount: 0 }), NOW)).toMatchObject({ state: 'waiting', detail: null });

    // Forwarding is listed in its own section, not among the inboxes.
    const list = dto({ connections: [conn({ id: 'f', provider: 'forwarding', address: 'u_x@in.example' }), conn({ id: 'g' })] });
    expect(connectionViews(list, NOW).map((v) => v.id)).toEqual(['g']);
    // The screen asks again every few seconds only while something is being read.
    expect(pollInterval(list)).toBe(false);
    expect(pollInterval(dto({ connections: [conn({ id: 'g', syncState: 'backfilling' })] }))).toBe(4000);
    // Connected a moment ago and its first read not begun: keep asking, so the screen sees it start.
    expect(pollInterval(dto({ connections: [conn({ id: 'g', backfillDoneAt: null, lastSyncedAt: null })] }))).toBe(4000);
    // A first read stopped by an error, or forwarding alone, is not polled.
    expect(pollInterval(dto({ connections: [conn({ id: 'g', backfillDoneAt: null, lastError: 'provider_busy' })] }))).toBe(false);
    expect(pollInterval(dto({ connections: [conn({ id: 'f', provider: 'forwarding', backfillDoneAt: null })] }))).toBe(false);

    expect(relativeTime('2026-10-13T11:59:30.000Z', NOW)).toBe(t('emailConnect.time.justNow'));
    expect(relativeTime('2026-10-13T11:55:00.000Z', NOW)).toBe(t('emailConnect.time.minutes', { count: 5 }));
    expect(relativeTime('2026-10-10T12:00:00.000Z', NOW)).toBe(t('emailConnect.time.days', { count: 3 }));
    expect(relativeTime(null, NOW)).toBeNull();
  });

  test('how a connect ends: connected, closed by the user, refused, not configured, the Gmail cap, offline', () => {
    expect(connectOutcome('gmail', { result: 'success' })).toEqual({ tone: 'ok', text: t('emailConnect.outcome.success', { provider: 'Gmail' }) });
    expect(connectOutcome('gmail', { result: 'cancel' })).toBeNull();
    expect(connectOutcome('outlook', { result: 'denied', reason: 'access_denied' })?.text).toBe(t('emailConnect.outcome.denied', { provider: 'Outlook' }));
    expect(connectOutcome('outlook', { result: 'error', reason: 'not_configured' })?.text).toBe(t('emailConnect.outcome.notConfigured', { provider: 'Outlook' }));
    expect(connectOutcome('gmail', { result: 'error', reason: 'cap_reached' })).toEqual({ tone: 'warning', text: t('emailConnect.cap.body') });
    expect(connectOutcome('gmail', { result: 'error', reason: 'network' })?.text).toBe(t('emailConnect.outcome.offline'));
    expect(connectOutcome('gmail', { result: 'error', reason: 'locked' })?.text).toBe(t('emailConnect.outcome.locked'));
    expect(connectOutcome('gmail', { result: 'error', reason: 'server' })?.text).toBe(t('emailConnect.outcome.failed', { provider: 'Gmail' }));

    expect(progressText('gmail', { phase: 'authorizing', connection: null })).toBe(t('emailConnect.progress.authorizing', { provider: 'Gmail' }));
    expect(progressText('gmail', { phase: 'backfilling', connection: conn({ id: 'c', messagesScanned: 12 }) })).toBe(
      `${t('emailConnect.state.backfilling')} ${t('emailConnect.scanned', { count: 12 })}`,
    );
    // Disconnecting Outlook says up front that removing the grant is left to the user.
    expect(disconnectCopy({ provider: 'outlook', address: 'sam@outlook.com' }).manual).toBe(t('emailConnect.disconnect.outlookManual'));
    expect(disconnectCopy({ provider: 'gmail', address: 'sam@gmail.com' })).toMatchObject({
      title: t('emailConnect.disconnect.title', { address: 'sam@gmail.com' }),
      manual: null,
    });
  });

  test('forwarding is the backup: the private address, its state, Gmail’s code until it works, and steps for every provider', () => {
    const list = dto({ connections: [conn({ id: 'f', provider: 'forwarding', address: 'u_ab12@in.realbudget.app', forwardingVerified: false })] });
    const waiting = forwardingView(list, { address: 'u_ab12@in.realbudget.app', verified: false, confirmationCode: '583920174' });
    expect(waiting).toEqual({
      available: true,
      address: 'u_ab12@in.realbudget.app',
      verified: false,
      stateText: t('emailConnect.forwarding.waiting'),
      code: '583920174',
    });
    // Mail arrives: receiving, and the code has done its job.
    expect(forwardingView(list, { address: 'u_ab12@in.realbudget.app', verified: true, confirmationCode: '583920174' })).toMatchObject({
      verified: true,
      code: null,
      stateText: t('emailConnect.forwarding.receiving'),
    });
    // Not set up on this server.
    expect(forwardingView(dto({ forwarding: false }), null)).toMatchObject({ available: false, address: null });

    expect(FORWARDING_PROVIDERS).toEqual(['icloud', 'yahoo', 'gmx', 'gmail', 'other']);
    for (const lang of ['en', 'fr', 'zh', 'ar'] as const) {
      setLocale(lang);
      for (const p of FORWARDING_PROVIDERS) {
        const steps = forwardingSteps(p);
        expect(steps.length).toBeGreaterThanOrEqual(2);
        for (const s of steps) expect(s).not.toContain('emailConnect.');
      }
    }
  });

  test('recent findings: billing emails only, newest first, merchant, kind and amount in its own currency', () => {
    const rows = findingRows(
      [
        finding({ id: 'a', merchant: 'NETFLIX.COM', emailDateISO: '2026-09-01' }),
        finding({ id: 'b', merchant: null, senderDomain: 'spotify.com', kind: 'price_change', amount: 12.99, currency: 'EUR', emailDateISO: '2026-10-05' }),
        finding({ id: 'c', kind: 'other', emailDateISO: '2026-10-09' }),
        finding({ id: 'd', merchant: null, senderDomain: null, kind: 'trial_ending', amount: null, currency: null, emailDateISO: '2026-10-07' }),
      ],
      'USD',
    );
    expect(rows.map((r) => [r.id, r.title, r.meta, r.amount, r.currency])).toEqual([
      ['d', t('emailConnect.findings.unknown'), `${t('emailConnect.kind.trial_ending')} · Oct 7`, null, 'USD'],
      ['b', 'Spotify', `${t('emailConnect.kind.price_change')} · Oct 5`, 12.99, 'EUR'],
      ['a', 'Netflix', `${t('emailConnect.kind.receipt')} · Sep 1`, 15.49, 'USD'],
    ]);
    expect(findingRows(Array.from({ length: 30 }, (_, i) => finding({ id: `f${i}` })), 'USD', 20)).toHaveLength(20);
  });

  test('the entry card says where email stands in one line', () => {
    expect(scanCardSummary(undefined, NOW)).toEqual({ title: t('emailConnect.card.title'), body: t('emailConnect.card.connect'), attention: false });
    expect(scanCardSummary(dto({ connections: [conn({ id: 'o', provider: 'outlook', status: 'needs_reauth' })] }), NOW)).toEqual({
      title: t('emailConnect.card.title'),
      body: t('emailConnect.card.attention', { provider: 'Outlook' }),
      attention: true,
    });
    expect(scanCardSummary(dto({ connections: [conn({ id: 'g', findingsCount: 3 }), conn({ id: 'o', provider: 'outlook', findingsCount: 2 })] }), NOW).body).toBe(
      t('emailConnect.card.connected', { providers: 'Gmail and Outlook', count: 5 }),
    );
    expect(scanCardSummary(dto({ connections: [conn({ id: 'f', provider: 'forwarding', forwardingVerified: true, findingsCount: 1 })] }), NOW).body).toBe(
      t('emailConnect.card.forwarding', { count: 1 }),
    );
  });
});
