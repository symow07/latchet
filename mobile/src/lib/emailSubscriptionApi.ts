import { daysAheadISO, todayISO } from './dates';
import { getEmailFindings, getSubscriptions, type LocalEmailFinding, type Subscription } from './db';
import { cancelGuidanceFor, type DetectedSubscription } from './business-subscription-detection';
import { getEmailConnections, getForwardingAddress, pullEmailFindings } from './email-connections';
import { monthlyFactor } from './subscriptions/cadence';
import { runDetection } from './subscription-detection';

/**
 * The email screens' older calls, kept working over the Phase 6 email API
 * until those screens move to lib/email-connections (leaf 6.7).
 *
 * The routes these used to call — /email/status, /email/inbox and
 * /email/inbox/imported — are gone. What the server reads from a mailbox
 * (Gmail, Outlook, forwarding) is now a finding the phone pulls into its own
 * cache, and detection reads the findings itself after every email sync — no
 * "import" step, and no subscription written here: the one engine
 * (subscription-detection.ts) decides, so an email receipt and the bank's
 * charge for the same payment are one subscription, never two.
 *
 * The server calls reject with an ApiFailure (lib/api-errors), whose message
 * is already in the reader's language.
 */

export interface EmailStatus {
  forwarding: { address: string; verified: boolean } | null;
  inboxConfigured: boolean;
  inboxCount: number;
}

export interface InboxItem {
  id: string;
  /** Sender's domain only — the raw address is not stored. */
  senderDomain: string | null;
  /** Kept for the screen; findings carry no subject text. */
  label: string;
  merchant: string | null;
  amount: number | null;
  currency: string;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'unknown';
  chargedISO: string | null;
  isSubscription: boolean;
  status: 'parsed' | 'imported' | 'ignored' | 'confirmation';
  receivedAt: string;
}

/** Whether forwarding is set up on the server, its connection, and how much the inboxes found. */
export async function getEmailStatus(): Promise<EmailStatus> {
  const { connections, providers } = await getEmailConnections();
  const forwarding = connections.find((c) => c.provider === 'forwarding') ?? null;
  return {
    forwarding: forwarding ? { address: forwarding.address, verified: !!forwarding.forwardingVerified } : null,
    inboxConfigured: providers.forwarding.configured,
    inboxCount: connections.reduce((n, c) => n + (Number(c.findingsCount) || 0), 0),
  };
}

// ── Forward-to-inbox ("inbox inside Budget") ─────────────────────────────────

/** Provision (once) and return this user's private forwarding address. */
export async function getInboxAddress(): Promise<{ address: string; verified: boolean }> {
  return getForwardingAddress();
}

const BILLING_KINDS = new Set(['renewal', 'receipt', 'trial_ending', 'price_change']);
const SHOWN_CADENCES = new Set(['weekly', 'biweekly', 'monthly', 'yearly']);

function toInboxItem(f: LocalEmailFinding): InboxItem {
  const billing = BILLING_KINDS.has(f.kind);
  return {
    id: f.id,
    senderDomain: f.senderDomain,
    label: '',
    merchant: f.merchant,
    amount: f.amount,
    currency: f.currency ?? '',
    // Quarterly and half-yearly have no label on this screen yet: shown as none.
    cadence: SHOWN_CADENCES.has(f.cadence) ? (f.cadence as InboxItem['cadence']) : 'unknown',
    chargedISO: f.chargedISO ?? f.emailDateISO,
    isSubscription: billing,
    status: billing ? 'parsed' : 'ignored',
    receivedAt: f.receivedAt,
  };
}

/**
 * What the inboxes found, newest first: pulls what is new, then reads this
 * phone's cache — so offline it still shows what it last had.
 */
export async function getInbox(): Promise<InboxItem[]> {
  await pullEmailFindings().catch((e) => console.warn('[email] pull failed', e?.kind ?? e));
  const findings = await getEmailFindings();
  return findings.map(toInboxItem).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/**
 * The screen's "Add" button: run detection over the findings now. Nothing is
 * imported item by item any more — the engine reads every finding beside the
 * ledger. Returns how many subscriptions this run found.
 */
export async function importInboxSubscriptions(_items: InboxItem[]): Promise<number> {
  const summary = await runDetection('email', { interactive: true, announce: false });
  return summary.newSubscriptions.length;
}

/** Convert a subscription found in email into the business screen's DetectedSubscription shape. */
export function emailSubToDetected(sub: Subscription): DetectedSubscription {
  // The same guidance the business screen gives a detected charge: the
  // directory's steps for a known service, else the generic steps in the
  // reader's language. This used to fall back to a sentence of English.
  const cancel = cancelGuidanceFor(sub.merchantNormalized);
  return {
    key: sub.id,
    name: sub.merchantDisplay,
    // A month's worth at any cadence (it used to know only weekly and yearly).
    amount: sub.typicalAmount * (monthlyFactor(sub.cadence) || 1),
    category: 'Software',
    lastChargeDate: sub.lastChargedAt ?? todayISO(),
    nextChargeDate: sub.nextExpectedAt ?? daysAheadISO(30),
    isRecurring: true,
    monthlyCount: 1,
    cancelInstructions: cancel.instructions,
    cancelUrl: sub.cancelUrl ?? cancel.url,
  };
}

const OVER = new Set(['canceled', 'dismissed', 'ended']);

/**
 * Subscriptions first found in email, still running, mapped for the business
 * screen — which finds the rest in the business's own expenses.
 */
export async function getEmailDetectedForBusiness(): Promise<DetectedSubscription[]> {
  const all = await getSubscriptions();
  return all.filter((s) => s.source === 'email' && !OVER.has(s.status)).map(emailSubToDetected);
}
