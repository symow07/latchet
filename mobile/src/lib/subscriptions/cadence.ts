/**
 * Calendar arithmetic and billing cadences.
 *
 * Every date is a YYYY-MM-DD string and every calculation is done on its
 * parts in UTC, so nothing here depends on the device's timezone (the suite
 * runs under Shanghai, Los Angeles and UTC).
 */
import type { Cadence } from './types';

export type KnownCadence = Exclude<Cadence, 'unknown'>;

/** Average length of each cadence, in days. */
export const PERIOD_DAYS: Readonly<Record<KnownCadence, number>> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  semiannual: 182.62,
  yearly: 365.25,
};

/**
 * The intervals (in days, inclusive) that read as each cadence. Wide enough
 * for weekends, bank holidays and posting lag (a monthly charge lands 26 to
 * 35 days after the last one), with gaps between them so that, say, every
 * 20 days is not mistaken for anything.
 */
export const CADENCE_WINDOWS: readonly (readonly [KnownCadence, number, number])[] = [
  ['weekly', 5, 9],
  ['biweekly', 12, 17],
  ['monthly', 25, 36],
  ['quarterly', 80, 101],
  ['semiannual', 165, 200],
  ['yearly', 340, 390],
];

/** How long past a missed charge a subscription is still given before it reads as ended. */
export const GRACE_DAYS: Readonly<Record<KnownCadence, number>> = {
  weekly: 14,
  biweekly: 21,
  monthly: 30,
  quarterly: 45,
  semiannual: 60,
  yearly: 60,
};

/** Rank, shortest first, so callers can ask "monthly or longer". */
export const CADENCE_RANK: Readonly<Record<Cadence, number>> = {
  weekly: 1,
  biweekly: 2,
  monthly: 3,
  quarterly: 4,
  semiannual: 5,
  yearly: 6,
  unknown: 0,
};

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parts(value);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function parts(dateISO: string): [number, number, number] {
  return [+dateISO.slice(0, 4), +dateISO.slice(5, 7), +dateISO.slice(8, 10)];
}

function toISO(t: Date): string {
  return t.toISOString().slice(0, 10);
}

/** Whole days from a to b (negative when b is earlier) — no timezone involved. */
export function daysBetween(aISO: string, bISO: string): number {
  const [ay, am, ad] = parts(aISO);
  const [by, bm, bd] = parts(bISO);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = parts(dateISO);
  return toISO(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Months ahead on a given day of the month, clamped to the month's last day (31 Jan → 28 Feb). */
export function addMonthsISO(dateISO: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parts(dateISO);
  const target = m - 1 + months;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(year, month, Math.min(anchorDay ?? d, lastDay))));
}

export function minISO(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxISO(a: string, b: string): string {
  return a >= b ? a : b;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The cadence an interval (in days) reads as, or 'unknown' between the windows. */
export function cadenceOfInterval(days: number): Cadence {
  for (const [cadence, lo, hi] of CADENCE_WINDOWS) {
    if (days >= lo && days <= hi) return cadence;
  }
  return 'unknown';
}

export function cadenceWindow(cadence: KnownCadence): readonly [number, number] {
  const w = CADENCE_WINDOWS.find(([c]) => c === cadence)!;
  return [w[1], w[2]];
}

/** The cadence of a run of intervals, read from their median. */
export function detectCadence(intervals: number[]): Cadence {
  if (intervals.length === 0) return 'unknown';
  return cadenceOfInterval(median(intervals));
}

/**
 * The next charge after `lastDateISO`.
 *
 * Month-based cadences step calendar months on `anchorDay` (the day the plan
 * bills on, default the last charge's day) and clamp, so a plan billed on the
 * 31st lands on 28 February and comes back to the 31st in March. Unknown
 * cadences step the average interval.
 */
export function predictNextDate(
  lastDateISO: string,
  cadence: Cadence,
  avgInterval: number,
  anchorDay?: number
): string {
  switch (cadence) {
    case 'weekly':
      return addDaysISO(lastDateISO, 7);
    case 'biweekly':
      return addDaysISO(lastDateISO, 14);
    case 'monthly':
      return addMonthsISO(lastDateISO, 1, anchorDay);
    case 'quarterly':
      return addMonthsISO(lastDateISO, 3, anchorDay);
    case 'semiannual':
      return addMonthsISO(lastDateISO, 6, anchorDay);
    case 'yearly':
      return addMonthsISO(lastDateISO, 12, anchorDay);
    default:
      return addDaysISO(lastDateISO, Math.max(1, Math.round(avgInterval)));
  }
}

/** What one charge at this cadence costs per month; nothing for an irregular one. */
export function monthlyFactor(cadence: string): number {
  switch (cadence) {
    case 'weekly':
      return 365 / 12 / 7;
    case 'biweekly':
      return 365 / 12 / 14;
    case 'monthly':
      return 1;
    case 'quarterly':
      return 1 / 3;
    case 'semiannual':
      return 1 / 6;
    case 'yearly':
      return 1 / 12;
    default:
      return 0;
  }
}

/** Total monthly cost of a set of subscriptions, whatever their cadences. */
export function monthlyCost(subs: readonly { cadence: string; typicalAmount: number }[]): number {
  return subs.reduce((sum, s) => sum + s.typicalAmount * monthlyFactor(s.cadence), 0);
}
