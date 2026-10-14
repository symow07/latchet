/**
 * What the email screen (email-inbox.tsx) and its entry card show, worked
 * out away from React.
 *
 * Gmail and Outlook are the main path: a button each, one honest line each on
 * what Latchet reads and what it keeps, and every connection's state — reading
 * its first year (with how many emails it has checked), up to date, needing
 * to be reconnected, or failing. A provider this server cannot connect is
 * shown as unavailable rather than offered. While Google has not verified
 * Latchet, connecting Gmail is preceded by a word on the warning Google will
 * show; when Gmail's unverified cap is reached, the screen says so and points
 * to forwarding, which is the backup for every other provider (iCloud, Yahoo,
 * GMX…): the private address, its state, Gmail's confirmation code when one
 * has come, and short steps for each provider.
 *
 * Pure: no React Native, no network. Everything comes in as data.
 */
import { t } from './i18n/core';
import { displayNameFor, merchantKey } from './subscriptions/merchant';
import { currencyOf, formatMoney, shortDate } from './subscription-view';
import { firstReadPending } from './email-connections';
import type {
  ConnectProgress,
  ConnectResult,
  ConnectableProvider,
  EmailConnectionDTO,
  EmailConnectionsDTO,
  ForwardingAddress,
} from './email-connections';
import type { LocalEmailFinding } from './db';

// ── Providers ────────────────────────────────────────────────────────────────

export const CONNECTABLE: readonly ConnectableProvider[] = ['gmail', 'outlook'];

export function providerName(provider: string): string {
  return provider === 'gmail' || provider === 'outlook' || provider === 'forwarding'
    ? t(`emailConnect.provider.${provider}`)
    : provider;
}

/** Whose account page a grant is removed on: Google for Gmail, Microsoft for Outlook. */
export function accountOwnerName(provider: string): string {
  return provider === 'gmail' || provider === 'outlook' ? t(`emailConnect.owner.${provider}`) : providerName(provider);
}

export type ProviderAvailability = 'available' | 'cap_reached' | 'unavailable';

export interface ProviderOption {
  provider: ConnectableProvider;
  name: string;
  availability: ProviderAvailability;
  /** "Connect Gmail", or "Connect another Gmail" once one is connected. */
  label: string;
  /** Connecting it first explains Google's unverified-app warning. */
  explainFirst: boolean;
  /** How many of this provider's inboxes are connected. */
  connected: number;
}

/**
 * The connect buttons. Unconfigured providers are marked unavailable (the
 * screen hides them); Gmail past its cap is marked so; Gmail while Google
 * has not verified the app asks for the explainer first.
 */
export function providerOptions(dto: EmailConnectionsDTO | null | undefined): ProviderOption[] {
  return CONNECTABLE.map((provider) => {
    const connected = (dto?.connections ?? []).filter((c) => c.provider === provider).length;
    const configured = provider === 'gmail' ? !!dto?.providers.gmail.configured : !!dto?.providers.outlook.configured;
    const capReached = provider === 'gmail' && !!dto?.providers.gmail.capReached;
    const availability: ProviderAvailability = !configured ? 'unavailable' : capReached ? 'cap_reached' : 'available';
    const name = providerName(provider);
    return {
      provider,
      name,
      availability,
      label: connected > 0 ? t('emailConnect.connectAnother', { provider: name }) : t('emailConnect.connect', { provider: name }),
      explainFirst: provider === 'gmail' && configured && dto?.providers.gmail.verified === false,
      connected,
    };
  });
}

/** Whether Gmail is the one closed for now, so forwarding is the way in for it. */
export function gmailCapReached(dto: EmailConnectionsDTO | null | undefined): boolean {
  return !!dto?.providers.gmail.configured && !!dto.providers.gmail.capReached;
}

// ── Connections ──────────────────────────────────────────────────────────────

export type ConnectionState = 'backfilling' | 'syncing' | 'up_to_date' | 'waiting' | 'retrying' | 'needs_reauth' | 'error';

