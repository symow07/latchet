/**
 * Bill reminders, the logic of the screen and of db.ts's writes, with no
 * React, no SQLite and no clock of its own — so `bun test` holds it in every
 * timezone.
 *
 * Dates are the app's YYYY-MM-DD strings and all arithmetic here is on their
 * parts, never through a Date in the device's zone (dates.ts says why).
 */
import { MAX_AMOUNT } from './limits';

function parts(dateISO: string): { y: number; m: number; d: number } {
  return { y: Number(dateISO.slice(0, 4)), m: Number(dateISO.slice(5, 7)), d: Number(dateISO.slice(8, 10)) };
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days in a month (1-12). */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * `dateISO` moved by `months` (negative: back), on day `anchorDay` of the
 * target month, clamped to its length — the server's advanceMonth
 * (backend/src/lib/recurrence.ts) generalised to both directions. Anchored on
 * the bill's due day, so a bill due on the 31st falls on 28 February and
 * returns to 31 March, where adding a month to a Date would have skipped
 * February altogether.
 */
export function shiftMonths(dateISO: string, months: number, anchorDay: number): string {
  const { y, m } = parts(dateISO);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return iso(ty, tm, Math.min(Math.max(1, anchorDay), daysInMonth(ty, tm)));
}

/**
 * When a new bill is first due: its day this month if that has not passed,
 * else its day next month — clamped to the month's length, so a bill due on
 * the 31st created in September is due on the 30th, not on 1 October.
 */
export function firstDueDate(dueDay: number, todayISO: string): string {
  const { y, m } = parts(todayISO);
  const thisMonth = iso(y, m, Math.min(dueDay, daysInMonth(y, m)));
  return thisMonth >= todayISO ? thisMonth : shiftMonths(todayISO, 1, dueDay);
}

/** Whole days from today to `dateISO`: negative when overdue. */
export function daysUntil(dateISO: string, todayISO: string): number {
  const a = parts(todayISO);
  const b = parts(dateISO);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** The fields of a bill that paying it changes. */
export interface BillPaidState {
  isRecurring: boolean;
  isPaid: boolean;
  paidAt: string | null;
  dueDay: number;
  nextDueDate: string;
}

/**
 * Marking a bill paid or unpaid. Null when it already is what was asked: a
 * second tap on a row drawn before the first one landed (or before a pull
 * brought another device's payment) changes nothing, rather than toggling
 * the bill back or paying it twice.
 *
 * Paying a recurring bill moves it on a month, as the screen always has, and
 * the server's notifier re-arms for the new date (it re-arms on a later date
 * only). Un-paying it moves it back the same month, so paying, un-paying and
 * paying again — a slip of the finger, offline or not — leaves it one month
 * on, not three, and a bill un-paid by mistake is due again on the date it
 * really is. A one-off bill keeps its date either way.
 */
export function billPaidChange(
  bill: BillPaidState,
  paid: boolean,
  nowISO: string,
): { isPaid: boolean; paidAt: string | null; nextDueDate: string } | null {
  if (bill.isPaid === paid) return null;
  const step = bill.isRecurring ? (paid ? 1 : -1) : 0;
  return {
    isPaid: paid,
    paidAt: paid ? nowISO : null,
    nextDueDate: step === 0 ? bill.nextDueDate : shiftMonths(bill.nextDueDate, step, bill.dueDay),
  };
}

export interface BillForm {
  name: string;
  amount: string;
  dueDay: string;
}

/** A new bill's input, or the locale key of what is wrong with the form. */
export function billFromForm(
  form: BillForm,
  todayISO: string,
): { ok: true; name: string; amount: number; dueDay: number; nextDueDate: string } | { ok: false; error: string } {
  const name = form.name.trim();
  if (!name) return { ok: false, error: 'billReminders.errName' };
  const amount = parseFloat(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'billReminders.errAmount' };
  if (amount > MAX_AMOUNT) return { ok: false, error: 'common.amountTooLarge' };
  const dueDay = Number(form.dueDay.trim());
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return { ok: false, error: 'billReminders.errDueDay' };
  return { ok: true, name, amount, dueDay, nextDueDate: firstDueDate(dueDay, todayISO) };
}
