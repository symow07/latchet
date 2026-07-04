import { differenceInDays, addDays, addMonths, addWeeks, addYears } from 'date-fns';
import {
  getTransactions,
  getSubscriptions,
  upsertSubscription,
  addSubscriptionOccurrence,
  type Subscription,
} from './db';

// ---------------------------------------------------------------------------
// Merchant normalization
// ---------------------------------------------------------------------------
const NOISE_TOKENS = new Set([
  'pos', 'payment', 'online', 'purchase', 'debit', 'credit', 'card',
  'transaction', 'transfer', 'charge', 'fee', 'refund', 'sale',
  'checkcard', 'recurring', 'autopay', 'auto', 'pay', 'bill', 'billing',
  'www', 'com', 'net', 'org', 'inc', 'llc', 'ltd',
]);

export function normalizeMerchant(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[*\/\-_.,#@!]/g, ' ')  // strip symbols
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
    .split(' ')
    .filter(token => token.length > 1 && !NOISE_TOKENS.has(token.toLowerCase()))
    .slice(0, 3)                      // keep first 3 meaningful tokens
    .join(' ');
}

// Derive a display-friendly name (title case)
export function displayMerchant(normalized: string): string {
  return normalized
    .split(' ')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// ---------------------------------------------------------------------------
// Amount tolerance matching
// ---------------------------------------------------------------------------
function amountsMatch(a: number, b: number): boolean {
  const tolerance = Math.max(0.5, a * 0.1); // ±10% or ±$0.50
  return Math.abs(a - b) <= tolerance;
}

// ---------------------------------------------------------------------------
// Frequency detection
// ---------------------------------------------------------------------------
type Cadence = 'weekly' | 'monthly' | 'yearly' | 'unknown';

function detectCadence(intervals: number[]): Cadence {
  if (intervals.length === 0) return 'unknown';
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avg >= 5 && avg <= 10) return 'weekly';
  if (avg >= 25 && avg <= 38) return 'monthly';
  if (avg >= 330 && avg <= 400) return 'yearly';
  return 'unknown';
}

function predictNextDate(lastDate: string, cadence: Cadence, avgInterval: number): string {
  const last = new Date(lastDate);
  switch (cadence) {
    case 'weekly': return addWeeks(last, 1).toISOString().split('T')[0];
    case 'monthly': return addMonths(last, 1).toISOString().split('T')[0];
    case 'yearly': return addYears(last, 1).toISOString().split('T')[0];
    default: return addDays(last, Math.round(avgInterval)).toISOString().split('T')[0];
  }
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------
function calcConfidence(occurrences: number, cadence: Cadence, intervalVariance: number): number {
  let score = 0;

  // More occurrences = higher confidence
  if (occurrences >= 6) score += 50;
  else if (occurrences >= 4) score += 40;
  else if (occurrences >= 3) score += 30;
  else score += 15;

  // Known cadence = higher confidence
  if (cadence !== 'unknown') score += 30;

  // Low interval variance = more predictable
  if (intervalVariance < 2) score += 20;
  else if (intervalVariance < 5) score += 10;

  return Math.min(score, 100);
}

function intervalVariance(intervals: number[]): number {
  if (intervals.length < 2) return 0;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------
interface DetectionGroup {
  merchantNormalized: string;
  merchantDisplay: string;
  transactions: { id: string; amount: number; dateISO: string; currency: string }[];
}

export async function scanAndSaveSubscriptions(): Promise<number> {
  const transactions = await getTransactions();
  const expenses = transactions.filter(tx => tx.type === 'Expense');

  if (expenses.length < 3) return 0;

  // Group by normalized merchant name
  const groups: Record<string, DetectionGroup> = {};

  for (const tx of expenses) {
    const raw = tx.note || tx.category;
    const norm = normalizeMerchant(raw);
    if (!norm) continue;

    if (!groups[norm]) {
      groups[norm] = {
        merchantNormalized: norm,
        merchantDisplay: displayMerchant(norm),
        transactions: [],
      };
    }
    groups[norm].transactions.push({
      id: tx.id,
      amount: tx.amount,
      dateISO: tx.dateISO,
      currency: (tx as Record<string, unknown>).currency as string || 'USD',
    });
  }

  // Clear old detected subscriptions (preserve user-confirmed/canceled status)
  const existing = await getSubscriptions();
  const userModified = new Set(
    existing
      .filter(s => s.status === 'confirmed' || s.status === 'canceled')
      .map(s => s.merchantNormalized)
  );

  let detected = 0;

  for (const group of Object.values(groups)) {
    // Skip user-modified subscriptions — don't overwrite
    if (userModified.has(group.merchantNormalized)) continue;

    const txs = group.transactions.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    if (txs.length < 2) continue;

    // Group by similar amounts (amount clustering)
    const amountClusters: typeof txs[] = [];
    for (const tx of txs) {
      const cluster = amountClusters.find(c => amountsMatch(c[0].amount, tx.amount));
      if (cluster) cluster.push(tx);
      else amountClusters.push([tx]);
    }

    for (const cluster of amountClusters) {
      if (cluster.length < 2) continue;

      const sorted = cluster.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(differenceInDays(new Date(sorted[i].dateISO), new Date(sorted[i - 1].dateISO)));
      }

      const cadence = detectCadence(intervals);
      if (cadence === 'unknown' && sorted.length < 4) continue; // not enough signal

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervalVariance(intervals);
      const confidence = calcConfidence(sorted.length, cadence, variance);

      const typicalAmount = sorted.reduce((sum, t) => sum + t.amount, 0) / sorted.length;
      const lastTx = sorted[sorted.length - 1];
      const nextExpected = predictNextDate(lastTx.dateISO, cadence, avgInterval);

      const status: Subscription['status'] = confidence >= 60 ? 'confirmed' : 'possible';

      const subId = `sub_${group.merchantNormalized.replace(/\s+/g, '_').toLowerCase()}_${Math.round(typicalAmount)}`;

      await upsertSubscription({
        id: subId,
        merchantDisplay: group.merchantDisplay,
        merchantNormalized: group.merchantNormalized,
        cadence,
        typicalAmount: Math.round(typicalAmount * 100) / 100,
        currency: sorted[0].currency,
        confidenceScore: confidence,
        lastChargedAt: lastTx.dateISO,
        nextExpectedAt: nextExpected,
        status,
        cancelUrl: null,
        cancelNotes: null,
        source: 'transaction',
      });

      // Save occurrences
      for (const tx of sorted) {
        await addSubscriptionOccurrence({
          subscriptionId: subId,
          transactionId: tx.id,
          chargedAt: tx.dateISO,
          amount: tx.amount,
        });
      }

      detected++;
    }
  }

  return detected;
}

// ---------------------------------------------------------------------------
// Upcoming charges (next N days)
// ---------------------------------------------------------------------------
export function getUpcomingCharges(
  subscriptions: Subscription[],
  withinDays: number = 30
): Subscription[] {
  const today = new Date();
  const cutoff = addDays(today, withinDays);
  return subscriptions
    .filter(s => s.status !== 'canceled' && s.nextExpectedAt)
    .filter(s => {
      const next = new Date(s.nextExpectedAt!);
      return next >= today && next <= cutoff;
    })
    .sort((a, b) => (a.nextExpectedAt ?? '').localeCompare(b.nextExpectedAt ?? ''));
}

// Total monthly cost of active subscriptions
export function monthlySubscriptionTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status !== 'canceled')
    .reduce((sum, s) => {
      if (s.cadence === 'monthly') return sum + s.typicalAmount;
      if (s.cadence === 'weekly') return sum + s.typicalAmount * 4.33;
      if (s.cadence === 'yearly') return sum + s.typicalAmount / 12;
      return sum + s.typicalAmount;
    }, 0);
}
