/**
 * The one subscription detector.
 *
 * Pure and dependency-free: it takes a normalised charge stream and returns
 * detections. Persistence, data fetching and the cancel directory all live
 * outside it, so the same logic serves the personal ledger, business expenses
 * and email-scanned receipts instead of three separate approximations.
 */
import type {
  Cadence,
  DetectedSubscription,
  DetectionOptions,
  SourceCharge,
} from './types';

// ── Merchant normalisation ───────────────────────────────────────────────────

const NOISE_TOKENS = new Set([
  'pos', 'payment', 'online', 'purchase', 'debit', 'credit', 'card',
  'transaction', 'transfer', 'charge', 'fee', 'refund', 'sale',
  'checkcard', 'recurring', 'autopay', 'auto', 'pay', 'bill', 'billing',
  'www', 'com', 'net', 'org', 'inc', 'llc', 'ltd',
]);

export function normalizeMerchant(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[*/\-_.,#@!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 1 && !NOISE_TOKENS.has(token.toLowerCase()))
    .slice(0, 3)
    .join(' ');
}

/** Display-friendly name (title case). */
export function displayMerchant(normalized: string): string {
  return normalized
    .split(' ')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Stable identifiers ───────────────────────────────────────────────────────

/**
 * Identity is the merchant, nothing else.
 *
 * The amount used to be baked in, so Netflix going from £10.99 to £12.99
 * produced a second subscription rather than updating the first — the user saw
 * both, and the old one never expired.
 */
export function subscriptionId(merchantNormalized: string): string {
  return `sub_${merchantNormalized.replace(/\s+/g, '_').toLowerCase()}`;
}

/**
 * Deterministic, so re-scanning cannot duplicate an occurrence.
 *
 * These ids used to be random, which meant the INSERT OR IGNORE guarding them
 * had nothing to collide with: every scan appended the same charges again.
 */
export function occurrenceId(subId: string, chargeId: string): string {
  return `socc_${subId}_${chargeId}`;
}

// ── Cadence and confidence ───────────────────────────────────────────────────

/** Whole days between two YYYY-MM-DD strings — no timezone involved. */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
  const b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function detectCadence(intervals: number[]): Cadence {
  if (intervals.length === 0) return 'unknown';
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avg >= 5 && avg <= 10) return 'weekly';
  if (avg >= 25 && avg <= 38) return 'monthly';
  if (avg >= 330 && avg <= 400) return 'yearly';
  return 'unknown';
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0]!;
}

/** Next charge date. Month and year steps clamp, so a 31st never skips. */
export function predictNextDate(
  lastDateISO: string,
  cadence: Cadence,
  avgInterval: number
): string {
  const d = new Date(lastDateISO + 'T00:00:00Z');
  const anchorDay = d.getUTCDate();

  const clampedStep = (monthsAhead: number): string => {
    const target = d.getUTCMonth() + monthsAhead;
    const year = d.getUTCFullYear() + Math.floor(target / 12);
    const month = ((target % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay)))
      .toISOString()
      .split('T')[0]!;
  };

  switch (cadence) {
    case 'weekly':
      return addDaysISO(lastDateISO, 7);
    case 'monthly':
      return clampedStep(1);
    case 'yearly':
      return clampedStep(12);
    default:
      return addDaysISO(lastDateISO, Math.max(1, Math.round(avgInterval)));
  }
}

export function intervalStdDev(intervals: number[]): number {
  if (intervals.length < 2) return 0;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  return Math.sqrt(variance);
}

export function calcConfidence(
  occurrences: number,
  cadence: Cadence,
  stdDev: number
): number {
  let score = 0;
  if (occurrences >= 6) score += 50;
  else if (occurrences >= 4) score += 40;
  else if (occurrences >= 3) score += 30;
  else score += 15;

  if (cadence !== 'unknown') score += 30;

  if (stdDev < 2) score += 20;
  else if (stdDev < 5) score += 10;

  return Math.min(score, 100);
}

// ── Detection ────────────────────────────────────────────────────────────────

