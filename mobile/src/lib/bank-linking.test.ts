import { afterEach, describe, expect, test } from 'bun:test';
import {
  BankLinkError,
  bankLinkAvailability,
  bankLinkErrorMessage,
  connectionHealth,
  exitReasonMessage,
  getConsentInfo,
  readBrowserResult,
  runBankLink,
  waitForNewBank,
  type BankLinkDeps,
  type BankSummary,
  type LinkCompletionDTO,
  type LinkStage,
} from './bank-linking';
import { DEV_PRO_ENTITLEMENT, devProOverrideActive } from './entitlementApi';
import { apiErrorFrom } from './api/http-errors';
import { setLocale } from './i18n/core';
import { en as enBase } from './i18n/locales/catalog';
import bankLinkStrings from './i18n/locales/fragments/bankLink.json';

// The fragment's own strings, typed (the catalogue's type is the base file's).
const en = { ...enBase, bankLink: bankLinkStrings.en };
const fr = { bankLink: bankLinkStrings.fr };

afterEach(() => setLocale('en'));

const RETURN = 'realbudget://bank/linked';
const noSleep = async () => {};

/** A scripted server and browser; every effect recorded. */
function fake(over: Partial<BankLinkDeps> & {
  banks?: BankSummary[][];
  completions?: LinkCompletionDTO[];
  browser?: { type: string; url?: string } | Error;
  added?: number[];
} = {}) {
  const log: string[] = [];
  const stages: LinkStage[] = [];
  const progress: number[] = [];
  const banks = over.banks ?? [[{ id: 'old', accountsCount: 2 }], [{ id: 'old', accountsCount: 2 }, { id: 'new', accountsCount: 2 }]];
  const completions = over.completions ?? [{ status: 'success', linked: 1, inProgress: 0, exit: null }];
  const added = over.added ?? [3];
  const deps: BankLinkDeps = {
    createSession: async () => {
      log.push('create');
      return { linkToken: 'link-1', hostedLinkUrl: 'https://hosted.plaid.test/x', expiration: null, returnUrl: RETURN };
    },
    openBrowser: async (url, returnUrl) => {
      log.push(`browser ${url} ${returnUrl}`);
      if (over.browser instanceof Error) throw over.browser;
      return over.browser ?? { type: 'success', url: `${RETURN}?result=done` };
    },
    complete: async (linkToken) => {
      log.push(`complete ${linkToken}`);
      return completions.length > 1 ? completions.shift()! : completions[0]!;
    },
    fetchBanks: async () => {
      log.push('banks');
      return banks.length > 1 ? banks.shift()! : banks[0]!;
    },
    sync: async () => {
      log.push('sync');
      return { newTransactions: added.length > 1 ? added.shift()! : added[0]! };
    },
    sleep: noSleep,
    onStage: (stage, p) => {
      if (stages.at(-1) !== stage) stages.push(stage);
      if (p) progress.push(p.attempt);
    },
    pollAttempts: 5,
    ...over,
  };
  return { deps, log, stages, progress };
}

