import { test, expect } from 'bun:test';
import {
  projectMonthlyExpenses,
  calculateAverageDailySpend,
  calculateSurvivalDays,
  getHistorySpanDays,
  hasEnoughHistory,
  MIN_HISTORY_DAYS,
} from './calculations';
import { daysAgoISO, todayISO } from './dates';

const expense = (dateISO: string, amount: number) => ({
  id: `t_${dateISO}_${amount}`,
  amount,
  category: 'Food',
  type: 'Expense' as const,
  isImpulse: 0,
  dateISO,
  createdAt: `${dateISO}T00:00:00.000Z`,
});

// ── Monthly projection ───────────────────────────────────────────────────────

test('a single purchase on the 1st does not imply a catastrophic month', () => {
  // Naive scaling gave 200 / 1 * 30 = 6000 and drove the advisor to discuss a
  // crisis that did not exist.
  const projected = projectMonthlyExpenses({
    currentMonthExpenses: 200,
    dayOfMonth: 1,
    daysInMonth: 30,
    previousMonthExpenses: 2000,
  });

  expect(projected).toBeLessThan(2500);
  expect(projected).toBeGreaterThan(1800);
});

test('with no prior month, the run rate is used as-is', () => {
  expect(
    projectMonthlyExpenses({
      currentMonthExpenses: 600,
      dayOfMonth: 15,
      daysInMonth: 30,
      previousMonthExpenses: 0,
    })
  ).toBe(1200);
});

test('two weeks in, the current month stands on its own', () => {
  // currentWeight hits 1 at day 14, so last month no longer contributes.
  expect(
    projectMonthlyExpenses({
      currentMonthExpenses: 700,
      dayOfMonth: 14,
      daysInMonth: 28,
      previousMonthExpenses: 5000,
    })
  ).toBe(1400);
});

test('the prior month dominates on day one and fades out', () => {
  // 100 spent by day 1 scales to a 3000 run rate; last month was 2000.
  const args = { currentMonthExpenses: 100, daysInMonth: 30, previousMonthExpenses: 2000 };
  const day1 = projectMonthlyExpenses({ ...args, dayOfMonth: 1 });
  const day7 = projectMonthlyExpenses({ ...args, dayOfMonth: 7 });

  // Day 1 sits close to last month's actual rather than the wild run rate...
  expect(day1).toBeGreaterThan(1900);
  expect(day1).toBeLessThan(2200);
  // ...and by day 7 the genuinely low spending has pulled the estimate down.
  expect(day7).toBeLessThan(day1);
});

test('day zero is treated as day one rather than dividing by zero', () => {
  expect(
    Number.isFinite(
      projectMonthlyExpenses({
        currentMonthExpenses: 50,
        dayOfMonth: 0,
        daysInMonth: 31,
        previousMonthExpenses: 0,
      })
    )
  ).toBe(true);
});

// ── History span and daily average ───────────────────────────────────────────

test('history span reflects real elapsed days, not a flat 30', () => {
  const txs = [expense(daysAgoISO(1), 30), expense(todayISO(), 30)];
  expect(getHistorySpanDays(txs)).toBe(2);
});

test('history span is capped at the window', () => {
  const txs = [expense(daysAgoISO(90), 10), expense(todayISO(), 10)];
  expect(getHistorySpanDays(txs, 30)).toBe(30);
});

test('a two-day-old account reports its real daily rate', () => {
  // $60 over two days is $30/day. Dividing by a constant 30 reported $2/day,
  // which made calculateSurvivalDays claim roughly two years of runway.
  const txs = [expense(daysAgoISO(1), 30), expense(todayISO(), 30)];

  expect(calculateAverageDailySpend(txs)).toBe(30);
  expect(calculateSurvivalDays(600, calculateAverageDailySpend(txs))).toBe(20);
});

test('a young account is flagged as having too little history', () => {
  const young = [expense(daysAgoISO(1), 30), expense(todayISO(), 30)];
  expect(hasEnoughHistory(young)).toBe(false);

  const mature = [expense(daysAgoISO(MIN_HISTORY_DAYS - 1), 30), expense(todayISO(), 30)];
  expect(hasEnoughHistory(mature)).toBe(true);
});

test('no transactions means no history and no runway', () => {
  expect(getHistorySpanDays([])).toBe(0);
  expect(hasEnoughHistory([])).toBe(false);
  expect(calculateAverageDailySpend([])).toBe(0);
});

// ── Survival days ────────────────────────────────────────────────────────────

test('survival days is null when nothing is being spent', () => {
  // Previously returned Infinity, which the dashboard's `=== 999` check missed,
  // so the card rendered the literal text "Infinity days".
  expect(calculateSurvivalDays(1000, 0)).toBeNull();
  expect(calculateSurvivalDays(1000, Infinity)).toBeNull();
});

test('survival days floors to whole days', () => {
  expect(calculateSurvivalDays(100, 30)).toBe(3);
});

test('an overdrawn balance has no runway left', () => {
  expect(calculateSurvivalDays(-50, 30)).toBe(0);
});