export interface ConnectionView {
  id: string;
  provider: ConnectableProvider;
  providerName: string;
  address: string;
  state: ConnectionState;
  /** One line on where it stands. */
  stateText: string;
  /** What it has done: emails checked, billing emails found. */
  detail: string | null;
  /** Something is wrong that the user can see to (reconnect, or wait for a retry). */
  attention: boolean;
  canReconnect: boolean;
  /** Still reading or checking: the screen polls. */
  busy: boolean;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return null;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t('emailConnect.time.justNow');
  if (minutes < 60) return t('emailConnect.time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('emailConnect.time.hours', { count: hours });
  return t('emailConnect.time.days', { count: Math.floor(hours / 24) });
}

/** Where one Gmail or Outlook connection stands. */
export function connectionView(c: EmailConnectionDTO, now: number): ConnectionView {
  const provider = c.provider as ConnectableProvider;
  const scanned = Math.max(0, Number(c.messagesScanned) || 0);
  const found = Math.max(0, Number(c.findingsCount) || 0);
  const firstYearDone = !!c.backfillDoneAt;

  let state: ConnectionState;
  if (c.status === 'needs_reauth') state = 'needs_reauth';
  else if (c.status === 'error') state = 'error';
  else if (c.syncState === 'backfilling' || (!firstYearDone && c.syncState !== 'syncing' && !c.lastError && scanned > 0)) state = 'backfilling';
  else if (c.syncState === 'syncing') state = 'syncing';
  else if (c.lastError) state = 'retrying';
  else if (!c.lastSyncedAt && !firstYearDone) state = 'waiting';
  else state = 'up_to_date';

  let stateText: string;
  switch (state) {
    case 'needs_reauth':
      stateText = t('emailConnect.state.needsReauth');
      break;
    case 'error':
      stateText = c.lastError === 'mailbox_unavailable' ? t('emailConnect.state.noMailbox') : t('emailConnect.state.error');
      break;
    case 'backfilling':
      stateText = t('emailConnect.state.backfilling');
      break;
    case 'syncing':
      stateText = t('emailConnect.state.syncing');
      break;
    case 'retrying':
      stateText = t('emailConnect.state.retrying');
      break;
    case 'waiting':
      stateText = t('emailConnect.state.waiting');
      break;
    default: {
      const when = relativeTime(c.lastSyncedAt ?? c.backfillDoneAt, now);
      stateText = when ? t('emailConnect.state.upToDate', { when }) : t('emailConnect.state.upToDateNoTime');
    }
  }

  const parts: string[] = [];
  if (scanned > 0) parts.push(t('emailConnect.scanned', { count: scanned }));
  if (found > 0 || firstYearDone) parts.push(t('emailConnect.found', { count: found }));

  return {
    id: c.id,
    provider,
    providerName: providerName(provider),
    address: c.address,
    state,
    stateText,
    detail: parts.length ? parts.join(' · ') : null,
    attention: state === 'needs_reauth' || state === 'error' || state === 'retrying',
    canReconnect: state === 'needs_reauth' || state === 'error',
    busy: state === 'backfilling' || state === 'syncing',
  };
}

/** The Gmail and Outlook connections, in the server's order; forwarding has its own section. */
export function connectionViews(dto: EmailConnectionsDTO | null | undefined, now: number): ConnectionView[] {
  return (dto?.connections ?? []).filter((c) => c.provider === 'gmail' || c.provider === 'outlook').map((c) => connectionView(c, now));
}

/** How often to ask again while an inbox is being read: every few seconds, else not at all. */
export function pollInterval(dto: EmailConnectionsDTO | null | undefined): number | false {
  return (dto?.connections ?? []).some(firstReadPending) ? 4_000 : false;
}

// ── Connecting ───────────────────────────────────────────────────────────────

export interface Notice {
  tone: 'ok' | 'warning' | 'error';
  text: string;
}

/** What a connect attempt says when it ends. Nothing when the user closed the window themselves. */
export function connectOutcome(provider: ConnectableProvider, r: ConnectResult): Notice | null {
  const name = providerName(provider);
  switch (r.result) {
    case 'success':
      return { tone: 'ok', text: t('emailConnect.outcome.success', { provider: name }) };
    case 'cancel':
      return null;
    case 'denied':
      return { tone: 'warning', text: t('emailConnect.outcome.denied', { provider: name }) };
    default:
      break;
  }
  switch (r.reason) {
    case 'not_configured':
      return { tone: 'warning', text: t('emailConnect.outcome.notConfigured', { provider: name }) };
    case 'cap_reached':
      return { tone: 'warning', text: t('emailConnect.cap.body') };
    case 'locked':
      return { tone: 'warning', text: t('emailConnect.outcome.locked') };
    case 'browser':
      return { tone: 'error', text: t('emailConnect.outcome.browser') };
    case 'network':
    case 'timeout':
      return { tone: 'error', text: t('emailConnect.outcome.offline') };
    case 'rateLimited':
      return { tone: 'warning', text: t('emailConnect.outcome.tooMany') };
    default:
      return { tone: 'error', text: t('emailConnect.outcome.failed', { provider: name }) };
  }
}

/** The line shown while a connect runs. */
export function progressText(provider: ConnectableProvider, p: ConnectProgress): string {
  const name = providerName(provider);
  switch (p.phase) {
    case 'authorizing':
      return t('emailConnect.progress.authorizing', { provider: name });
    case 'backfilling': {
      const scanned = Math.max(0, Number(p.connection?.messagesScanned) || 0);
      return scanned > 0
        ? `${t('emailConnect.state.backfilling')} ${t('emailConnect.scanned', { count: scanned })}`
        : t('emailConnect.state.backfilling');
    }
    case 'pulling':
      return t('emailConnect.progress.pulling');
    default:
      return t('emailConnect.progress.done');
  }
}

// ── Disconnecting ────────────────────────────────────────────────────────────

/** The confirmation's words. Outlook's says up front that one step is left to the user. */
export function disconnectCopy(c: Pick<EmailConnectionDTO, 'provider' | 'address'>): { title: string; body: string; manual: string | null } {
  const provider = providerName(c.provider);
  return {
    title: t('emailConnect.disconnect.title', { address: c.address || provider }),
    body: t('emailConnect.disconnect.body'),
    manual: c.provider === 'outlook' ? t('emailConnect.disconnect.outlookManual') : null,
  };
}

// ── Forwarding ───────────────────────────────────────────────────────────────

export const FORWARDING_PROVIDERS = ['icloud', 'yahoo', 'gmx', 'gmail', 'other'] as const;
export type ForwardingProvider = (typeof FORWARDING_PROVIDERS)[number];

const FORWARDING_STEP_COUNT: Readonly<Record<ForwardingProvider, number>> = {
  icloud: 3,
  yahoo: 2,
  gmx: 3,
  gmail: 3,
  other: 2,
};

export function forwardingProviderName(p: ForwardingProvider): string {
  return t(`emailConnect.forwarding.providers.${p}`);
}

/** The short steps for forwarding billing email from one provider, in the reader's language. */
export function forwardingSteps(p: ForwardingProvider): string[] {
  return Array.from({ length: FORWARDING_STEP_COUNT[p] }, (_, i) => t(`emailConnect.forwarding.steps.${p}.s${i + 1}`));
}

export interface ForwardingView {
  available: boolean;
  address: string | null;
  verified: boolean;
  /** "Receiving" or "Waiting for the first email". */
  stateText: string;
  /** Gmail's confirmation code, when it has come. */
  code: string | null;
}

export function forwardingView(dto: EmailConnectionsDTO | null | undefined, address: ForwardingAddress | null | undefined): ForwardingView {
  const available = !!dto?.providers.forwarding.configured;
  const conn = dto?.connections.find((c) => c.provider === 'forwarding');
  const verified = !!(address?.verified ?? conn?.forwardingVerified);
  return {
    available,
    address: address?.address || conn?.address || null,
    verified,
    stateText: verified ? t('emailConnect.forwarding.receiving') : t('emailConnect.forwarding.waiting'),
    code: verified ? null : (address?.confirmationCode ?? null),
  };
}

// ── What was found ───────────────────────────────────────────────────────────

export interface FindingRow {
  id: string;
  title: string;
  /** "Receipt · Oct 3". */
  meta: string;
  amount: number | null;
  currency: string;
}

const KINDS = new Set(['renewal', 'receipt', 'trial_ending', 'price_change', 'cancellation']);

function findingDate(f: LocalEmailFinding): string {
  return (f.emailDateISO ?? f.chargedISO ?? f.receivedAt ?? '').slice(0, 10);
}

/** The latest billing emails found, newest first: merchant, kind, amount. Nothing that is not a billing email. */
export function findingRows(findings: readonly LocalEmailFinding[], userCurrency: string, limit = 20): FindingRow[] {
  return findings
    .filter((f) => KINDS.has(f.kind))
    .sort((a, b) => findingDate(b).localeCompare(findingDate(a)) || (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '') || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit))
    .map((f) => {
      const raw = f.merchant || f.senderDomain || '';
      const key = raw ? merchantKey(raw) : '';
      const title = raw ? displayNameFor(key, raw) || raw : t('emailConnect.findings.unknown');
      const date = findingDate(f);
      return {
        id: f.id,
        title,
        meta: [t(`emailConnect.kind.${f.kind}`), date ? shortDate(date) : null].filter(Boolean).join(' · '),
        amount: typeof f.amount === 'number' && Number.isFinite(f.amount) ? f.amount : null,
        currency: currencyOf({ currency: f.currency }, userCurrency),
      };
    });
}

