/**
 * Calendar helpers for the app's date model.
 *
 * Every transaction stores `dateISO` as a local YYYY-MM-DD string — the day the
 * user considers the purchase to have happened. Two rules follow from that, and
 * breaking either produces bugs that only appear in some timezones:
 *
 *   1. Never `new Date(dateISO)` to ask what month or day a transaction is in.
 *      That parses as UTC midnight, and the local getters then read it back in
 *      the device's zone — so 2026-08-01 reports as July for anyone west of
 *      UTC, and 2026-07-31 reports as August for anyone far enough east.
 *
 *   2. Never derive "today" via toISOString(). That yields the UTC date, which
 *      is already tomorrow for UTC+8 users after 16:00 local.
 *
 * So: format local dates with date-fns, and compare the resulting strings.
 * YYYY-MM-DD sorts lexicographically in calendar order, so `<`, `>` and `===`
 * are all correct on these strings and carry no timezone at all.
 */
import { format, startOfMonth, endOfMonth, subDays, addDays } from 'date-fns';

/** A local calendar date as YYYY-MM-DD. */
export type ISODate = string;

/** Format a Date as a local YYYY-MM-DD (never UTC). */
export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd');
}

/** Today, in the device's own timezone. */
export function todayISO(reference: Date = new Date()): ISODate {
  return toISODate(reference);
}

/** The YYYY-MM prefix of a date string — its month bucket. */
export function monthKey(dateISO: ISODate): string {
  return dateISO.slice(0, 7);
}

export function currentMonthKey(reference: Date = new Date()): string {
  return monthKey(todayISO(reference));
}

/** True when a transaction falls in the same calendar month as `reference`. */
export function isInCurrentMonth(dateISO: ISODate, reference: Date = new Date()): boolean {
  return monthKey(dateISO) === currentMonthKey(reference);
}

/** First and last day of `reference`'s month, inclusive. */
export function monthBounds(reference: Date = new Date()): { start: ISODate; end: ISODate } {
  return {
    start: toISODate(startOfMonth(reference)),
    end: toISODate(endOfMonth(reference)),
  };
}

/** The date `n` days before `reference`. */
export function daysAgoISO(n: number, reference: Date = new Date()): ISODate {
  return toISODate(subDays(reference, n));
}

/** The date `n` days after `reference`. */
export function daysAheadISO(n: number, reference: Date = new Date()): ISODate {
  return toISODate(addDays(reference, n));
}

/** Inclusive range check on YYYY-MM-DD strings. */
export function isBetween(dateISO: ISODate, startISO: ISODate, endISO: ISODate): boolean {
  return dateISO >= startISO && dateISO <= endISO;
}

/**
 * True when `dateISO` falls within the last `days` days, counting today.
 * `isWithinLastDays(d, 30)` spans today and the 29 days before it.
 */
export function isWithinLastDays(
  dateISO: ISODate,
  days: number,
  reference: Date = new Date()
): boolean {
  return isBetween(dateISO, daysAgoISO(days - 1, reference), todayISO(reference));
}

/** Number of days in `reference`'s month. */
export function daysInMonth(reference: Date = new Date()): number {
  return Number(toISODate(endOfMonth(reference)).slice(8, 10));
}

/** Day-of-month of `reference`, in local time. */
export function dayOfMonth(reference: Date = new Date()): number {
  return Number(todayISO(reference).slice(8, 10));
}

/** Whole days between two YYYY-MM-DD strings (b − a), timezone-free. */
export function daysBetween(aISO: ISODate, bISO: ISODate): number {
  const a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
  const b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
