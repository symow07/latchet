import { describe, expect, test } from 'bun:test';
import { billFromForm, billPaidChange, daysUntil, firstDueDate, shiftMonths, type BillPaidState } from './bills';

describe('bill dates', () => {
  test('a month on, or back, stays on the due day, clamped to short months', () => {
    expect(shiftMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(shiftMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(shiftMonths('2028-01-30', 1, 30)).toBe('2028-02-29');
    expect(shiftMonths('2026-12-15', 1, 15)).toBe('2027-01-15');
    expect(shiftMonths('2027-01-15', -1, 15)).toBe('2026-12-15');
    expect(shiftMonths('2026-03-31', -1, 31)).toBe('2026-02-28');
  });

  test('a new bill is first due on its day this month, or next month once that has passed', () => {
    expect(firstDueDate(20, '2026-10-11')).toBe('2026-10-20');
    expect(firstDueDate(11, '2026-10-11')).toBe('2026-10-11');
    expect(firstDueDate(5, '2026-10-11')).toBe('2026-11-05');
    // Due on the 31st, made in a 30-day month: the 30th, not 1 October.
    expect(firstDueDate(31, '2026-09-11')).toBe('2026-09-30');
    expect(firstDueDate(31, '2026-12-31')).toBe('2026-12-31');
    expect(firstDueDate(1, '2026-12-31')).toBe('2027-01-01');
  });

  test('days until a date count calendar days, whatever the clock says', () => {
    expect(daysUntil('2026-10-11', '2026-10-11')).toBe(0);
    expect(daysUntil('2026-10-12', '2026-10-11')).toBe(1);
    expect(daysUntil('2026-10-01', '2026-10-11')).toBe(-10);
    expect(daysUntil('2027-03-29', '2027-03-27')).toBe(2);
  });
});

describe('marking a bill paid', () => {
  const rent: BillPaidState = { isRecurring: true, isPaid: false, paidAt: null, dueDay: 31, nextDueDate: '2026-01-31' };
  const now = '2026-01-20T10:00:00.000Z';

  test('paying a recurring bill moves it on a month; paying it again changes nothing', () => {
    const paid = billPaidChange(rent, true, now);
    expect(paid).toEqual({ isPaid: true, paidAt: now, nextDueDate: '2026-02-28' });
    expect(billPaidChange({ ...rent, ...paid! }, true, now)).toBeNull();
  });

  test('paying, un-paying and paying again leaves it one month on, not three', () => {
    let bill: BillPaidState = rent;
    for (const paid of [true, false, true]) bill = { ...bill, ...billPaidChange(bill, paid, now)! };
    expect(bill).toMatchObject({ isPaid: true, nextDueDate: '2026-02-28' });
    const unpaid = billPaidChange(bill, false, now);
    expect(unpaid).toEqual({ isPaid: false, paidAt: null, nextDueDate: '2026-01-31' });
  });

  test('a one-off bill keeps its date', () => {
    const once = { ...rent, isRecurring: false };
    expect(billPaidChange(once, true, now)).toEqual({ isPaid: true, paidAt: now, nextDueDate: '2026-01-31' });
  });

  test('the form checks what the server would refuse', () => {
    expect(billFromForm({ name: ' Water ', amount: '20.5', dueDay: '12' }, '2026-10-11')).toEqual({
      ok: true,
      name: 'Water',
      amount: 20.5,
      dueDay: 12,
      nextDueDate: '2026-10-12',
    });
    expect(billFromForm({ name: '', amount: '1', dueDay: '1' }, '2026-10-11')).toEqual({ ok: false, error: 'billReminders.errName' });
    expect(billFromForm({ name: 'x', amount: '0', dueDay: '1' }, '2026-10-11')).toEqual({ ok: false, error: 'billReminders.errAmount' });
    expect(billFromForm({ name: 'x', amount: '1e9', dueDay: '1' }, '2026-10-11')).toEqual({ ok: false, error: 'common.amountTooLarge' });
    expect(billFromForm({ name: 'x', amount: '1', dueDay: '32' }, '2026-10-11')).toEqual({ ok: false, error: 'billReminders.errDueDay' });
    expect(billFromForm({ name: 'x', amount: '1', dueDay: '1.5' }, '2026-10-11')).toEqual({ ok: false, error: 'billReminders.errDueDay' });
  });
});
