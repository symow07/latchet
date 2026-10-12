/**
 * Shared vocabulary for subscription detection.
 *
 * There were four implementations of this feature — three of them live and
 * reachable from different screens, guaranteed to disagree with each other.
 * One engine now consumes a normalised charge stream, and each data source
 * (device transactions, statement imports, bank feeds, business expenses,
 * email findings) supplies charges in this shape.
 *
 * Pure types: nothing here imports the database or anything native. The
 * engine's record mirrors the phone's `Subscription` row (lib/db.ts) without
 * depending on it, so the engine stays runnable under plain `bun test`.
 */

export type Cadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'
  | 'unknown';

/** Where a charge came from. */
export type ChargeSource = 'transaction' | 'expense' | 'email' | 'bank' | 'import' | 'manual';

/** Where a subscription was seen, as a row's `sources` lists it. */
export type SubscriptionSource = 'transaction' | 'import' | 'bank' | 'email' | 'manual';

/** Where a subscription is billed, and so where it must be cancelled. */
export type BilledVia = 'apple' | 'google_play' | 'paypal';

/** One payment, from any source, in the engine's own terms. */
export interface SourceCharge {
  /** Id of the underlying row, so occurrences can be traced back. */
  id: string;
  /**
   * Real merchant text. Required, and deliberately not falling back to the
   * category: grouping by category made every "Food" expense one merchant, so
   * the app reported "Food — monthly, $45" as a subscription.
   */
  merchant: string;
  amount: number;
  /** YYYY-MM-DD. */
  dateISO: string;
  currency: string;
  source: ChargeSource;
  /** Carried through for display, and a hint against habits. Never used for grouping. */
  category?: string;
}

// ── Email evidence ───────────────────────────────────────────────────────────

export type EmailKind = 'renewal' | 'receipt' | 'trial_ending' | 'price_change' | 'cancellation' | 'other';

/** One email finding (I-PARSE's EmailFinding as the phone caches it). */
export interface EmailEvidence {
  id: string;
  kind: EmailKind;
  merchant: string | null;
  senderDomain: string | null;
  billedVia: BilledVia | null;
  amount: number | null;
  currency: string | null;
  cadence: Cadence;
  /** YYYY-MM-DD the email was sent. */
  dateISO: string;
  /** YYYY-MM-DD of the charge the email reports, when it reports one. */
  chargedISO: string | null;
  /** YYYY-MM-DD of the next charge, when the email states it. */
  nextChargeISO: string | null;
  /** YYYY-MM-DD a free trial converts, for trial_ending. */
  trialEndsISO: string | null;
  /** The old price, for price_change. */
  previousAmount: number | null;
  source: 'gmail' | 'outlook' | 'forwarding';
}

// ── The engine's record ──────────────────────────────────────────────────────

/** The user's decision about a subscription. */
export type SubscriptionDecision = 'keep' | 'cancel' | 'dismiss';

/**
 * The engine's reading (possible, active, trial, ended) while the user has not
 * decided, and the one following their decision (keep → confirmed,
 * cancel → canceled, dismiss → dismissed) once they have.
 */
export type SubscriptionStatus =
  | 'possible'
  | 'active'
  | 'trial'
  | 'ended'
  | 'confirmed'
  | 'canceled'
  | 'dismissed';

export type SubscriptionAlert = 'price_rise' | 'charged_after_cancel' | 'trial_ending';

/** A subscription row as the engine reads and writes it: the phone's row minus createdAt. */
export interface SubscriptionRecord {
  id: string;
  merchantDisplay: string;
  /** The canonical merchant key (merchantKey); older rows may hold an older spelling. */
  merchantNormalized: string;
  cadence: Cadence;
  /** The current price: the latest sustained amount, never an average. */
  typicalAmount: number;
  currency: string;
  confidenceScore: number;
  lastChargedAt: string | null;
  nextExpectedAt: string | null;
  status: SubscriptionStatus;
  cancelUrl: string | null;
  cancelNotes: string | null;
  /** Where it was first seen. */
  source: SubscriptionSource;
  /** Comma list of every source that contributed, in a fixed order. */
  sources: string;
  decision: SubscriptionDecision | null;
  canceledAt: string | null;
  trialEndsAt: string | null;
  previousAmount: number | null;
  priceChangedAt: string | null;
  alert: SubscriptionAlert | null;
  billedVia: BilledVia | null;
}

export interface ReconcileInput {
  charges: SourceCharge[];
  email: EmailEvidence[];
  existing: SubscriptionRecord[];
  /** YYYY-MM-DD, the user's local date. */
  today: string;
}

export type DetectionEvent =
  | { type: 'new'; subscriptionId: string }
  | { type: 'trial_found'; subscriptionId: string; trialEndsAt: string }
  | { type: 'price_rise'; subscriptionId: string; from: number; to: number }
  | { type: 'charged_after_cancel'; subscriptionId: string; chargedAt: string; amount: number }
  | { type: 'ended'; subscriptionId: string };

export interface ReconcileOccurrence {
  subscriptionId: string;
  /** The ledger charge's id (or the email finding's, for a payment only email saw). */
  chargeId: string;
  dateISO: string;
  amount: number;
}

export interface ReconcileResult {
  /** Only rows that changed (or are new). */
  upserts: SubscriptionRecord[];
  /** Older rows for the same merchant folded into one; delete `fromId` after moving its history. */
  merges: { fromId: string; intoId: string }[];
  /** Every charge behind every subscription row, current or new; idempotent to write. */
  occurrences: ReconcileOccurrence[];
  /** Only for changes: a quiet re-run returns none. */
  events: DetectionEvent[];
}

// ── The older, list-shaped detector (analytics) ──────────────────────────────

export interface SubscriptionOccurrenceRef {
  chargeId: string;
  dateISO: string;
  amount: number;
}

export interface DetectedSubscription {
  /** Stable across price changes: the merchant, nothing else. */
  id: string;
  merchantDisplay: string;
  merchantNormalized: string;
  cadence: Cadence;
  /** The current price, not an average. */
  typicalAmount: number;
  currency: string;
  confidenceScore: number;
  lastChargedAt: string;
  nextExpectedAt: string;
  status: 'possible' | 'confirmed';
  source: ChargeSource;
  /** Most common category across the cluster, for display only. */
  category: string;
  /** Sum of every charge in the cluster. */
  totalSpent: number;
  occurrences: SubscriptionOccurrenceRef[];
}

export interface DetectionOptions {
  /** Minimum charges before a merchant can be listed. */
  minOccurrences?: number;
  /** Confidence at or above which a detection is reported as confirmed. */
  confirmAt?: number;
}
