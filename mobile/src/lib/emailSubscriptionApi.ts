import { addWeeks, addMonths, addYears } from 'date-fns';
import { api } from './api/api';
import { normalizeMerchant, displayMerchant } from './subscription-detection';
import { findCancelEntry } from './cancel-directory';
import { getSubscriptions, upsertSubscription, type Subscription } from './db';
import type { DetectedSubscription } from './business-subscription-detection';

/**
 * Client for email forwarding (backend routes/email.ts): the user forwards
 * billing emails to a private address, the server parses them, and
 * importInboxSubscriptions merges the results into the local SQLite store so
 * they flow through the existing subscriptions UI.
 */

export interface EmailSubscription {
  merchant: string;
  amount: number;
  currency: string;
  cadence: 'weekly' | 'monthly' | 'yearly' | 'unknown';
  lastChargedISO: string | null;
}

export interface EmailStatus {
  forwarding: { address: string; verified: boolean } | null;
  inboxConfigured: boolean;
  inboxCount: number;
}

export interface InboxItem {
  id: string;
  /** Sender's domain only — the raw address is not stored. */
  senderDomain: string | null;
  /** Digit-stripped subject remnant; may be empty. */
  label: string;
  merchant: string | null;
  amount: number | null;
  currency: string;
  cadence: 'weekly' | 'monthly' | 'yearly' | 'unknown';
  chargedISO: string | null;
  isSubscription: boolean;
  status: 'parsed' | 'imported' | 'ignored' | 'confirmation';
  receivedAt: string;
}

export async function getEmailStatus(): Promise<EmailStatus> {
  return api.get<EmailStatus>('/api/email/status');
}

// ── Forward-to-inbox ("inbox inside Budget") ─────────────────────────────────

/** Provision (once) and return this user's private forwarding address. */
export async function getInboxAddress(): Promise<{ address: string; verified: boolean }> {
  return api.get<{ address: string; verified: boolean }>('/api/email/inbox-address');
}

/** All parsed inbox items (invoices + Gmail confirmation codes), newest first. */
export async function getInbox(): Promise<InboxItem[]> {
  const { items } = await api.get<{ items: InboxItem[] }>('/api/email/inbox');
  return items ?? [];
}

async function markInboxImported(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await api.post('/api/email/inbox/imported', { ids });
}

/**
 * Import not-yet-imported subscription invoices from the inbox into the local
 * subscription store, then flag them imported on the backend so they aren't
 * re-added. Returns how many subscriptions were saved.
 */
export async function importInboxSubscriptions(items: InboxItem[]): Promise<number> {
  const pending = items.filter(
    (i) => i.status === 'parsed' && i.isSubscription && i.merchant,
  );
  if (pending.length === 0) return 0;

  const subs: EmailSubscription[] = pending.map((i) => ({
    merchant: i.merchant as string,
    amount: i.amount ?? 0,
    currency: i.currency,
    cadence: i.cadence,
    lastChargedISO: i.chargedISO,
  }));

  const saved = await saveEmailSubscriptions(subs);
  await markInboxImported(pending.map((i) => i.id));
  return saved;
}

function predictNext(lastISO: string | null, cadence: EmailSubscription['cadence']): string | null {
  if (!lastISO) return null;
  const last = new Date(lastISO);
  if (isNaN(last.getTime())) return null;
  switch (cadence) {
    case 'weekly': return addWeeks(last, 1).toISOString().split('T')[0];
    case 'monthly': return addMonths(last, 1).toISOString().split('T')[0];
    case 'yearly': return addYears(last, 1).toISOString().split('T')[0];
    default: return addMonths(last, 1).toISOString().split('T')[0];
  }
}

/**
 * Persist email-detected subscriptions into the local store. Skips merchants we
 * already track from transactions (that data is richer). Returns how many were
 * newly saved/updated from email.
 */
export async function saveEmailSubscriptions(detected: EmailSubscription[]): Promise<number> {
  const existing = await getSubscriptions();
  const fromTransactions = new Set(
    existing
      .filter(s => (s.source ?? 'transaction') === 'transaction')
      .map(s => s.merchantNormalized),
  );

  let saved = 0;
  for (const d of detected) {
    const normalized = normalizeMerchant(d.merchant) || d.merchant.toLowerCase();
    if (fromTransactions.has(normalized)) continue; // don't duplicate a richer record

    const cancelUrl = findCancelEntry(normalized)?.cancelUrl ?? null;
    const id = `subemail_${normalized.replace(/\s+/g, '_').toLowerCase()}`;

    const sub: Omit<Subscription, 'createdAt' | 'updatedAt'> = {
      id,
      merchantDisplay: d.merchant || displayMerchant(normalized),
      merchantNormalized: normalized,
      cadence: d.cadence,
      typicalAmount: Math.round(d.amount * 100) / 100,
      currency: d.currency || 'USD',
      confidenceScore: 55, // email-sourced → "possible" until the user confirms
      lastChargedAt: d.lastChargedISO,
      nextExpectedAt: predictNext(d.lastChargedISO, d.cadence),
      status: 'possible',
      cancelUrl,
      cancelNotes: null,
      source: 'email',
    };
    await upsertSubscription(sub);
    saved++;
  }
  return saved;
}

/** Monthly-normalized amount for a subscription's cadence. */
function monthlyize(amount: number, cadence: Subscription['cadence']): number {
  if (cadence === 'weekly') return amount * 4.33;
  if (cadence === 'yearly') return amount / 12;
  return amount;
}

/** Convert an email-detected SQLite subscription into the business screen's
 *  DetectedSubscription shape so it can be merged into that view. */
export function emailSubToDetected(sub: Subscription): DetectedSubscription {
  const entry = findCancelEntry(sub.merchantNormalized);
  return {
    key: sub.id,
    name: sub.merchantDisplay,
    amount: monthlyize(sub.typicalAmount, sub.cadence),
    category: 'Software',
    lastChargeDate: sub.lastChargedAt ?? new Date().toISOString(),
    nextChargeDate: sub.nextExpectedAt ?? new Date(Date.now() + 30 * 86400000).toISOString(),
    isRecurring: true,
    monthlyCount: 1,
    cancelInstructions:
      entry?.steps.join(' → ') ??
      'Visit the service\'s account or billing settings page and select "Cancel" or "End subscription".',
    cancelUrl: sub.cancelUrl ?? entry?.cancelUrl,
  };
}

/** Email-detected subscriptions (active only) mapped for the business screen. */
export async function getEmailDetectedForBusiness(): Promise<DetectedSubscription[]> {
  const all = await getSubscriptions();
  return all
    .filter((s) => (s.source ?? 'transaction') === 'email' && s.status !== 'canceled')
    .map(emailSubToDetected);
}