describe('bank link result', () => {
  test('bank link result: the browser coming back is read, whatever the redirect carries', () => {
    expect(readBrowserResult({ type: 'success', url: `${RETURN}?result=done` })).toEqual({ kind: 'returned', result: 'done' });
    expect(readBrowserResult({ type: 'success', url: `exp://10.0.0.2:8081/--/bank/linked?result=expired#x` })).toEqual({ kind: 'returned', result: 'expired' });
    expect(readBrowserResult({ type: 'success', url: RETURN })).toEqual({ kind: 'returned', result: null });
    expect(readBrowserResult({ type: 'cancel' })).toEqual({ kind: 'cancelled' });
    expect(readBrowserResult({ type: 'dismiss' })).toEqual({ kind: 'cancelled' });
    expect(readBrowserResult({ type: 'locked' })).toEqual({ kind: 'failed', reason: 'locked' });
    expect(readBrowserResult(null)).toEqual({ kind: 'failed', reason: 'browser' });
  });

  test('bank link result: success polls until the new bank appears, then syncs', async () => {
    const f = fake({
      banks: [
        [{ id: 'old', accountsCount: 1 }],
        [{ id: 'old', accountsCount: 1 }],
        // Listed before its accounts are pulled: not there yet.
        [{ id: 'old', accountsCount: 1 }, { id: 'new', accountsCount: 0 }],
        [{ id: 'old', accountsCount: 1 }, { id: 'new', accountsCount: 2 }],
      ],
    });
    expect(await runBankLink(f.deps)).toEqual({ kind: 'linked', bankIds: ['new'], newTransactions: 3 });
    expect(f.log).toEqual([
      'create', 'banks', `browser https://hosted.plaid.test/x ${RETURN}`, 'complete link-1', 'banks', 'banks', 'banks', 'sync',
    ]);
    expect(f.stages).toEqual(['opening', 'browser', 'finishing', 'waiting', 'syncing']);
    expect(f.progress).toEqual([0, 1, 2, 3]);
  });

  test('bank link result: a fresh bank whose history is not ready yet is synced again, briefly', async () => {
    const f = fake({ added: [0, 0, 4] });
    expect(await runBankLink(f.deps)).toMatchObject({ kind: 'linked', newTransactions: 4 });
    expect(f.log.filter((l) => l === 'sync')).toHaveLength(3);
  });

  test('bank link result: closing the browser is a cancel, not an error — unless the bank was already linked', async () => {
    const closed = fake({ browser: { type: 'cancel' }, completions: [{ status: 'pending', linked: 0, inProgress: 0, exit: null }] });
    expect(await runBankLink(closed.deps)).toEqual({ kind: 'cancelled' });
    expect(closed.log.filter((l) => l.startsWith('complete'))).toHaveLength(1);
    expect(closed.log).not.toContain('sync');

    // Linked, then the sheet closed before the redirect: still linked.
    const linkedThenClosed = fake({ browser: { type: 'dismiss' } });
    expect(await runBankLink(linkedThenClosed.deps)).toMatchObject({ kind: 'linked', bankIds: ['new'] });

    // The server failing to answer after a close is still just a close.
    const quiet = fake({ browser: { type: 'cancel' }, complete: async () => { throw new Error('offline'); } });
    expect(await runBankLink(quiet.deps)).toEqual({ kind: 'cancelled' });
  });

  test('bank link result: leaving Plaid says why, and errors carry a reason the screen can word', async () => {
    const exited = fake({ completions: [{ status: 'exited', linked: 0, inProgress: 0, exit: { code: 'INSTITUTION_DOWN', status: 'requires_credentials' } }] });
    expect(await runBankLink(exited.deps)).toEqual({ kind: 'exited', code: 'INSTITUTION_DOWN' });
    expect(exitReasonMessage('INSTITUTION_DOWN')).toBe(en.bankLink.errors.bankDown);
    expect(exitReasonMessage(null)).toBeNull();

    const paywall = apiErrorFrom(402, 'application/json', JSON.stringify({ error: 'Bank sync is a Pro feature.', code: 'upgrade_required' }));
    const free = fake({ createSession: async () => { throw paywall; } });
    const outcome = await runBankLink(free.deps);
    expect(outcome).toEqual({ kind: 'failed', error: paywall });
    expect(free.log).toEqual([]);

    const locked = await runBankLink(fake({ browser: { type: 'locked' } }).deps);
    expect(locked.kind === 'failed' && bankLinkErrorMessage(locked.error)).toBe(en.bankLink.errors.browser);
    const threw = await runBankLink(fake({ browser: new Error('no activity') }).deps);
    expect(threw.kind === 'failed' && bankLinkErrorMessage(threw.error)).toBe(en.bankLink.errors.browser);
    const expired = await runBankLink(fake({ browser: { type: 'success', url: `${RETURN}?result=expired` } }).deps);
    expect(expired.kind === 'failed' && bankLinkErrorMessage(expired.error)).toBe(en.bankLink.errors.expired);
    const noUrl = await runBankLink(fake({ createSession: async () => ({ linkToken: 'l', hostedLinkUrl: null, expiration: null }) }).deps);
    expect(noUrl.kind === 'failed' && (noUrl.error as BankLinkError).code).toBe('no_hosted_url');
  });

  test('bank link result: waiting is bounded, reports progress, and survives a failed poll', async () => {
    const seen: number[] = [];
    let calls = 0;
    const r = await waitForNewBank({
      fetchBanks: async () => {
        calls++;
        if (calls === 2) throw new Error('mid-exchange');
        return [{ id: 'old', accountsCount: 1 }];
      },
      knownIds: ['old'],
      maxAttempts: 4,
      sleep: noSleep,
      onProgress: (attempt, max) => seen.push(attempt * 10 + max),
    });
    expect(r).toEqual({ found: false });
    expect(calls).toBe(4);
    expect(seen).toEqual([14, 24, 34, 44]);

    // Never appearing at all is "pending", not a failure.
    const never = fake({ banks: [[{ id: 'old', accountsCount: 1 }]] });
    expect(await runBankLink(never.deps)).toEqual({ kind: 'pending' });
  });

  test('bank link result: a session Plaid has not closed yet is asked about again before giving up', async () => {
    const lagging = fake({
      completions: [
        { status: 'pending', linked: 0, inProgress: 0, exit: null },
        { status: 'success', linked: 0, inProgress: 1, exit: null },
      ],
    });
    expect(await runBankLink(lagging.deps)).toMatchObject({ kind: 'linked' });
    expect(lagging.log.filter((l) => l.startsWith('complete'))).toHaveLength(2);
  });
});

