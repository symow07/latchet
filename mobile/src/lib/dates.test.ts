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
import type { Transaction } from './transaction';

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
  const mk = (id: string, dateISO: string, amount: number, type: Transaction['type']): Transaction => ({
    id,
    amount,
    category: 'Food',
    type,
    isImpulse: false,
    note: null,
    dateISO,
    createdAt: `${dateISO}T00:00:00.000Z`,
    accountId: null,
    currency: 'USD',
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
  const result = calculateHealthScore(boundaryTransactions(month), SETTINGS as any, now);

  // 4000 income against 730 of expenses is a savings rate well above 30%,
  // which is only true if all four rows landed in the current month.
  expect(result.breakdown.savingsRate.value).toBe(82);
  expect(result.breakdown.savingsRate.score).toBe(25);
});

/** Run `fn` with the process in `zone`, then put the previous zone back. */
function inTimeZone<T>(zone: string, fn: () => T): T {
  const previous = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = previous;
  }
}

test('health score is identical for the same local moment in every timezone', () => {
  // The first half hour of August, local time, from UTC+14 to UTC-11. A UTC
  // reparse of '2026-08-01' lands in July west of Greenwich, and July's rows
  // are here to be wrongly picked up.
  const zones = ['Asia/Shanghai', 'America/Los_Angeles', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const txs = [...boundaryTransactions('2026-07'), ...boundaryTransactions('2026-08')];
  const results = zones.map((zone) =>
    inTimeZone(zone, () => calculateHealthScore(txs, SETTINGS as any, new Date(2026, 7, 1, 0, 30)))
  );
  for (const r of results) expect(r).toEqual(results[0]!);
  expect(results[0]!.breakdown.savingsRate).toEqual({ score: 25, value: 82, maxPoints: 25 });
  // 730 of a 2000 budget on day 1 of 31 is ahead of pace but inside the budget.
  expect(results[0]!.breakdown.budgetDiscipline.score).toBe(12);
});
