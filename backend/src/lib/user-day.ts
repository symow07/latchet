/**
 * A user's "today": the calendar date where they are (Phase 5 decision 1).
 *
 * The phone reports its IANA time zone (PUT /me/timezone, stored on User), and
 * everything the server does "today" for one user is dated by that user's own
 * day: a recurring occurrence's id and dateISO, the series' lastCreated and
 * nextDate, and the day a bill reminder fires. With no zone (a phone that has
 * not reported yet, or a value this runtime no longer knows) the day is UTC's,
 * which is what every user got before.
 *
 * `now` is always passed in, never read here: the jobs and run-now take it
 * from the database's clock, so two instances whose clocks straddle midnight
 * still name one occurrence the same way (lib/distributed/clock.ts).
 *
 * Dependency-free. Intl is the runtime's own tz database (ICU), which is also
 * what validates a zone when it is stored, so a zone accepted on the way in
 * is one this function can use.
 */

/** No IANA zone is further ahead of UTC than this (Pacific/Kiritimati, UTC+14). */
export const MAX_UTC_OFFSET_MS = 14 * 60 * 60_000;

/** Longest zone name accepted; the longest IANA name is about 32 characters. */
export const MAX_TIME_ZONE_LENGTH = 64;

/**
 * Formats in the Gregorian calendar with Latin digits, whatever the runtime's
 * default locale: the parts are read back as numbers.
 */
const PARTS_LOCALE = "en-US-u-ca-gregory-nu-latn";

/**
 * The canonical spelling of an IANA time zone name ("asia/shanghai" →
 * "Asia/Shanghai"), or null when it is not one this runtime knows.
 *
 * Only names: an offset such as "+01:00" is refused even where Intl takes it,
 * because a fixed offset is wrong for half the year anywhere with summer time,
 * and the phone always has a name to send.
 */
export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_TIME_ZONE_LENGTH) return null;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(name)) return null;
  try {
    return new Intl.DateTimeFormat(PARTS_LOCALE, { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The UTC calendar date of an instant, YYYY-MM-DD. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The calendar date, YYYY-MM-DD, at instant `now` in `timeZone`; the UTC date
 * when the zone is null or not one this runtime knows.
 */
export function userToday(timeZone: string | null | undefined, now: Date): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat(PARTS_LOCALE, {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const day = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    } catch {
      // An unknown zone: fall through to UTC.
    }
  }
  return utcDay(now);
}

/**
 * The latest calendar date it is anywhere at `now`: the date at UTC+14. No
 * user's today is later, so a query for "due by today" across every user can
 * ask for "due by this" and leave the exact, per-user cut to userToday.
 */
export function latestToday(now: Date): string {
  return utcDay(new Date(now.getTime() + MAX_UTC_OFFSET_MS));
}

/**
 * The first instant of a YYYY-MM-DD date anywhere: its midnight at UTC+14.
 * In no zone does that date start earlier, so an instant before this one is
 * before the date began for every user, whatever their zone, then or now.
 */
export function earliestStartOf(dateISO: string): Date {
  return new Date(Date.parse(`${dateISO}T00:00:00Z`) - MAX_UTC_OFFSET_MS);
}