/** ±10% or ±0.50, whichever is larger — covers FX drift and small price moves. */
function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, a * 0.1);
}

export const DEFAULT_MIN_OCCURRENCES = 2;
export const DEFAULT_CONFIRM_AT = 60;

export function detectSubscriptions(
  charges: SourceCharge[],
  options: DetectionOptions = {}
): DetectedSubscription[] {
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const confirmAt = options.confirmAt ?? DEFAULT_CONFIRM_AT;

  // Group by normalised merchant. A charge with no usable merchant text is
  // skipped rather than bucketed under something else.
  const groups = new Map<string, SourceCharge[]>();
  for (const charge of charges) {
    const norm = normalizeMerchant(charge.merchant);
    if (!norm) continue;
    const group = groups.get(norm);
    if (group) group.push(charge);
    else groups.set(norm, [charge]);
  }

  const detections: DetectedSubscription[] = [];

  for (const [merchantNormalized, group] of groups) {
    const sortedGroup = [...group].sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    // A merchant can hold more than one subscription at different prices.
    //
    // Each charge is compared against the *most recent* charge already in the
    // cluster, not the first: subscriptions drift upward a little at a time, and
    // anchoring on the first charge meant a service that raised its price twice
    // fragmented into separate entries even though nothing had changed.
    const clusters: SourceCharge[][] = [];
    for (const charge of sortedGroup) {
      const cluster = clusters.find((c) =>
        amountsMatch(c[c.length - 1]!.amount, charge.amount)
      );
      if (cluster) cluster.push(charge);
      else clusters.push([charge]);
    }

    for (const cluster of clusters) {
      if (cluster.length < minOccurrences) continue;

      const intervals: number[] = [];
      for (let i = 1; i < cluster.length; i++) {
        intervals.push(daysBetween(cluster[i - 1]!.dateISO, cluster[i]!.dateISO));
      }

      const cadence = detectCadence(intervals);
      // An irregular pattern needs more evidence before it counts.
      if (cadence === 'unknown' && cluster.length < 4) continue;

      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
      const confidence = calcConfidence(cluster.length, cadence, intervalStdDev(intervals));
      const typicalAmount =
        cluster.reduce((sum, c) => sum + c.amount, 0) / cluster.length;
      const totalSpent = cluster.reduce((sum, c) => sum + c.amount, 0);
      const last = cluster[cluster.length - 1]!;

      // Most common category in the cluster, for display only — grouping is
      // always by merchant.
      const categoryCounts = new Map<string, number>();
      for (const c of cluster) {
        if (!c.category) continue;
        categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
      }
      const category =
        [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other';

      detections.push({
        id: subscriptionId(merchantNormalized),
        merchantDisplay: displayMerchant(merchantNormalized),
        merchantNormalized,
        cadence,
        typicalAmount: Math.round(typicalAmount * 100) / 100,
        currency: cluster[0]!.currency,
        confidenceScore: confidence,
        lastChargedAt: last.dateISO,
        nextExpectedAt: predictNextDate(last.dateISO, cadence, avgInterval),
        status: confidence >= confirmAt ? 'confirmed' : 'possible',
        source: cluster[0]!.source,
        category,
        totalSpent: Math.round(totalSpent * 100) / 100,
        occurrences: cluster.map((c) => ({
          chargeId: c.id,
          dateISO: c.dateISO,
          amount: c.amount,
        })),
      });
    }
  }

  // Most expensive first — that is the order a user cares about.
  return detections.sort((a, b) => b.typicalAmount - a.typicalAmount);
}

/** Total monthly cost, normalising weekly and yearly cadences. */
export function monthlyCost(subs: DetectedSubscription[]): number {
  return subs.reduce((sum, s) => {
    if (s.cadence === 'monthly') return sum + s.typicalAmount;
    if (s.cadence === 'weekly') return sum + s.typicalAmount * (365 / 12 / 7);
    if (s.cadence === 'yearly') return sum + s.typicalAmount / 12;
    return sum;
  }, 0);
}
