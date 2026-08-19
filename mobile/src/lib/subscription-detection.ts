/**
 * Subscription detection for the personal ledger: fetch, detect, persist.
 *
 * The detection itself lives in lib/subscriptions/engine — one implementation
 * shared with business expenses and email scanning. This file is the device
 * transactions source plus the SQLite write path.
 */
import { todayISO, daysAheadISO, isBetween } from './dates';
import {
  getTransactions,
  getSubscriptions,
  upsertSubscription,
  addSubscriptionOccurrence,
  type Subscription,
} from './db';
import { detectSubscriptions, occurrenceId, monthlyCost } from './subscriptions/engine';
import { chargesFromTransactions } from './subscriptions/sources';

export {
  normalizeMerchant,
  displayMerchant,
  detectSubscriptions,
  monthlyCost,
} from './subscriptions/engine';
export { chargesFromTransactions } from './subscriptions/sources';
export type {
  DetectedSubscription,
  SourceCharge,
  Cadence,
} from './subscriptions/types';

/**
 * Scan the device's transactions and persist what looks recurring.
 * Returns the number of subscriptions detected.
 */
export async function scanAndSaveSubscriptions(): Promise<number> {
  const charges = chargesFromTransactions(await getTransactions());
  if (charges.length < 3) return 0;

  const detections = detectSubscriptions(charges);

  // A subscription the user has confirmed or cancelled is theirs, not ours —
  // detection must never overwrite that decision.
  const existing = await getSubscriptions();
  const userDecided = new Set(
    existing
      .filter((s) => s.status === 'confirmed' || s.status === 'canceled')
      .map((s) => s.merchantNormalized)
  );

  let saved = 0;
  for (const sub of detections) {
    if (userDecided.has(sub.merchantNormalized)) continue;

    await upsertSubscription({
      id: sub.id,
      merchantDisplay: sub.merchantDisplay,
      merchantNormalized: sub.merchantNormalized,
      cadence: sub.cadence,
      typicalAmount: sub.typicalAmount,
      currency: sub.currency,
      confidenceScore: sub.confidenceScore,
      lastChargedAt: sub.lastChargedAt,
      nextExpectedAt: sub.nextExpectedAt,
      status: sub.status,
      cancelUrl: null,
      cancelNotes: null,
      source: 'transaction',
    });

    for (const occ of sub.occurrences) {
      await addSubscriptionOccurrence({
        // Deterministic: re-scanning the same charge must not append a
        // second occurrence, which is exactly what random ids allowed.
        id: occurrenceId(sub.id, occ.chargeId),
        subscriptionId: sub.id,
        transactionId: occ.chargeId,
        chargedAt: occ.dateISO,
        amount: occ.amount,
      });
    }
    saved++;
  }

  return saved;
}

/** Subscriptions due within the next `withinDays` days. */
export function getUpcomingCharges(
  subscriptions: Subscription[],
  withinDays: number = 30
): Subscription[] {
  // Compare as YYYY-MM-DD strings. Parsing nextExpectedAt with `new Date()`
  // gives UTC midnight while `new Date()` for today carries the local wall
  // clock, so east of UTC a charge due *today* tested as already past and
  // vanished from the list part-way through the morning.
  const today = todayISO();
  const cutoff = daysAheadISO(withinDays);
  return subscriptions
    .filter((s) => s.status !== 'canceled' && s.nextExpectedAt)
    .filter((s) => isBetween(s.nextExpectedAt!.slice(0, 10), today, cutoff))
    .sort((a, b) => (a.nextExpectedAt ?? '').localeCompare(b.nextExpectedAt ?? ''));
}

/** Total monthly cost of active subscriptions. */
export function monthlySubscriptionTotal(subscriptions: Subscription[]): number {
  return monthlyCost(
    subscriptions
      .filter((s) => s.status !== 'canceled')
      .map((s) => ({
        cadence: s.cadence as 'weekly' | 'monthly' | 'yearly' | 'unknown',
        typicalAmount: s.typicalAmount,
      })) as Parameters<typeof monthlyCost>[0]
  );
}
