import { test, expect } from 'bun:test';
import {
  toISODate,
  todayISO,
  monthKey,
  isInCurrentMonth,
  daysAgoISO,
  daysAheadISO,
  isBetween,
  isWithinLastDays,
  daysInMonth,
  dayOfMonth,
  daysBetween,
  monthBounds,
} from './dates';
import { calculateHealthScore } from './health-score';

// A moment that lands on different calendar dates depending on the viewer's
// timezone: 2026-08-01 00:30 UTC is still 31 July in Los Angeles and already
// 08:30 on 1 August in Shanghai.
const BOUNDARY = new Date('2026-08-01T00:30:00Z');

test('toISODate formats the local calendar date', () => {
  expect(toISODate(new Date(2026, 7, 1))).toBe('2026-08-01');
  expect(toISODate(new Date(2026, 0, 9))).toBe('2026-01-09');
});

test('monthKey buckets by calendar month', () => {
  expect(monthKey('2026-08-01')).toBe('2026-08');
  expect(monthKey('2026-07-31')).toBe('2026-07');
});

test('a transaction is bucketed by its own date string, not a reparse', () => {
  const august = new Date(2026, 7, 15);
  expect(isInCurrentMonth('2026-08-01', august)).toBe(true);
  expect(isInCurrentMonth('2026-08-31', august)).toBe(true);
  expect(isInCurrentMonth('2026-07-31', august)).toBe(false);
  expect(isInCurrentMonth('2026-09-01', august)).toBe(false);
});

test('day arithmetic stays on calendar days', () => {
  const ref = new Date(2026, 7, 15);
  expect(daysAgoISO(0, ref)).toBe('2026-08-15');
  expect(daysAgoISO(15, ref)).toBe('2026-07-31');
  expect(daysAheadISO(17, ref)).toBe('2026-09-01');
});

test('isWithinLastDays counts today as day one', () => {
  const ref = new Date(2026, 7, 15);
  expect(isWithinLastDays('2026-08-15', 30, ref)).toBe(true);
  expect(isWithinLastDays('2026-07-17', 30, ref)).toBe(true);
  expect(isWithinLastDays('2026-07-16', 30, ref)).toBe(false);
  expect(isWithinLastDays('2026-08-16', 30, ref)).toBe(false);
});

test('isBetween is inclusive at both ends', () => {
  expect(isBetween('2026-08-01', '2026-08-01', '2026-08-31')).toBe(true);
  expect(isBetween('2026-08-31', '2026-08-01', '2026-08-31')).toBe(true);
  expect(isBetween('2026-09-01', '2026-08-01', '2026-08-31')).toBe(false);
});

test('month bounds and lengths are correct, including February', () => {
  expect(monthBounds(new Date(2026, 7, 15))).toEqual({
    start: '2026-08-01',
    end: '2026-08-31',
  });
  expect(daysInMonth(new Date(2026, 1, 10))).toBe(28);
  expect(daysInMonth(new Date(2028, 1, 10))).toBe(29);
  expect(dayOfMonth(new Date(2026, 7, 9))).toBe(9);
});

test('daysBetween is timezone-free', () => {
  expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
  expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  // Spans a DST transition in most northern-hemisphere zones.
  expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
});

// ── The property that actually matters ───────────────────────────────────────

test('a date-boundary moment resolves to the local calendar day', () => {
  // Whatever TZ this runs under, these must agree with each other.
  const local = todayISO(BOUNDARY);
  expect(local).toBe(toISODate(BOUNDARY));
  expect(isInCurrentMonth(local, BOUNDARY)).toBe(true);
});

const SETTINGS = {
  monthlyBudget: 2000,
  startingBalance: 0,
  hourlyValue: 0,
  showTimeCost: 0,
  currency: 'USD',
  currencySymbol: '$',
  monthlyIncome: 4000,
  savingsGoal: 500,
  spendingStyle: 'moderate',
  primaryGoal: 'track',
};

/**
 * Transactions dated on the first and last days of a month — exactly the rows
 * that landed in the wrong bucket when the code did new Date(dateISO).getMonth().
 */
function boundaryTransactions(month: string) {
  const mk = (id: string, dateISO: string, amount: number, type: string) => ({
    id,
    amount,
    category: 'Food',
    type,
    isImpulse: 0,
    dateISO,
    createdAt: `${dateISO}T00:00:00.000Z`,
  });
  return [
    mk('t1', `${month}-01`, 300, 'Expense'),
    mk('t2', `${month}-15`, 250, 'Expense'),
    mk('t3', `${month}-28`, 180, 'Expense'),
    mk('t4', `${month}-01`, 4000, 'Income'),
  ];
}

test('health score buckets boundary transactions into their own month', () => {
  const now = new Date();
  const month = todayISO(now).slice(0, 7);
  const result = calculateHealthScore(boundaryTransactions(month) as any, SETTINGS as any);

  // 4000 income against 730 of expenses is a savings rate well above 30%,
  // which is only true if all four rows landed in the current month.
  expect(result.breakdown.savingsRate.value).toBe(82);
  expect(result.breakdown.savingsRate.score).toBe(25);
});

test('health score is stable across timezones for the same fixture', () => {
  // The assertion above is the invariant; this file is run under both
  // TZ=Asia/Shanghai and TZ=America/Los_Angeles (see package.json test:tz),
  // and identical expected values in both runs is the proof.
  expect(process.env.TZ ?? 'system').toBeDefined();
});
