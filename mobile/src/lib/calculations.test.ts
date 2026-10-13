import { describe, test, expect } from 'bun:test';
import {
  calculateDisciplineGrade,
  calculateImpulsePercentage,
  calculateLastWeekSpent,
  calculateLoggingStreak,
  calculateWeekSpent,
  getDailySpendingData,
  getUnlockedBadges,
} from './calculations';
import { daysAgoISO, daysAheadISO } from './dates';
import type { Transaction } from './transaction';

// Saturday 15 August 2026, local noon.
const NOW = new Date(2026, 7, 15, 12, 0, 0);
const ago = (n: number) => daysAgoISO(n, NOW);

let seq = 0;
function tx(dateISO: string, amount = 10, over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `calc${seq}`,
    amount,
    category: 'Food',
    type: 'Expense',
    isImpulse: false,
    note: null,
    dateISO,
    createdAt: `${dateISO}T12:00:00.000Z`,
    accountId: null,
    currency: 'USD',
    ...over,
  };
}

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

describe('behaviour detection: impulse share', () => {
  test("is the rounded share of the last 30 days' expenses marked impulse, by count", () => {
    expect(calculateImpulsePercentage([], NOW)).toBe(0);
    const three = [tx(ago(0), 1, { isImpulse: true }), tx(ago(1), 999), tx(ago(29), 50)];
    expect(calculateImpulsePercentage(three, NOW)).toBe(33);
    expect(calculateImpulsePercentage([...three, tx(ago(2), 5, { isImpulse: true })], NOW)).toBe(50);
    expect(
      calculateImpulsePercentage([tx(ago(3), 5, { isImpulse: true }), tx(ago(4), 5, { isImpulse: true }), tx(ago(5))], NOW)
    ).toBe(67);
  });

  test('ignores income, expenses older than 30 days and future-dated ones', () => {
    const txs = [
      tx(ago(3)),
      tx(ago(30), 10, { isImpulse: true }),
      tx(ago(1), 10, { type: 'Income', isImpulse: true }),
      tx(daysAheadISO(2, NOW), 10, { isImpulse: true }),
    ];
    expect(calculateImpulsePercentage(txs, NOW)).toBe(0);
  });
});

describe('behaviour detection: discipline grade', () => {
  test('grades the share of the monthly budget spent', () => {
    const cases: [spent: number, grade: ReturnType<typeof calculateDisciplineGrade>][] = [
      [0, 'A'],
      [700, 'A'],
      [701, 'B'],
      [850, 'B'],
      [851, 'C'],
      [1000, 'C'],
      [1001, 'D'],
      [1150, 'D'],
      [1151, 'F'],
      [5000, 'F'],
    ];
    for (const [spent, grade] of cases) {
      expect([spent, calculateDisciplineGrade(1000, spent)]).toEqual([spent, grade]);
    }
  });

  test('is a neutral C with no budget, or a negative one', () => {
    expect(calculateDisciplineGrade(0, 500)).toBe('C');
    expect(calculateDisciplineGrade(0, 0)).toBe('C');
    // A negative budget made every spend a negative ratio, so an A.
    expect(calculateDisciplineGrade(-1000, 500)).toBe('C');
  });
});

describe('behaviour detection: logging streak', () => {
  test('counts consecutive logged days back from today', () => {
    expect(calculateLoggingStreak([], NOW)).toBe(0);
    expect(calculateLoggingStreak([tx(ago(0))], NOW)).toBe(1);
    expect(calculateLoggingStreak([tx('2026-08-15'), tx('2026-08-14'), tx('2026-08-13')], NOW)).toBe(3);
  });

  test('a gap of a day ends the streak', () => {
    expect(
      calculateLoggingStreak([tx('2026-08-15'), tx('2026-08-14'), tx('2026-08-12'), tx('2026-08-11')], NOW)
    ).toBe(2);
  });

  test("today not logged yet keeps yesterday's streak; yesterday missing ends it", () => {
    expect(calculateLoggingStreak([tx('2026-08-14'), tx('2026-08-13')], NOW)).toBe(2);
    expect(calculateLoggingStreak([tx('2026-08-13'), tx('2026-08-12')], NOW)).toBe(0);
  });

  test('several entries a day count once; income counts; future-dated entries do not', () => {
    const txs = [
      tx('2026-08-15'),
      tx('2026-08-15'),
      tx('2026-08-14', 2000, { type: 'Income' }),
      tx('2026-08-17'),
    ];
    expect(calculateLoggingStreak(txs, NOW)).toBe(2);
  });

  test('walks calendar days across month and year ends and DST changes', () => {
    // US clocks went forward on 8 March 2026 and go back on 1 November 2026.
    for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
      inTimeZone(zone, () => {
        const march = new Date(2026, 2, 9, 0, 30);
        const marchDays = ['2026-03-09', '2026-03-08', '2026-03-07', '2026-03-06', '2026-03-05'];
        expect([zone, calculateLoggingStreak(marchDays.map((d) => tx(d)), march)]).toEqual([zone, 5]);

        const november = new Date(2026, 10, 2, 23, 59);
        const novemberDays = ['2026-11-02', '2026-11-01', '2026-10-31', '2026-10-30'];
        expect([zone, calculateLoggingStreak(novemberDays.map((d) => tx(d)), november)]).toEqual([zone, 4]);

        const newYear = new Date(2027, 0, 1, 0, 10);
        const yearEnd = ['2027-01-01', '2026-12-31', '2026-12-30'];
        expect([zone, calculateLoggingStreak(yearEnd.map((d) => tx(d)), newYear)]).toEqual([zone, 3]);
      });
    }
  });

  test('looks back at most a year', () => {
    const everyDay = Array.from({ length: 400 }, (_, i) => tx(ago(i)));
    expect(calculateLoggingStreak(everyDay, NOW)).toBe(365);
  });
});

