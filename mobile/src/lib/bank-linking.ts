/**
 * Bank linking, on the phone.
 *
 * The bank login runs in Plaid's Hosted Link, opened in the system browser
 * session, so no native Plaid SDK is bundled. The server creates the session
 * (with this phone's region, currency and language), finishes it however the
 * user comes back — or doesn't — and books the transactions; the phone opens
 * the page, asks how it went, waits for the bank to appear and pulls.
 *
 * Everything that decides something is pure and takes its effects as
 * arguments (readBrowserResult, waitForNewBank, runBankLink,
 * bankLinkAvailability, bankLinkErrorMessage), so bank-linking.test.ts runs it
 * without a device. The network, the browser, storage and the device's locale
 * are imported lazily inside the functions that use them.
 */
import { toApiFailure } from './api-errors';
import { getLocale, t } from './i18n/core';
import { userKey } from './storage-keys';

// Bank connections write to this user's ledger on the server: finishing a link
// runs a first transaction sync, a bank sync books new transactions, and a
// disconnect that deletes the bank's data deletes it there. None of it reaches
// the phone until it pulls, so each of those asks for a pull when it is done.

// ── Backend (Plaid) wire types + mappers ─────────────────────────────────────
interface PlaidAccountDTO {
  id: string;
  plaidAccountId: string;
  name: string;
  type: string;
  mask?: string | null;
  balance: number;
  currency: string;
  isEnabled: boolean;
}
interface PlaidItemDTO {
  id: string;
  institutionName?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  accounts: PlaidAccountDTO[];
}

/** What the server can link: GET /api/plaid/config. */
export interface BankLinkConfig {
  configured: boolean;
  /** ISO 3166-1 alpha-2 codes this server links banks in. */
  countries: string[];
  env: string;
}

/** A link session the server created: POST /api/plaid/link-token. */
export interface LinkSessionDTO {
  linkToken: string;
  hostedLinkUrl: string | null;
  expiration: string | null;
  returnUrl?: string;
}

/** How a link went, as the server saw it: POST /api/plaid/link/complete. */
export interface LinkCompletionDTO {
  status: 'success' | 'exited' | 'pending';
  linked: number;
  inProgress: number;
  exit: { code: string | null; status: string | null } | null;
}

function mapAccountType(t: string): LinkedAccount['type'] {
  if (t === 'credit' || t === 'investment' || t === 'savings' || t === 'loan') return t;
  return 'checking';
}

/** PSD2 re-consent runs to 90 days; used only for the renewal reminder. */
const CONSENT_ESTIMATE_DAYS = 90;