/** "€9.99" for a finding's amount, or nothing. */
export function findingAmount(row: FindingRow): string | null {
  return row.amount === null ? null : formatMoney(row.amount, row.currency);
}

// ── The entry card ───────────────────────────────────────────────────────────

/** The card on the subscriptions and business tools screens: one line on where email stands. */
export function scanCardSummary(dto: EmailConnectionsDTO | null | undefined, now: number): { title: string; body: string; attention: boolean } {
  const title = t('emailConnect.card.title');
  const views = connectionViews(dto, now);
  if (views.length === 0) {
    const forwarding = dto?.connections.find((c) => c.provider === 'forwarding');
    if (forwarding?.forwardingVerified) {
      return { title, body: t('emailConnect.card.forwarding', { count: Math.max(0, forwarding.findingsCount || 0) }), attention: false };
    }
    return { title, body: t('emailConnect.card.connect'), attention: false };
  }
  const broken = views.find((v) => v.canReconnect);
  if (broken) return { title, body: t('emailConnect.card.attention', { provider: broken.providerName }), attention: true };
  if (views.some((v) => v.state === 'backfilling')) return { title, body: t('emailConnect.state.backfilling'), attention: false };
  const found = (dto?.connections ?? []).reduce((n, c) => n + Math.max(0, Number(c.findingsCount) || 0), 0);
  const names = [...new Set(views.map((v) => v.providerName))].join(t('emailConnect.card.and'));
  return { title, body: t('emailConnect.card.connected', { providers: names, count: found }), attention: false };
}
