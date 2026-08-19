/**
 * Shared vocabulary for subscription detection.
 *
 * There were four implementations of this feature — three of them live and
 * reachable from different screens, guaranteed to disagree with each other.
 * One engine now consumes a normalised charge stream, and each data source
 * (device transactions, business expenses, scanned email) supplies charges in
 * this shape.
 */

export type Cadence = 'weekly' | 'monthly' | 'yearly' | 'unknown';

export type ChargeSource = 'transaction' | 'expense' | 'email' | 'bank';

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
  /** Carried through for display. Never used for grouping — see `merchant`. */
  category?: string;
}

export interface SubscriptionOccurrenceRef {
  chargeId: string;
  dateISO: string;
  amount: number;
}

export interface DetectedSubscription {
  /**
   * Stable across price changes. The amount used to be part of this, so a
   * price rise minted a second subscription instead of updating the first.
   */
  id: string;
  merchantDisplay: string;
  merchantNormalized: string;
  cadence: Cadence;
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
  /** Minimum charges in a cluster before it can be a subscription. */
  minOccurrences?: number;
  /** Confidence at or above which a detection is reported as confirmed. */
  confirmAt?: number;
}