describe('bank link errors', () => {
  const failure = (status: number, body: Record<string, unknown>) =>
    apiErrorFrom(status, 'application/json', JSON.stringify(body));

  test("the server's code picks a sentence in the reader's language", () => {
    expect(bankLinkErrorMessage(failure(503, { error: 'Bank linking is not configured on this server.', code: 'not_configured' })))
      .toBe(en.bankLink.errors.notConfigured);
    expect(bankLinkErrorMessage(failure(502, { error: 'x', code: 'provider_unavailable', providerCode: 'INSTITUTION_NOT_RESPONDING' })))
      .toBe(en.bankLink.errors.bankDown);
    expect(bankLinkErrorMessage(failure(502, { error: 'x', code: 'provider_rejected', providerCode: 'INVALID_FIELD' })))
      .toBe(en.bankLink.errors.providerRejectedCode.replace('%{code}', 'INVALID_FIELD'));
    setLocale('fr');
    expect(bankLinkErrorMessage(failure(404, { error: 'No such link session.', code: 'link_session_not_found' })))
      .toBe(fr.bankLink.errors.expired);
  });

  test("a code this screen does not know shows the server's own words", () => {
    expect(bankLinkErrorMessage(failure(400, { error: 'That return address is not this app’s.', code: 'something_new' })))
      .toBe('That return address is not this app’s.');
    // A 5xx's words are never shown.
    expect(bankLinkErrorMessage(failure(500, { error: 'TypeError at handler', code: 'internal' }))).toBe(en.apiErrors.server);
  });
});

describe('bank availability', () => {
  const config = { configured: true, countries: ['US', 'CA', 'GB', 'FR', 'DE'], env: 'sandbox' };

  test('bank availability: a region the server links in is offered bank linking', () => {
    expect(bankLinkAvailability('FR', config)).toEqual({ state: 'available', region: 'FR' });
    expect(bankLinkAvailability('us', config)).toEqual({ state: 'available', region: 'US' });
    // Devices and people say UK; Plaid says GB.
    expect(bankLinkAvailability('UK', config)).toEqual({ state: 'available', region: 'GB' });
  });

  test('bank availability: a region outside the served countries gets the pointer to statements and email', () => {
    expect(bankLinkAvailability('MA', config)).toEqual({ state: 'outside', region: 'MA' });
    expect(bankLinkAvailability('CN', config)).toEqual({ state: 'outside', region: 'CN' });
    // Plaid serves Spain, but this server is not enabled for it.
    expect(bankLinkAvailability('ES', config)).toEqual({ state: 'outside', region: 'ES' });
  });

  test('bank availability: an unconfigured server, an unknown region and an unreachable server', () => {
    expect(bankLinkAvailability('FR', { configured: false, countries: [], env: 'sandbox' })).toEqual({ state: 'not_configured' });
    expect(bankLinkAvailability(null, config)).toEqual({ state: 'available', region: null });
    expect(bankLinkAvailability('not a region', config)).toEqual({ state: 'available', region: null });
    expect(bankLinkAvailability('FR', null)).toEqual({ state: 'unknown' });
  });
});

describe('dev pro override', () => {
  test('dev pro override: a development build with EXPO_PUBLIC_DEV_PRO=true counts as Pro', () => {
    expect(devProOverrideActive({ isDev: true, flag: 'true' })).toBe(true);
    expect(devProOverrideActive({ isDev: true, flag: ' TRUE ' })).toBe(true);
    expect(DEV_PRO_ENTITLEMENT).toEqual({ tier: 'pro', expiresAt: null });
  });

  test('dev pro override: ignored in production (release) builds, and off unless set', () => {
    expect(devProOverrideActive({ isDev: false, flag: 'true' })).toBe(false);
    expect(devProOverrideActive({ isDev: undefined, flag: 'true' })).toBe(false);
    expect(devProOverrideActive({ isDev: true, flag: undefined })).toBe(false);
    expect(devProOverrideActive({ isDev: true, flag: 'false' })).toBe(false);
  });
});

test('the consent sheet is in the reader’s language', () => {
  setLocale('fr');
  const consent = getConsentInfo();
  expect(consent.dataAccessed).toEqual([fr.bankLink.consent.balances, fr.bankLink.consent.history, fr.bankLink.consent.names]);
  expect(consent.expiresAt).toBe('');
});

test('connections are sorted by how soon their consent runs out', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const bank = (id: string, expires: string) => ({
    id, institutionName: id, lastSynced: '', connectionStatus: 'active' as const, accountsCount: 1, consentExpiresAt: expires,
  });
  const h = connectionHealth([bank('a', '2026-10-01T00:00:00Z'), bank('b', '2026-10-15T00:00:00Z'), bank('c', '2026-12-01T00:00:00Z')], now);
  expect(h.expired.map((b) => [b.id, b.connectionStatus])).toEqual([['a', 'expired']]);
  expect(h.expiringSoon.map((b) => b.id)).toEqual(['b']);
  expect(h.healthy.map((b) => b.id)).toEqual(['c']);
});
