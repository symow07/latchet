import { describe, test, expect } from 'bun:test';
import {
  analyzeSpendingPatterns,
  detectDuplicateCharges,
  detectUnusualTransactions,
  generateAnalyticsSummary,
  getTopWasteCategories,
} from './behavior-detection';
import { projectMonthlyExpenses } from './calculations';
import { categoryLabel } from './category-meta';
import { daysAgoISO } from './dates';
import { t } from './i18n/core';
import type { Transaction } from './transaction';

// Saturday 15 August 2026, local noon. The 30 days ending today run from
// Friday 17 July and hold 9 weekend days and 21 weekdays.
const NOW = new Date(2026, 7, 15, 12, 0, 0);
const ago = (n: number) => daysAgoISO(n, NOW);

let seq = 0;
function tx(dateISO: string, amount: number, over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `bd${seq}`,
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

/** One expense per amount, each on its own day counting back from NOW. */
const oneCategory = (amounts: number[], category = 'Food', startDaysAgo = 0) =>
  amounts.map((amount, i) => tx(ago(startDaysAgo + i), amount, { category }));
const repeat = (n: number, amount: number) => Array<number>(n).fill(amount);

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
const ZONES = ['America/Los_Angeles', 'Asia/Shanghai', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

describe('behaviour detection: duplicate charges', () => {
  test('the same merchant charging the same amount twice in a day is one duplicate', () => {
    const a = tx('2026-08-10', 12.5, { note: 'Uber trip', category: 'Transport' });
    const b = tx('2026-08-10', 12.5, { note: 'Uber', category: 'Transport' });
    const c = tx('2026-08-10', 12.5, { note: 'uber', category: 'Transport' });
    expect(detectDuplicateCharges([a, b])).toEqual([
      { transactions: [a, b], amount: 12.5, description: 'Uber trip', date: '2026-08-10', potentialRefund: 12.5 },
    ]);
    // Every extra copy is refundable.
    expect(detectDuplicateCharges([a, b, c])).toEqual([
      { transactions: [a, b, c], amount: 12.5, description: 'Uber trip', date: '2026-08-10', potentialRefund: 25 },
    ]);
  });

  test('the window is one calendar day, including across a month boundary', () => {
    expect(
      detectDuplicateCharges([
        tx('2026-08-10', 9.99, { note: 'Spotify' }),
        tx('2026-08-11', 9.99, { note: 'Spotify' }),
        tx('2026-07-31', 30, { note: 'Gym' }),
        tx('2026-08-01', 30, { note: 'Gym' }),
      ])
    ).toEqual([]);
  });

  test('amounts match to the cent, no looser', () => {
    const same = detectDuplicateCharges([
      tx('2026-08-10', 9.99, { note: 'Cafe' }),
      tx('2026-08-10', 9.991, { note: 'Cafe' }),
    ]);
    expect(same).toHaveLength(1);
    expect(same[0]!.potentialRefund).toBe(9.99);
    expect(
      detectDuplicateCharges([tx('2026-08-10', 0.1 + 0.2, { note: 'Bus' }), tx('2026-08-10', 0.3, { note: 'Bus' })])
    ).toHaveLength(1);
    expect(
      detectDuplicateCharges([tx('2026-08-10', 9.99, { note: 'Cafe' }), tx('2026-08-10', 9.98, { note: 'Cafe' })])
    ).toEqual([]);
  });

  test('different merchants do not match; a missing note falls back to the category; income is ignored', () => {
    expect(
      detectDuplicateCharges([tx('2026-08-10', 4.5, { note: 'Coffee' }), tx('2026-08-10', 4.5, { note: 'Parking' })])
    ).toEqual([]);
    const a = tx('2026-08-10', 4.5);
    const b = tx('2026-08-10', 4.5);
    expect(detectDuplicateCharges([a, b])).toEqual([
      { transactions: [a, b], amount: 4.5, description: 'Food', date: '2026-08-10', potentialRefund: 4.5 },
    ]);
    expect(
      detectDuplicateCharges([
        tx('2026-08-10', 2000, { type: 'Income', note: 'Salary' }),
        tx('2026-08-10', 2000, { type: 'Income', note: 'Salary' }),
      ])
    ).toEqual([]);
  });

  test('a same-priced charge from another merchant is not part of the duplicate', () => {
    // It used to be swept into the group (and the refund), and a pair that
    // did not start the group was missed entirely.
    const c1 = tx('2026-08-10', 4.5, { note: 'Coffee' });
    const c2 = tx('2026-08-10', 4.5, { note: 'Coffee' });
    const p1 = tx('2026-08-10', 4.5, { note: 'Parking' });
    const p2 = tx('2026-08-10', 4.5, { note: 'Parking' });
    expect(detectDuplicateCharges([c1, c2, p1])).toEqual([
      { transactions: [c1, c2], amount: 4.5, description: 'Coffee', date: '2026-08-10', potentialRefund: 4.5 },
    ]);
    expect(detectDuplicateCharges([c1, p1, p2])).toEqual([
      { transactions: [p1, p2], amount: 4.5, description: 'Parking', date: '2026-08-10', potentialRefund: 4.5 },
    ]);
  });
});

test('behaviour detection: duplicate charges compare notes without their surrounding spaces', () => {
  // A leading space made the first word empty, and every description
  // "contains" the empty string, so any two same-priced charges matched.
  expect(
    detectDuplicateCharges([tx('2026-08-10', 4.5, { note: ' Coffee' }), tx('2026-08-10', 4.5, { note: 'Parking' })])
  ).toEqual([]);
  const a = tx('2026-08-10', 4.5, { note: 'Coffee ' });
  const b = tx('2026-08-10', 4.5, { note: ' coffee' });
  expect(detectDuplicateCharges([a, b])).toEqual([
    { transactions: [a, b], amount: 4.5, description: 'Coffee', date: '2026-08-10', potentialRefund: 4.5 },
  ]);
});

describe('behaviour detection: unusual transactions', () => {
  const food = categoryLabel('Food');

  test('an expense more than 2σ above its category average is flagged', () => {
    // Nine 10s and a 40: mean 13, σ 9, so the 40 sits exactly 3σ out.
    const txs = oneCategory([...repeat(9, 10), 40]);
    expect(detectUnusualTransactions(txs)).toEqual([
      {
        transaction: txs[9]!,
        reason: t('analytics.reasonAbove', { category: food }),
        severity: 'low',
        averageForCategory: 13,
        deviation: 3,
      },
    ]);
  });

  test('severity steps up past 3σ and 4σ, and the "×" figure is the multiple of the average', () => {
    // A lone outlier among n−1 equal amounts sits √(n−1) σ out.
    const medium = oneCategory([...repeat(14, 10), 60]);
    const [m] = detectUnusualTransactions(medium);
    expect(m!.severity).toBe('medium');
    expect(m!.deviation).toBeCloseTo(Math.sqrt(14), 10);
    expect(m!.reason).toBe(t('analytics.reasonSignificant', { category: food }));

    const high = oneCategory([...repeat(19, 10), 100]);
    const [h] = detectUnusualTransactions(high);
    expect(h!.severity).toBe('high');
    expect(h!.deviation).toBeCloseTo(Math.sqrt(19), 10);
    expect(h!.averageForCategory).toBe(14.5);
    // 100 against an average of 14.5 is 7×. The σ count (4) used to be shown.
    expect(h!.reason).toBe(t('analytics.reasonMultiple', { times: 7, category: food }));
  });

  test('a category with five purchases or fewer cannot raise one, however large', () => {
    // With n purchases no single one can sit more than √(n−1) σ out.
    expect(detectUnusualTransactions(oneCategory([10, 10, 10, 10, 1000]))).toEqual([]);
    expect(detectUnusualTransactions(oneCategory([10]))).toEqual([]);
    expect(detectUnusualTransactions([])).toEqual([]);
    const six = detectUnusualTransactions(oneCategory([10, 10, 10, 10, 10, 1000]));
    expect(six.map((u) => [u.transaction.amount, u.severity])).toEqual([[1000, 'low']]);
  });

  test('a price rise of cents on an otherwise constant charge is not unusual', () => {
    // Eleven 9.99s and a 10.99 are √11 σ apart only because σ is tiny; it was
    // flagged "significantly higher". Spread under 10% of the average is noise.
    expect(detectUnusualTransactions(oneCategory([...repeat(11, 9.99), 10.99], 'Subscriptions'))).toEqual([]);
    expect(detectUnusualTransactions(oneCategory([...repeat(9, 10), 11]))).toEqual([]);
  });

  test('categories are judged separately, income is ignored, and the ten largest come first', () => {
    // Pooled, the 40 would sit √19 σ above nineteen 10s; on its own it is just
    // a Shopping purchase. Counted, the 5000 of income would stand out too.
    expect(
      detectUnusualTransactions([
        ...oneCategory(repeat(19, 10), 'Transport'),
        tx(ago(25), 40, { category: 'Shopping' }),
        tx(ago(3), 5000, { type: 'Income', category: 'Transport' }),
      ])
    ).toEqual([]);

    // Eleven categories, each with one outlier, √6 … √16 σ out.
    const txs = Array.from({ length: 11 }, (_, k) =>
      oneCategory([...repeat(6 + k, 10), 40], `Cat${k}`)
    ).flat();
    const flagged = detectUnusualTransactions(txs);
    expect(flagged).toHaveLength(10);
    expect(flagged.map((u) => u.transaction.category)).toEqual(
      ['Cat10', 'Cat9', 'Cat8', 'Cat7', 'Cat6', 'Cat5', 'Cat4', 'Cat3', 'Cat2', 'Cat1']
    );
  });
});

describe('behaviour detection: spending patterns', () => {
  test('the weekday is read from the date string, in every timezone', () => {
    // new Date('2026-08-08') is UTC midnight: west of Greenwich that is still
    // Friday, so Saturdays counted as weekdays and Mondays as Sundays.
    for (const zone of ZONES) {
      inTimeZone(zone, () => {
        const now = new Date(2026, 7, 15, 12, 0, 0);
        const wednesday = tx('2026-08-12', 10);
        const satSun = ['2026-08-01', '2026-08-02', '2026-08-08', '2026-08-09'].map((d) => tx(d, 50));
        const weekend = analyzeSpendingPatterns([...satSun, wednesday], now);
        expect([zone, weekend.map((p) => [p.type, p.transactionCount, p.totalSpent])]).toEqual([
          zone,
          [['weekend', 4, 200]],
        ]);
        const mondays = ['2026-08-03', '2026-08-10'].map((d) => tx(d, 50));
        expect([zone, analyzeSpendingPatterns([...mondays, wednesday], now)]).toEqual([zone, []]);
      });
    }
  });

  test('weekend-only spending is no comparison, not "Infinity% more"', () => {
    const satSun = ['2026-08-08', '2026-08-09'].map((d) => tx(d, 50));
    expect(analyzeSpendingPatterns(satSun, NOW)).toEqual([]);
  });

  /** `weekend` on each weekend day and `weekday` on each weekday of the window. */
  const window30 = (weekend: number, weekday: number) =>
    Array.from({ length: 30 }, (_, i) => {
      const d = ago(i);
      const day = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay();
      const isWeekend = day === 0 || day === 6;
      return tx(d, isWeekend ? weekend : weekday, { category: isWeekend ? 'Entertainment' : 'Food' });
    });

  test('averages over the actual weekend and weekday days in the last 30', () => {
    // 9 weekend days at 10 and 21 weekdays at 1: weekends are 900% higher.
    // A 500 thirty days ago and a 500 next month are outside the window; the
    // window used to reach 31 days back and divide by a fixed 8 and 22.
    const txs = [...window30(10, 1), tx('2026-07-16', 500), tx('2026-09-02', 500)];
    expect(analyzeSpendingPatterns(txs, NOW)).toEqual([
      {
        type: 'weekend',
        period: t('analytics.periodLast30'),
        totalSpent: 90,
        averageTransaction: 10,
        transactionCount: 9,
        topCategories: [{ category: 'Entertainment', amount: 90 }],
        insight: expect.stringContaining('900'),
      },
    ]);
  });

  test('weekends must run more than 30% above weekdays, per day', () => {
    // 20% higher per day is not a pattern (the fixed divisors made it 41%).
    expect(analyzeSpendingPatterns(window30(1.2, 1), NOW)).toEqual([]);
    const [p] = analyzeSpendingPatterns(window30(1.4, 1), NOW);
    expect(p!.type).toBe('weekend');
    expect(p!.insight).toContain('40');
  });

  test('a month 20% above last month is flagged, with a steady projection', () => {
    const july = tx('2026-07-10', 1000);
    expect(analyzeSpendingPatterns([july, tx('2026-08-05', 1200)], NOW)).toEqual([]);

    const [p] = analyzeSpendingPatterns([july, tx('2026-08-05', 1300)], NOW);
    expect(p).toMatchObject({
      type: 'seasonal',
      totalSpent: 1300,
      averageTransaction: 1300,
      transactionCount: 1,
      topCategories: [{ category: 'Food', amount: 1300 }],
    });
    expect(p!.insight).toContain('30');
    // Half-way through: the month's own run rate over its 31 days (not 30).
    expect(p!.projectedTotal).toBeCloseTo((1300 / 15) * 31, 6);

    // On the 3rd, the run rate is blended with last month instead of three
    // days of spending being multiplied by 30 (13000).
    const third = new Date(2026, 7, 3, 12, 0, 0);
    const [early] = analyzeSpendingPatterns([july, tx('2026-08-03', 1300)], third);
    expect(early!.projectedTotal).toBeCloseTo(
      projectMonthlyExpenses({
        currentMonthExpenses: 1300,
        dayOfMonth: 3,
        daysInMonth: 31,
        previousMonthExpenses: 1000,
      }),
      6
    );
    expect(early!.projectedTotal).toBeCloseTo(3664.29, 2);
  });

  test('the month comparison needs last month, and ignores next month', () => {
    expect(analyzeSpendingPatterns([tx('2026-08-05', 5000)], NOW)).toEqual([]);
    // A future-dated September expense used to count as this month's.
    expect(
      analyzeSpendingPatterns([tx('2026-07-10', 1000), tx('2026-08-05', 1100), tx('2026-09-02', 500)], NOW)
    ).toEqual([]);
  });
});

describe('behaviour detection: top waste categories', () => {
  test('ranks by impulse spend plus 30% of the total, and keeps three', () => {
    const txs = [
      tx('2026-08-02', 60, { category: 'Shopping', isImpulse: true }),
      tx('2026-08-03', 40, { category: 'Shopping' }),
      tx('2026-08-04', 180),
      tx('2026-08-05', 20, { isImpulse: true }),
      tx('2026-08-06', 250, { category: 'Transport' }),
      // All impulse, but small: ranking on impulse alone would keep it.
      tx('2026-08-07', 50, { category: 'Health', isImpulse: true }),
    ];
    expect(getTopWasteCategories(txs, NOW)).toEqual([
      {
        category: 'Shopping',
        totalSpent: 100,
        impulseSpent: 60,
        impulsePercentage: 60,
        transactionCount: 2,
        averageTransaction: 50,
        potentialSavings: 30,
        tip: t('analytics.tipShopping'),
      },
      {
        category: 'Food',
        totalSpent: 200,
        impulseSpent: 20,
        impulsePercentage: 10,
        transactionCount: 2,
        averageTransaction: 100,
        potentialSavings: 10,
        tip: t('analytics.tipTrack', { category: categoryLabel('Food') }),
      },
      {
        category: 'Transport',
        totalSpent: 250,
        impulseSpent: 0,
        impulsePercentage: 0,
        transactionCount: 1,
        averageTransaction: 250,
        potentialSavings: 0,
        tip: t('analytics.tipTransport'),
      },
    ]);
  });

  test('each tip has its own threshold', () => {
    const tipFor = (category: string, total: number, impulse: number) => {
      const txs = [tx('2026-08-04', total - impulse, { category })];
      if (impulse > 0) txs.push(tx('2026-08-05', impulse, { category, isImpulse: true }));
      return getTopWasteCategories(txs, NOW)[0]!.tip;
    };
    const track = (category: string) => t('analytics.tipTrack', { category: categoryLabel(category) });
    expect(tipFor('Food', 100, 31)).toBe(t('analytics.tipFood'));
    expect(tipFor('Food', 100, 30)).toBe(track('Food'));
    expect(tipFor('Shopping', 100, 41)).toBe(t('analytics.tipShopping'));
    expect(tipFor('Shopping', 100, 40)).toBe(track('Shopping'));
    expect(tipFor('Subscriptions', 10, 0)).toBe(t('analytics.tipSubscriptions'));
    expect(tipFor('Transport', 201, 0)).toBe(t('analytics.tipTransport'));
    expect(tipFor('Transport', 200, 0)).toBe(track('Transport'));
    expect(tipFor('Entertainment', 100, 51)).toBe(
      t('analytics.tipImpulse', { pct: 51, category: categoryLabel('Entertainment') })
    );
    expect(tipFor('Entertainment', 100, 50)).toBe(track('Entertainment'));
  });

  test('only expenses from this calendar month count', () => {
    const txs = [
      tx('2026-07-31', 999, { isImpulse: true }),
      tx('2026-09-01', 999, { isImpulse: true }), // future-dated: used to count
      tx('2026-08-10', 3000, { type: 'Income', category: 'Food' }),
      tx('2026-08-01', 40),
    ];
    expect(getTopWasteCategories(txs, NOW).map((w) => [w.category, w.totalSpent, w.impulseSpent])).toEqual([
      ['Food', 40, 0],
    ]);
    expect(getTopWasteCategories([], NOW)).toEqual([]);
  });

  test('a category of zero-amount expenses has 0% impulse, not NaN', () => {
    const [w] = getTopWasteCategories([tx('2026-08-03', 0, { category: 'Other' })], NOW);
    expect([w!.impulsePercentage, w!.averageTransaction, w!.potentialSavings]).toEqual([0, 0, 0]);
  });
});

describe('behaviour detection: analytics summary', () => {
  test('an empty ledger raises nothing', () => {
    expect(generateAnalyticsSummary([], NOW)).toEqual({
      subscriptions: [],
      duplicateCharges: [],
      unusualTransactions: [],
      spendingPatterns: [],
      wasteCategories: [],
      totalMonthlySubscriptions: 0,
      potentialMonthlySavings: 0,
      alertCount: 0,
    });
  });

  const sub = (note: string, amount: number, dates: string[]) =>
    dates.map((d) => tx(d, amount, { note, category: 'Subscriptions' }));
  const ledger = [
    ...sub('Netflix', 15.99, ['2026-06-10', '2026-07-10', '2026-08-10']),
    ...sub('Spin Class', 10, ['2026-07-25', '2026-08-01', '2026-08-08', '2026-08-15']),
    ...sub('Domain Renewal', 12, ['2025-08-01', '2026-08-01']),
    tx('2026-08-12', 23.4, { note: 'Uber', category: 'Transport' }),
    tx('2026-08-12', 23.4, { note: 'Uber', category: 'Transport' }),
    ...oneCategory([...repeat(19, 10), 100], 'Food', 16), // a 4.4σ outlier: high
    ...oneCategory([...repeat(14, 20), 90], 'Health', 16), // a 3.7σ outlier: medium
    tx('2026-08-03', 80, { category: 'Shopping', isImpulse: true }),
  ];

  test('lists every detector, and counts only duplicates and high-severity outliers as alerts', () => {
    const s = generateAnalyticsSummary(ledger, NOW);
    expect(s.subscriptions.map((x) => [x.description, x.frequency, x.amount, x.nextExpected])).toEqual([
      ['Netflix', 'monthly', 15.99, '2026-09-10'],
      ['Domain Renewal', 'yearly', 12, '2027-08-01'],
      ['Spin Class', 'weekly', 10, '2026-08-22'],
    ]);
    expect(s.duplicateCharges.map((d) => [d.description, d.date, d.potentialRefund])).toEqual([
      ['Uber', '2026-08-12', 23.4],
    ]);
    expect(s.unusualTransactions.map((u) => [u.transaction.category, u.transaction.amount, u.severity])).toEqual([
      ['Food', 100, 'high'],
      ['Health', 90, 'medium'],
    ]);
    expect(s.wasteCategories.map((w) => [w.category, w.potentialSavings])).toEqual([
      ['Shopping', 40],
      ['Subscriptions', 0],
      ['Transport', 0],
    ]);
    expect(s.spendingPatterns).toEqual(analyzeSpendingPatterns(ledger, NOW));
    expect(s.alertCount).toBe(2);
    // Half the impulse spend plus the duplicate's refund.
    expect(s.potentialMonthlySavings).toBeCloseTo(40 + 23.4, 10);
  });

  test('the monthly subscription total converts weekly and yearly charges to a month', () => {
    // It used to add the monthly ones only (15.99), leaving out 10 a week and
    // 12 a year.
    const s = generateAnalyticsSummary(ledger, NOW);
    expect(s.totalMonthlySubscriptions).toBeCloseTo(15.99 + (10 * 365) / 12 / 7 + 12 / 12, 10);
  });
});