function itemToBank(item: PlaidItemDTO): LinkedBank {
  return {
    id: item.id,
    institutionName: item.institutionName ?? t('bankLink.unnamedBank'),
    lastSynced: item.updatedAt,
    connectionStatus: item.status === 'active' ? 'active' : 'error',
    accountsCount: item.accounts.length,
    // Estimated from when the connection was made. It used to be derived from
    // updatedAt, which the sync rewrites on every run — so the expiry rolled
    // forward forever and no connection ever appeared to expire, making
    // checkConnectionHealth permanently report everything healthy.
    //
    // This is still an estimate: the authoritative value is Plaid's
    // item.consent_expiration_time, which we do not yet store.
    consentExpiresAt: new Date(
      new Date(item.createdAt).getTime() + CONSENT_ESTIMATE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString(),
  };
}

function accountToLinked(item: PlaidItemDTO, a: PlaidAccountDTO): LinkedAccount {
  return {
    id: a.plaidAccountId,
    bankId: item.id,
    name: a.name,
    type: mapAccountType(a.type),
    maskedNumber: a.mask ? `****${a.mask}` : '••••',
    balance: a.balance,
    currency: a.currency,
    lastUpdated: item.updatedAt,
    isEnabled: a.isEnabled,
  };
}

async function client() {
  return (await import('./api/api')).api;
}

async function fetchPlaidItems(): Promise<PlaidItemDTO[]> {
  const api = await client();
  const { items } = await api.get<{ items: PlaidItemDTO[] }>('/api/plaid/accounts');
  return items ?? [];
}

/** Bring what the server just booked or deleted into this phone's ledger. */
async function pullSoon(): Promise<void> {
  (await import('./cloud-sync')).requestPull();
}

// Types for linked accounts
export interface LinkedBank {
  id: string;
  institutionName: string;
  institutionLogo?: string;
  lastSynced: string;
  connectionStatus: 'active' | 'expired' | 'error';
  accountsCount: number;
  consentExpiresAt: string;
}

export interface LinkedAccount {
  id: string;
  bankId: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
  maskedNumber: string; // Last 4 digits only
  balance: number;
  currency: string;
  lastUpdated: string;
  isEnabled: boolean; // User can disable sync for specific accounts
}

export interface BankTransaction {
  id: string;
  accountId: string;
  amount: number;
  description: string;
  category?: string;
  merchantName?: string;
  date: string;
  pending: boolean;
  type: 'debit' | 'credit';
}

export interface ConsentInfo {
  dataAccessed: string[];
  permissions: string[];
  expiresAt: string;
  canRevoke: boolean;
}

// Storage keys. Per user (storage-keys.ts): an offline snapshot of this user's
// Plaid links — bank names and masked account numbers — deleted on sign-out.
const LINKED_BANKS_KEY = 'linked_banks';
const LINKED_ACCOUNTS_KEY = 'linked_accounts';

/** AsyncStorage, imported where it is used so the pure parts stay testable. */
async function storage() {
  return (await import('@react-native-async-storage/async-storage')).default;
}

// The cache is a convenience: a failure here — including nobody being signed
// in, when userKey() throws — must never fail the call it decorates.
function parseCached<T>(data: string | null): T[] {
  try {
    const parsed: unknown = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// There is deliberately no bank list here.
//
// There used to be eight hardcoded US banks with emoji logos, and the id the
// user picked was thrown away: the connect flow opens Plaid's Hosted Link,
// where they choose their bank from the real institution list. So the picker
// asked the same question twice, and for anyone outside the US it offered
// eight banks that were not theirs — see bankLinkAvailability below for the
// countries actually served.

// Get all linked banks (live from the backend Plaid integration).
export async function getLinkedBanks(): Promise<LinkedBank[]> {
  try {
    const items = await fetchPlaidItems();
    const banks = items.map(itemToBank);
    // Cache for offline display.
    try {
      const AsyncStorage = await storage();
      await AsyncStorage.setItem(userKey(LINKED_BANKS_KEY), JSON.stringify(banks));
    } catch {
      /* offline display only */
    }
    return banks;
  } catch {
    // Fall back to the last cached snapshot when offline / unconfigured.
    try {
      const AsyncStorage = await storage();
      return parseCached<LinkedBank>(await AsyncStorage.getItem(userKey(LINKED_BANKS_KEY)));
    } catch {
      return [];
    }
  }
}

// Get all linked accounts (live from the backend Plaid integration).
export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  try {
    const items = await fetchPlaidItems();
    const accounts = items.flatMap((item) => item.accounts.map((a) => accountToLinked(item, a)));
    try {
      const AsyncStorage = await storage();
      await AsyncStorage.setItem(userKey(LINKED_ACCOUNTS_KEY), JSON.stringify(accounts));
    } catch {
      /* offline display only */
    }
    return accounts;
  } catch {
    try {
      const AsyncStorage = await storage();
      return parseCached<LinkedAccount>(await AsyncStorage.getItem(userKey(LINKED_ACCOUNTS_KEY)));
    } catch {
      return [];
    }
  }
}

// Get accounts for a specific bank
export async function getAccountsByBank(bankId: string): Promise<LinkedAccount[]> {
  const accounts = await getLinkedAccounts();
  return accounts.filter((acc) => acc.bankId === bankId);
}

// ── Where bank linking is offered ────────────────────────────────────────────

/** A region as the server spells it: ISO alpha-2, upper case, UK as GB. */
export function normalizeRegion(region: string | null | undefined): string | null {
  const code = (region ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code === 'UK' ? 'GB' : code;
}

export type BankAvailability =
  /** The server could not be asked (offline, or a server too old to say): let the user try. */
  | { state: 'unknown' }
  /** The server has no bank provider at all. */
  | { state: 'not_configured' }
  /** Banks in this region (or an unknown one) can be linked. */
  | { state: 'available'; region: string | null }
  /** The server links banks, but not in this phone's region. */
  | { state: 'outside'; region: string };

/**
 * Whether to offer bank linking to this phone: the device's region against
 * the countries the server links in. A phone that reports no region is
 * offered it — Plaid's own country list then decides.
 */
export function bankLinkAvailability(
  region: string | null | undefined,
  config: BankLinkConfig | null | undefined
): BankAvailability {
  if (!config) return { state: 'unknown' };
  if (!config.configured) return { state: 'not_configured' };
  const code = normalizeRegion(region);
  if (!code) return { state: 'available', region: null };
  const served = new Set(config.countries.map((c) => normalizeRegion(c)).filter((c): c is string => !!c));
  return served.has(code) ? { state: 'available', region: code } : { state: 'outside', region: code };
}

/** The phone's region (expo-localization), or null. */
export async function deviceRegion(): Promise<string | null> {
  try {
    const { getLocales } = await import('expo-localization');
    return normalizeRegion(getLocales()[0]?.regionCode ?? null);
  } catch {
    return null;
  }
}

/** What the server can link, or null when it cannot say (then: let them try). */
export async function getBankLinkConfig(): Promise<BankLinkConfig | null> {
  try {
    const api = await client();
    const config = await api.get<Partial<BankLinkConfig>>('/api/plaid/config');
    return {
      configured: config?.configured === true,
      countries: Array.isArray(config?.countries) ? config.countries.filter((c) => typeof c === 'string') : [],
      env: typeof config?.env === 'string' ? config.env : '',
    };
  } catch {
    return null;
  }
}

// ── The browser's answer ─────────────────────────────────────────────────────

/** What expo-web-browser's openAuthSessionAsync resolves with. */
export interface BrowserResult {
  type: string;
  url?: string;
}

export type LinkReturn =
  /** The browser came back through the completion redirect. */
  | { kind: 'returned'; result: string | null }
  /** The user closed the browser. */
  | { kind: 'cancelled' }
  /** The browser could not run the session. */
  | { kind: 'failed'; reason: 'locked' | 'browser' };

/**
 * Read openAuthSessionAsync's result. "success" means the browser reached
 * the return address — not that a bank was linked: Plaid redirects there
 * when the user gives up too, so the server is asked next either way.
 */
export function readBrowserResult(r: BrowserResult | null | undefined): LinkReturn {
  if (!r) return { kind: 'failed', reason: 'browser' };
  if (r.type === 'success') {
    let result: string | null = null;
    try {
      const query = (r.url ?? '').split('?')[1] ?? '';
      result = new URLSearchParams(query.split('#')[0]).get('result');
    } catch {
      result = null;
    }
    return { kind: 'returned', result };
  }
  if (r.type === 'cancel' || r.type === 'dismiss') return { kind: 'cancelled' };
  // 'locked': another browser session is already open.
  return { kind: 'failed', reason: r.type === 'locked' ? 'locked' : 'browser' };
}

// ── Waiting for the bank to appear ───────────────────────────────────────────

export interface BankSummary {
  id: string;
  accountsCount: number;
}

export interface WaitOptions {
  /** The banks as the server lists them now. */
  fetchBanks: () => Promise<BankSummary[]>;
  /** Banks that were there before this link. */
  knownIds: readonly string[];
  intervalMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (attempt: number, maxAttempts: number) => void;
}

export const POLL_INTERVAL_MS = 2_000;
/** A minute: the exchange and the first account pull take seconds. */
export const POLL_ATTEMPTS = 30;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll until a bank that was not there before appears with its accounts, or
 * give up after `maxAttempts`. A failed fetch counts as an attempt and is
 * otherwise ignored: the server may be mid-exchange.
 */
export async function waitForNewBank(o: WaitOptions): Promise<{ found: true; bankIds: string[] } | { found: false }> {
  const known = new Set(o.knownIds);
  const max = Math.max(1, o.maxAttempts ?? POLL_ATTEMPTS);
  const sleep = o.sleep ?? realSleep;
  for (let attempt = 1; attempt <= max; attempt++) {
    o.onProgress?.(attempt, max);
    try {
      const fresh = (await o.fetchBanks()).filter((b) => !known.has(b.id) && b.accountsCount > 0);
      if (fresh.length > 0) return { found: true, bankIds: fresh.map((b) => b.id) };
    } catch {
      /* try again */
    }
    if (attempt < max) await sleep(o.intervalMs ?? POLL_INTERVAL_MS);
  }
  return { found: false };
}

// ── The whole flow ───────────────────────────────────────────────────────────

export type LinkStage = 'opening' | 'browser' | 'finishing' | 'waiting' | 'syncing';

export type BankLinkOutcome =
  | { kind: 'linked'; bankIds: string[]; newTransactions: number }
  | { kind: 'cancelled' }
  /** The user left Plaid without linking; `code` is Plaid's reason, if it gave one. */
  | { kind: 'exited'; code: string | null }
  /** Linked at the bank, but not showing here yet. */
  | { kind: 'pending' }
  | { kind: 'failed'; error: unknown };

/** A failure of the flow itself, by code; bankLinkErrorMessage words it. */
export class BankLinkError extends Error {
  readonly code: 'no_hosted_url' | 'browser' | 'locked' | 'expired';
  constructor(code: BankLinkError['code']) {
    super(code);
    this.name = 'BankLinkError';
    this.code = code;
  }
}

export interface BankLinkDeps {
  createSession(): Promise<LinkSessionDTO>;
  openBrowser(url: string, returnUrl: string): Promise<BrowserResult>;
  complete(linkToken: string): Promise<LinkCompletionDTO>;
  fetchBanks(): Promise<BankSummary[]>;
  sync(): Promise<{ newTransactions: number }>;
  sleep?: (ms: number) => Promise<void>;
  onStage?: (stage: LinkStage, progress?: { attempt: number; maxAttempts: number }) => void;
  pollIntervalMs?: number;
  pollAttempts?: number;
}

/** Re-asks while the server reports the session unfinished just after the browser returned. */
const COMPLETE_RETRIES = 3;
/** Follow-up syncs while a just-linked bank's history is still being prepared. */
const FIRST_SYNC_RETRIES = 3;

/**
 * Link a bank, start to finish:
 *   1. create the session (a 402 or 503 fails here, before any browser);
 *   2. open Hosted Link and wait for the browser to return or be closed;
 *   3. ask the server how it went — it exchanges the token if nothing else
 *      has yet; a user who closed the browser after linking is still linked;
 *   4. poll until the new bank appears, bounded, with progress;
 *   5. sync, retrying briefly while the bank is still preparing its history.
 */
export async function runBankLink(deps: BankLinkDeps): Promise<BankLinkOutcome> {
  const sleep = deps.sleep ?? realSleep;
  const stage = deps.onStage ?? (() => {});
  try {
    stage('opening');
    const session = await deps.createSession();
    if (!session.hostedLinkUrl) return { kind: 'failed', error: new BankLinkError('no_hosted_url') };
    const known = (await deps.fetchBanks().catch(() => [] as BankSummary[])).map((b) => b.id);

    stage('browser');
    let back: LinkReturn;
    try {
      back = readBrowserResult(await deps.openBrowser(session.hostedLinkUrl, session.returnUrl ?? ''));
    } catch {
      back = { kind: 'failed', reason: 'browser' };
    }
    if (back.kind === 'failed') return { kind: 'failed', error: new BankLinkError(back.reason) };
    if (back.kind === 'returned' && back.result === 'expired') {
      return { kind: 'failed', error: new BankLinkError('expired') };
    }

    stage('finishing');
    let completion: LinkCompletionDTO | null = null;
    for (let i = 0; i <= COMPLETE_RETRIES; i++) {
      try {
        completion = await deps.complete(session.linkToken);
      } catch (e) {
        // Closing the browser is not an error, whatever the server says now.
        if (back.kind === 'cancelled') return { kind: 'cancelled' };
        throw e;
      }
      // Closed early: one look is enough. Returned: Plaid may lag a moment.
      if (completion.status !== 'pending' || back.kind === 'cancelled' || i === COMPLETE_RETRIES) break;
      await sleep(1_500);
    }
    if (!completion || completion.status !== 'success') {
      if (back.kind === 'cancelled') return { kind: 'cancelled' };
      if (completion?.status === 'exited') return { kind: 'exited', code: completion.exit?.code ?? null };
      return { kind: 'pending' };
    }

    stage('waiting', { attempt: 0, maxAttempts: deps.pollAttempts ?? POLL_ATTEMPTS });
    const appeared = await waitForNewBank({
      fetchBanks: deps.fetchBanks,
      knownIds: known,
      intervalMs: deps.pollIntervalMs,
      maxAttempts: deps.pollAttempts,
      sleep,
      onProgress: (attempt, maxAttempts) => stage('waiting', { attempt, maxAttempts }),
    });
    if (!appeared.found) return { kind: 'pending' };

    stage('syncing');
    let newTransactions = 0;
    for (let i = 0; i <= FIRST_SYNC_RETRIES; i++) {
      newTransactions += (await deps.sync().catch(() => ({ newTransactions: 0 }))).newTransactions;
      if (newTransactions > 0 || i === FIRST_SYNC_RETRIES) break;
      await sleep(3_000);
    }
    return { kind: 'linked', bankIds: appeared.bankIds, newTransactions };
  } catch (e) {
    return { kind: 'failed', error: e };
  }
}

/** Where the browser goes back into the app: this build's scheme, Expo Go's in development. */
async function appReturnUrl(): Promise<string> {
  try {
    const Linking = await import('expo-linking');
    return Linking.createURL('bank/linked');
  } catch {
    return 'realbudget://bank/linked';
  }
}

/** The app's currency, else the device's. */
async function appCurrency(): Promise<string | null> {
  try {
    const { getSettings } = await import('./db');
    const currency = (await getSettings())?.currency;
    if (currency) return currency;
  } catch {
    /* fall through to the device */
  }
  try {
    const { getLocales } = await import('expo-localization');
    return getLocales()[0]?.currencyCode ?? null;
  } catch {
    return null;
  }
}

// Step 1 of the Plaid flow: a Hosted Link session for this phone's region,
// currency and language, which returns into the app when it ends.
export async function createLinkToken(): Promise<LinkSessionDTO> {
  const [region, currency, returnUrl] = await Promise.all([deviceRegion(), appCurrency(), appReturnUrl()]);
  const api = await client();
  return api.post<LinkSessionDTO>('/api/plaid/link-token', {
    region,
    currency,
    language: getLocale(),
    returnUrl,
  });
}

// Step 2: how did it go? The server exchanges the public token if neither the
// browser's return nor Plaid's webhook has yet. Idempotent.
export async function completeLink(linkToken: string): Promise<LinkCompletionDTO> {
  const api = await client();
  return api.post<LinkCompletionDTO>('/api/plaid/link/complete', { linkToken });
}

/** The real flow: the server, the system browser session and the poll. */
export async function linkBank(onStage?: BankLinkDeps['onStage']): Promise<BankLinkOutcome> {
  const outcome = await runBankLink({
    createSession: createLinkToken,
    openBrowser: async (url, returnUrl) => {
      const WebBrowser = await import('expo-web-browser');
      // Ephemeral: the bank's login cookies are not left in the phone's
      // browser, and iOS does not ask to "sign in with plaid.com".
      return WebBrowser.openAuthSessionAsync(url, returnUrl || null, { preferEphemeralSession: true });
    },
    complete: completeLink,
    fetchBanks: async () => (await fetchPlaidItems()).map((i) => ({ id: i.id, accountsCount: i.accounts.length })),
    sync: async () => {
      const r = await syncAllTransactions();
      return { newTransactions: r.newTransactions };
    },
    onStage,
  });
  if (outcome.kind === 'linked' || outcome.kind === 'pending') await pullSoon().catch(() => {});
  return outcome;
}

// ── Disconnecting ────────────────────────────────────────────────────────────

/**
 * What happens to the accounts and transactions a bank brought in:
 * 'keep' leaves them as ordinary data nothing updates any more; 'delete'
 * removes them, on every device. The bank's access is revoked either way.
 */
export type DisconnectMode = 'keep' | 'delete';

export interface DisconnectDeps {
  /** DELETE the bank on the server. */
  remove(): Promise<unknown>;
  /** The ids of the banks the server lists now. */
  listedIds(): Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Ask the server to disconnect a bank, and be sure of the answer. A request
 * that timed out, lost its connection or found nothing to remove (an earlier
 * attempt that did finish) says nothing about the outcome: revoking at the
 * bank and deleting two years of history can outlast the phone's wait while
 * the server still completes it. Then the bank list decides: gone means
 * done. Anything else — the server's own refusal, or a bank still listed
 * once the wait is over — rejects with the original reason.
 */
export async function confirmDisconnect(bankId: string, d: DisconnectDeps): Promise<void> {
  try {
    await d.remove();
    return;
  } catch (e) {
    const kind = toApiFailure(e).kind;
    if (kind !== 'timeout' && kind !== 'network' && kind !== 'notFound') throw e;
    const sleep = d.sleep ?? realSleep;
    const max = Math.max(1, d.maxAttempts ?? 10);
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        if (!(await d.listedIds()).includes(bankId)) return;
      } catch {
        /* the server is still busy, or the phone is offline: ask again */
      }
      if (attempt < max) await sleep(d.intervalMs ?? 3_000);
    }
    throw e;
  }
}

/** Disconnect a bank. Rejects with the server's reason; nothing changes then. */
export async function disconnectBank(bankId: string, mode: DisconnectMode = 'keep'): Promise<void> {
  const api = await client();
  await confirmDisconnect(bankId, {
    remove: () => api.delete(`/api/plaid/items/${encodeURIComponent(bankId)}?data=${mode}`),
    listedIds: async () => (await fetchPlaidItems()).map((item) => item.id),
  });
  await pullSoon().catch(() => {});
  try {
    const AsyncStorage = await storage();
    await AsyncStorage.removeItem(userKey(LINKED_BANKS_KEY));
    await AsyncStorage.removeItem(userKey(LINKED_ACCOUNTS_KEY));
  } catch {
    /* nothing cached, or nobody signed in */
  }
}

// Enable/disable syncing for a single linked account. Persists to the backend
// (PlaidAccount.isEnabled); disabled accounts are skipped by the next sync.
// `accountId` is the Plaid account id used as LinkedAccount.id.
export async function toggleAccountSync(accountId: string, enabled: boolean): Promise<boolean> {
  try {
    const api = await client();
    await api.patch(`/api/plaid/accounts/${encodeURIComponent(accountId)}`, { isEnabled: enabled });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync transactions for every linked bank. Never rejects: `error` carries
 * what went wrong when the whole sync failed (a free plan, no provider,
 * offline), `failedBanks` the banks that could not be read.
 */
export async function syncAllTransactions(): Promise<{
  success: boolean;
  newTransactions: number;
  failedBanks: string[];
  error: unknown;
}> {
  try {
    const api = await client();
    // Backend pulls new transactions for every active bank using the stored
    // access tokens and books them into the user's transactions.
    const r = await api.post<{ added: number; failed?: { institutionName: string | null }[] }>(
      '/api/plaid/transactions/sync',
      {}
    );
    // Even a partial sync may have booked some: bring them into the ledger.
    await pullSoon().catch(() => {});
    const failedBanks = (r.failed ?? []).map((f) => f.institutionName ?? t('bankLink.unnamedBank'));
    return { success: failedBanks.length === 0, newTransactions: r.added ?? 0, failedBanks, error: null };
  } catch (e) {
    return { success: false, newTransactions: 0, failedBanks: [], error: e };
  }
}

// ── Saying what went wrong ───────────────────────────────────────────────────

/** Plaid's reason a bank could not be reached, in the reader's language, or null. */
function providerReason(code: string | null | undefined): string | null {
  switch (code) {
    case 'INSTITUTION_DOWN':
    case 'INSTITUTION_NOT_RESPONDING':
    case 'INSTITUTION_NOT_AVAILABLE':
    case 'INSTITUTION_NO_LONGER_SUPPORTED':
      return t('bankLink.errors.bankDown');
    case 'ITEM_LOGIN_REQUIRED':
    case 'INVALID_CREDENTIALS':
    case 'INVALID_MFA':
      return t('bankLink.errors.signInAgain');
    case 'RATE_LIMIT_EXCEEDED':
    case 'INSTITUTION_RATE_LIMIT':
      return t('apiErrors.rateLimited');
    case 'INVALID_API_KEYS':
    case 'INVALID_SECRET':
    case 'INVALID_CLIENT_ID':
      return t('bankLink.errors.providerConfig');
    default:
      return null;
  }
}

/**
 * Why linking (or syncing, or disconnecting) failed, in the reader's
 * language: the server's code when it sent one this screen knows, Plaid's own
 * code next, then the server's own words, then what kind of failure it was.
 */
export function bankLinkErrorMessage(e: unknown): string {
  if (e instanceof BankLinkError || (e as { name?: unknown })?.name === 'BankLinkError') {
    switch ((e as BankLinkError).code) {
      case 'no_hosted_url':
        return t('bankLink.errors.unavailable');
      case 'expired':
        return t('bankLink.errors.expired');
      case 'locked':
      case 'browser':
        return t('bankLink.errors.browser');
    }
  }
  const failure = toApiFailure(e);
  const body = (failure.body ?? {}) as { code?: unknown; providerCode?: unknown };
  const providerCode = typeof body.providerCode === 'string' ? body.providerCode : null;
  switch (body.code) {
    case 'not_configured':
      return t('bankLink.errors.notConfigured');
    case 'link_session_not_found':
      return t('bankLink.errors.expired');
    case 'provider_config':
      return t('bankLink.errors.providerConfig');
    case 'provider_unavailable':
      return providerReason(providerCode) ?? t('bankLink.errors.providerUnavailable');
    case 'provider_rejected':
      return (
        providerReason(providerCode) ??
        (providerCode
          ? t('bankLink.errors.providerRejectedCode', { code: providerCode })
          : t('bankLink.errors.providerRejected'))
      );
  }
  return failure.serverMessage ?? failure.message;
}

/** Why the user came back from Plaid without a bank, or null for a plain exit. */
export function exitReasonMessage(code: string | null): string | null {
  if (!code) return null;
  return providerReason(code) ?? t('bankLink.errors.exitedCode', { code });
}

/**
 * What a bank connection grants us.
 *
 * Takes an optional connection: before linking there is no bank yet, and the
 * terms are the same either way.
 */
export function getConsentInfo(bank?: LinkedBank): ConsentInfo {
  return {
    dataAccessed: [t('bankLink.consent.balances'), t('bankLink.consent.history'), t('bankLink.consent.names')],
    permissions: [t('bankLink.consent.readOnly'), t('bankLink.consent.noPayments'), t('bankLink.consent.noPersonal')],
    expiresAt: bank?.consentExpiresAt ?? '',
    canRevoke: true,
  };
}

// Check if any bank connections need renewal
export async function checkConnectionHealth(): Promise<{
  healthy: LinkedBank[];
  expiringSoon: LinkedBank[];
  expired: LinkedBank[];
}> {
  return connectionHealth(await getLinkedBanks());
}

/** Sort banks by consent: expired, expiring within a week, healthy. */
export function connectionHealth(banks: LinkedBank[], now: Date = new Date()) {
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const healthy: LinkedBank[] = [];
  const expiringSoon: LinkedBank[] = [];
  const expired: LinkedBank[] = [];

  for (const bank of banks) {
    const expiresAt = new Date(bank.consentExpiresAt);
    if (expiresAt < now) {
      expired.push({ ...bank, connectionStatus: 'expired' });
    } else if (expiresAt < sevenDaysFromNow) {
      expiringSoon.push(bank);
    } else {
      healthy.push(bank);
    }
  }

  return { healthy, expiringSoon, expired };
}

// Sync scheduling settings used to live here — autoSync, syncFrequency,
// notifyOnNewTransactions and friends. Nothing read them and no scheduler
// existed to honour them, so they were settings that silently did nothing.
// Syncing is triggered explicitly, by pull-to-refresh, and by the provider's
// webhook.
