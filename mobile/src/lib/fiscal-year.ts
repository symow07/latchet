/**
 * Month names for the fiscal-year picker, in the app's language.
 *
 * Built from Intl rather than a hardcoded list so it follows the locale like
 * everything else, and resolved on call — a module-scope array would freeze
 * whatever language the app started in.
 */
import { getIntlTag } from './i18n/core';

export function monthNames(): string[] {
  const formatter = new Intl.DateTimeFormat(getIntlTag(), { month: 'long' });
  // 2021 is arbitrary; any non-leap year gives twelve valid months, and the
  // day is fixed at the 1st so no month can roll into the next one.
  return Array.from({ length: 12 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2021, i, 1))),
  );
}

/** "not set" is stored as null; the picker sends 0 to mean cleared. */
export function normaliseFiscalMonth(value: number | null): number | null {
  return value && value >= 1 && value <= 12 ? value : null;
}
