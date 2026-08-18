/**
 * Date arithmetic for anything that repeats — bill reminders and recurring
 * transactions both live here so the two can never drift apart again.
 *
 * The rule the naive version got wrong: never mutate the day before clamping.
 * `setUTCMonth(getUTCMonth() + 1)` on 31 January asks for "31 February", which
 * JavaScript happily rolls forward to 3 March — the recurrence skips February
 * altogether. Compute the target month first, then clamp the day into it.
 */

/** Day-of-month a recurrence is anchored to, taken from its start date. */
export function anchorDayOf(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/** Last day of a given month (1-indexed month). */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isoOf(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().split("T")[0]!;
}

/**
 * Advance one month, clamping the day to the target month's length.
 *
 * `anchorDay` is the day the series is really on, so a monthly bill starting
 * the 31st lands on 28 February and then returns to 31 March rather than
 * drifting down to the 28th forever.
 */
export function advanceMonth(dateStr: string, anchorDay: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const nextMonthIndex = d.getUTCMonth() + 1;
  const targetYear = d.getUTCFullYear() + Math.floor(nextMonthIndex / 12);
  const targetMonth = nextMonthIndex % 12;
  const day = Math.min(anchorDay, lastDayOfMonth(targetYear, targetMonth));
  return isoOf(targetYear, targetMonth, day);
}

/**
 * Advance one year, clamping 29 February to the 28th in non-leap years.
 * setUTCFullYear(+1) would otherwise roll it to 1 March.
 */
export function advanceYear(dateStr: string, anchorDay: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const targetYear = d.getUTCFullYear() + 1;
  const targetMonth = d.getUTCMonth();
  const day = Math.min(anchorDay, lastDayOfMonth(targetYear, targetMonth));
  return isoOf(targetYear, targetMonth, day);
}

/** Advance a plain number of days — no clamping needed. */
export function advanceDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

/**
 * Next occurrence after `currentDate`.
 *
 * `anchorDay` should come from the series' start date, not from currentDate —
 * otherwise a February clamp permanently shortens every later month.
 */
export function computeNextDate(
  currentDate: string,
  frequency: string,
  anchorDay: number
): string {
  switch (frequency) {
    case "daily":
      return advanceDays(currentDate, 1);
    case "weekly":
      return advanceDays(currentDate, 7);
    case "biweekly":
      return advanceDays(currentDate, 14);
    case "yearly":
      return advanceYear(currentDate, anchorDay);
    case "monthly":
    default:
      return advanceMonth(currentDate, anchorDay);
  }
}