describe('behaviour detection: week spend', () => {
  test('this week is today and the six days before; last week the seven before that', () => {
    const txs = [
      tx('2026-08-15', 1),
      tx('2026-08-09', 2), // 6 days ago
      tx('2026-08-08', 4), // 7 days ago
      tx('2026-08-02', 8), // 13 days ago
      tx('2026-08-01', 16), // 14 days ago: neither
      tx('2026-08-16', 32), // tomorrow: neither
      tx('2026-08-13', 64, { type: 'Income' }),
    ];
    expect(calculateWeekSpent(txs, NOW)).toBe(3);
    expect(calculateLastWeekSpent(txs, NOW)).toBe(12);
  });

  test('the two windows meet without overlap across a month boundary', () => {
    const third = new Date(2026, 7, 3, 8, 0, 0);
    const txs = [
      tx('2026-08-03', 1),
      tx('2026-07-28', 2), // first day of this week
      tx('2026-07-27', 4), // last day of last week
      tx('2026-07-21', 8), // first day of last week
      tx('2026-07-20', 16),
    ];
    expect(calculateWeekSpent(txs, third)).toBe(3);
    expect(calculateLastWeekSpent(txs, third)).toBe(12);
    expect(calculateWeekSpent([], third)).toBe(0);
    expect(calculateLastWeekSpent([], third)).toBe(0);
  });
});

describe('behaviour detection: daily spending series', () => {
  test('is fourteen days, oldest first, zero-filled and summed per day', () => {
    const series = getDailySpendingData(
      [
        tx('2026-08-15', 5),
        tx('2026-08-15', 7),
        tx('2026-08-02', 3),
        tx('2026-08-01', 100), // 14 days ago: outside
        tx('2026-08-10', 50, { type: 'Income' }),
      ],
      NOW
    );
    expect(series.map((d) => d.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => `2026-08-${String(2 + i).padStart(2, '0')}`)
    );
    expect(series[0]).toEqual({ date: '2026-08-02', amount: 3 });
    expect(series[13]).toEqual({ date: '2026-08-15', amount: 12 });
    expect(series.filter((d) => d.amount === 0)).toHaveLength(12);
  });

  test('crosses a short month on calendar days', () => {
    const march1 = new Date(2026, 2, 1, 9, 0, 0);
    const series = getDailySpendingData([tx('2026-02-28', 4)], march1);
    expect(series.map((d) => d.date)).toEqual([
      ...Array.from({ length: 13 }, (_, i) => `2026-02-${String(16 + i)}`),
      '2026-03-01',
    ]);
    expect(series[12]).toEqual({ date: '2026-02-28', amount: 4 });
  });

  test('a future-dated expense does not add a fifteenth day', () => {
    const series = getDailySpendingData([tx('2026-08-15', 5), tx('2026-08-20', 40)], NOW);
    expect(series).toHaveLength(14);
    expect(series[13]).toEqual({ date: '2026-08-15', amount: 5 });
  });
});

describe('month badges', () => {
  const today = daysAgoISO(0);
  test('an empty month earns nothing', () => {
    expect(getUnlockedBadges([], 0, 0, 0)).not.toContain('No Subscriptions');
  });
  test('spending this month with no subscription charge earns it', () => {
    expect(getUnlockedBadges([tx(today, 12, { category: 'Food' })], 0, 12, 0)).toContain('No Subscriptions');
  });
  test('a subscription charge this month withholds it', () => {
    const txs = [tx(today, 12, { category: 'Food' }), tx(today, 15.49, { category: 'Subscriptions' })];
    expect(getUnlockedBadges(txs, 0, 27.49, 0)).not.toContain('No Subscriptions');
  });
});

test('month badges: Budget Master needs spending this month, under the budget', () => {
  const today = daysAgoISO(0);
  expect(getUnlockedBadges([], 0, 0, 1000)).not.toContain('Budget Master');
  expect(getUnlockedBadges([tx(today, 40)], 0, 40, 1000)).toContain('Budget Master');
  expect(getUnlockedBadges([tx(today, 1200)], 0, 1200, 1000)).not.toContain('Budget Master');
});

