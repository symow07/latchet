import { describe, test, expect } from 'bun:test';
import {
  calculateHealthScore,
  determinePersonality,
  generateSuggestions,
  getGrade,
  type HealthScoreBreakdown,
  type HealthScoreResult,
  type HealthScoreSettings,
  type SpendingPersonality,
} from './health-score';
import { daysAgoISO, daysAheadISO } from './dates';
import type { Transaction } from './transaction';

// Saturday 15 August 2026 at local noon: day 15 of a 31-day month, so the
// budget pace is 15/31 = 48.39%. Built from local fields, so it is the same
// calendar day under every TZ the suite runs in.
const NOW = new Date(2026, 7, 15, 12, 0, 0);
const ago = (n: number, now: Date = NOW) => daysAgoISO(n, now);

let seq = 0;
function tx(dateISO: string, amount: number, over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `hs${seq}`,
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
const income = (dateISO: string, amount: number) =>
  tx(dateISO, amount, { type: 'Income', category: 'Income' });

/** Settings as a brand-new user has them: nothing filled in. */
const BLANK: HealthScoreSettings = {
  monthlyBudget: 0,
  startingBalance: 0,
  hourlyValue: 0,
  showTimeCost: 0,
  currency: 'USD',
  currencySymbol: '$',
  monthlyIncome: 0,
  savingsGoal: 0,
  spendingStyle: 'moderate',
  primaryGoal: 'track',
};
const withSettings = (over: Partial<HealthScoreSettings>): HealthScoreSettings => ({
  ...BLANK,
  ...over,
});

const score = (txs: Transaction[], settings: HealthScoreSettings = BLANK, now: Date = NOW) =>
  calculateHealthScore(txs, settings, now);

/** One expense per day, `amounts[i]` on the day `i` days before NOW. */
const dailySeries = (amounts: number[]) =>
  amounts.flatMap((amount, i) => (amount > 0 ? [tx(ago(i), amount)] : []));

/** A breakdown with the given component scores (values default to 50). */
function bd(p: {
  savings?: number;
  savingsValue?: number;
  budget?: number;
  consistency?: number;
  goal?: number;
  impulse?: number;
}): HealthScoreBreakdown {
  return {
    savingsRate: { score: p.savings ?? 15, value: p.savingsValue ?? 50, maxPoints: 25 },
    budgetDiscipline: { score: p.budget ?? 18, value: 50, maxPoints: 25 },
    spendingConsistency: { score: p.consistency ?? 12, value: 50, maxPoints: 20 },
    goalProgress: { score: p.goal ?? 9, value: 50, maxPoints: 15 },
    impulseControl: { score: p.impulse ?? 9, value: 50, maxPoints: 15 },
  };
}

describe('health score: savings rate (25 points)', () => {
  test('each band starts exactly at its cut-off', () => {
    // Income of 1000 this month; the savings rate is what the expenses leave.
    const cases: [expenses: number, score: number, value: number][] = [
      [700, 25, 30],
      [701, 20, 30], // 29.9%
      [800, 20, 20],
      [801, 15, 20], // 19.9%
      [900, 15, 10],
      [901, 10, 10], // 9.9%
      [950, 10, 5],
      [951, 5, 5], // 4.9% scores its own rounded percentage
      [980, 2, 2],
      [1000, 0, 0],
      [1500, 0, 0], // overspending floors at zero rather than going negative
    ];
    for (const [expenses, s, value] of cases) {
      const r = score([income('2026-08-01', 1000), tx('2026-08-15', expenses)]);
      expect([expenses, r.breakdown.savingsRate.score, r.breakdown.savingsRate.value]).toEqual([
        expenses,
        s,
        value,
      ]);
      expect(r.breakdown.savingsRate.maxPoints).toBe(25);
    }
  });

  test('only this month counts, and settings income stands in when none is recorded', () => {
    // July's income and July's spending are on the other side of the month
    // boundary; with no August income the settings figure (2000) is used.
    const r = score(
      [income('2026-07-31', 5000), tx('2026-07-31', 1900), tx('2026-08-01', 1500)],
      withSettings({ monthlyIncome: 2000 })
    );
    expect(r.breakdown.savingsRate).toEqual({ score: 20, value: 25, maxPoints: 25 });
    // Recorded income this month wins over the settings figure.
    const recorded = score(
      [income('2026-08-01', 1000), tx('2026-08-02', 700)],
      withSettings({ monthlyIncome: 5000 })
    );
    expect(recorded.breakdown.savingsRate).toEqual({ score: 25, value: 30, maxPoints: 25 });
  });

  test('is neutral (12, 50) when the income is unknown, zero or negative', () => {
    // Dividing by a stand-in income of 1 used to report 100% saved for an
    // empty month and 0% saved for any spending at all.
    const neutral = { score: 12, value: 50, maxPoints: 25 };
    expect(score([]).breakdown.savingsRate).toEqual(neutral);
    expect(score([tx('2026-08-10', 500)]).breakdown.savingsRate).toEqual(neutral);
    expect(
      score([tx('2026-08-10', 500)], withSettings({ monthlyIncome: -2000 })).breakdown.savingsRate
    ).toEqual(neutral);
  });
});

describe('health score: budget discipline (25 points)', () => {
  const budget = withSettings({ monthlyBudget: 1000 });
  const discipline = (spent: number, now: Date = NOW, settings = budget) =>
    score([tx(ago(0, now), spent)], settings, now).breakdown.budgetDiscipline;

  test('each band is measured against the pace of the month', () => {
    // On 15 August the pace is 48.39% of the budget.
    const cases: [spent: number, score: number][] = [
      [0, 25],
      [383, 25], // 10 points under pace
      [384, 22],
      [483, 22], // on pace
      [484, 18],
      [583, 18], // 10 points over pace
      [584, 12],
      [1000, 12], // the whole budget, half-way through the month
    ];
    for (const [spent, s] of cases) expect([spent, discipline(spent).score]).toEqual([spent, s]);
    expect(discipline(484).value).toBe(100);
    expect(discipline(1000).value).toBe(48);
  });

  test('going over budget keeps falling from the in-budget floor and never pays more', () => {
    // Over budget used to restart at 25 points, so 104% of the budget scored
    // 24 — more than spending exactly on pace.
    const cases: [spent: number, score: number][] = [
      [1040, 11],
      [1120, 9],
      [1480, 0],
      [2000, 0],
    ];
    for (const [spent, s] of cases) expect([spent, discipline(spent).score]).toEqual([spent, s]);

    let previous = Infinity;
    for (let spent = 0; spent <= 2500; spent += 5) {
      const s = discipline(spent).score;
      expect(s).toBeLessThanOrEqual(previous);
      previous = s;
    }
  });

  test('is neutral (12, 50) when no budget is set, or a negative one', () => {
    const neutral = { score: 12, value: 50, maxPoints: 25 };
    expect(discipline(5000, NOW, BLANK)).toEqual(neutral);
    expect(discipline(500, NOW, withSettings({ monthlyBudget: -1000 }))).toEqual(neutral);
  });

  test('month edges: the pace follows the day and the length of the month', () => {
    // The 1st: the pace is 1/31, too early to be ten points under it.
    const first = new Date(2026, 7, 1, 9, 0, 0);
    expect(discipline(0, first).score).toBe(22);
    // Last month's spending is not this month's.
    const julyOnly = score([tx('2026-07-31', 900)], budget, first).breakdown.budgetDiscipline;
    expect(julyOnly.score).toBe(22);
    // The 31st: the pace is the whole budget.
    const last = new Date(2026, 7, 31, 20, 0, 0);
    expect(discipline(1000, last).score).toBe(22);
    expect(discipline(1001, last).score).toBe(18);
    // 14 February: half of a 28-day month.
    const feb = new Date(2026, 1, 14, 12, 0, 0);
    expect(discipline(400, feb).score).toBe(25);
    expect(discipline(401, feb).score).toBe(22);
  });
});

describe('health score: spending consistency (20 points)', () => {
  const consistency = (amounts: number[]) =>
    score(dailySeries(amounts)).breakdown.spendingConsistency;
  const halves = (a: number, b: number) => [...Array(15).fill(a), ...Array(15).fill(b)];
  const someDays = (days: number, amount: number) => [
    ...Array(days).fill(amount),
    ...Array(30 - days).fill(0),
  ];

  test('each band is set by the coefficient of variation of daily spending', () => {
    expect(consistency(Array(30).fill(10))).toEqual({ score: 20, value: 100, maxPoints: 20 });
    expect(consistency(halves(10, 20))).toEqual({ score: 20, value: 67, maxPoints: 20 }); // CV 33%
    expect(consistency(halves(5, 15))).toEqual({ score: 16, value: 50, maxPoints: 20 }); // CV 50%
    expect(consistency(halves(1, 9))).toEqual({ score: 12, value: 20, maxPoints: 20 }); // CV 80%
    expect(consistency(halves(0, 10))).toEqual({ score: 8, value: 0, maxPoints: 20 }); // CV 100%
    expect(consistency(someDays(10, 10))).toEqual({ score: 8, value: 0, maxPoints: 20 }); // CV 141%
    expect(consistency(someDays(9, 10))).toEqual({ score: 4, value: 0, maxPoints: 20 }); // CV 153%
  });

  test('looks at today and the 29 days before it, expenses only', () => {
    const neutral = { score: 10, value: 50, maxPoints: 20 };
    expect(score([]).breakdown.spendingConsistency).toEqual(neutral);
    expect(score([tx(ago(30), 100)]).breakdown.spendingConsistency).toEqual(neutral);
    expect(score([income(ago(3), 100)]).breakdown.spendingConsistency).toEqual(neutral);
    // One purchase on the oldest day of the window is a maximally uneven month.
    expect(score([tx(ago(29), 100)]).breakdown.spendingConsistency.score).toBe(4);
  });
});

describe('health score: goal progress (15 points)', () => {
  const goal = withSettings({ savingsGoal: 1000 });
  const progress = (expenses: number, settings = goal) =>
    score([income('2026-08-01', 2000), tx('2026-08-14', expenses)], settings).breakdown
      .goalProgress;

  test('each band starts exactly at its cut-off', () => {
    // Saved = 2000 income − expenses, against a goal of 1000.
    const cases: [expenses: number, score: number, value: number][] = [
      [0, 15, 100], // 200% of the goal still reads as 100
      [1000, 15, 100],
      [1001, 12, 100], // 99.9%
      [1250, 12, 75],
      [1251, 9, 75],
      [1500, 9, 50],
      [1501, 6, 50],
      [1750, 6, 25],
      [1751, 5, 25], // below a quarter: a point per 5%
      [1900, 2, 10],
      [2000, 0, 0],
    ];
    for (const [expenses, s, value] of cases) {
      const p = progress(expenses);
      expect([expenses, p.score, p.value]).toEqual([expenses, s, value]);
    }
    // Dissaving never goes below zero, in points or as a percentage (the value
    // used to read -30 here).
    expect(progress(2600)).toEqual({ score: 0, value: 0, maxPoints: 15 });
  });

  test('uses settings income when none is recorded this month', () => {
    const r = score(
      [tx('2026-08-14', 1250)],
      withSettings({ savingsGoal: 1000, monthlyIncome: 2000 })
    );
    expect(r.breakdown.goalProgress).toEqual({ score: 12, value: 75, maxPoints: 15 });
  });

  test('is neutral (8, 50) when no goal is set, or a negative one', () => {
    const neutral = { score: 8, value: 50, maxPoints: 15 };
    expect(progress(1000, BLANK)).toEqual(neutral);
    // A negative goal used to turn dissaving into progress.
    expect(progress(2500, withSettings({ savingsGoal: -500 }))).toEqual(neutral);
  });
});

describe('health score: impulse control (15 points)', () => {
  const tenWithImpulses = (k: number) =>
    Array.from({ length: 10 }, (_, i) => tx(ago(i), 20, { isImpulse: i < k }));

  test('each band starts exactly at its cut-off', () => {
    const cases: [impulses: number, score: number, value: number][] = [
      [0, 15, 100],
      [1, 15, 90],
      [2, 12, 80],
      [3, 9, 70],
      [4, 6, 60],
      [5, 6, 50],
      [6, 3, 40],
      [10, 3, 0],
    ];
    for (const [k, s, value] of cases) {
      const ic = score(tenWithImpulses(k)).breakdown.impulseControl;
      expect([k, ic.score, ic.value]).toEqual([k, s, value]);
    }
  });

  test('counts expenses from the last 30 days only, and is neutral (8, 50) without them', () => {
    const neutral = { score: 8, value: 50, maxPoints: 15 };
    expect(score([]).breakdown.impulseControl).toEqual(neutral);
    expect(score([tx(ago(30), 20, { isImpulse: true })]).breakdown.impulseControl).toEqual(
      neutral
    );
    const r = score([
      tx(ago(29), 20, { isImpulse: true }),
      tx(ago(0), 20),
      income(ago(1), 20),
    ]);
    expect(r.breakdown.impulseControl).toEqual({ score: 6, value: 50, maxPoints: 15 });
  });
});

describe('health score: grade', () => {
  test('cut-offs are inclusive at the bottom of each grade', () => {
    const cases: [number, HealthScoreResult['grade']][] = [
      [100, 'A+'],
      [90, 'A+'],
      [89, 'A'],
      [80, 'A'],
      [79, 'B+'],
      [70, 'B+'],
      [69, 'B'],
      [60, 'B'],
      [59, 'C+'],
      [50, 'C+'],
      [49, 'C'],
      [40, 'C'],
      [39, 'D'],
      [30, 'D'],
      [29, 'F'],
      [0, 'F'],
    ];
    for (const [total, grade] of cases) expect([total, getGrade(total).grade]).toEqual([total, grade]);
    expect(getGrade(95).color).toBe('#22c55e');
    expect(getGrade(10).color).toBe('#dc2626');
  });
});

describe('health score: weekly trend', () => {
  /** 100 spent last week (7–13 days ago) and `thisWeek` in the last 7 days. */
  const trendFor = (thisWeek: number, extra: Transaction[] = []) => {
    const r = score([tx(ago(10), 100), ...(thisWeek > 0 ? [tx(ago(2), thisWeek)] : []), ...extra]);
    return [r.trend, r.trendValue];
  };

  test('moves only on a change of more than 10% either way', () => {
    expect(trendFor(90)).toEqual(['stable', 0]); // exactly 10% less
    expect(trendFor(89)).toEqual(['up', 11]);
    expect(trendFor(110)).toEqual(['stable', 0]); // exactly 10% more
    expect(trendFor(111)).toEqual(['down', 11]);
    expect(trendFor(0)).toEqual(['up', 100]);
    expect(trendFor(300)).toEqual(['down', 200]);
  });

  test('is stable when nothing was spent last week', () => {
    const r = score([tx(ago(1), 500)]);
    expect([r.trend, r.trendValue]).toEqual(['stable', 0]);
  });

  test('this week is today and the 6 days before; last week the 7 before that', () => {
    const r = (txs: Transaction[]) => {
      const s = score(txs);
      return [s.trend, s.trendValue];
    };
    // 6 days ago is this week, 7 days ago is last week.
    expect(r([tx(ago(6), 50), tx(ago(7), 100)])).toEqual(['up', 50]);
    // 13 days ago is still last week; 14 days ago is neither.
    expect(r([tx(ago(13), 100), tx(ago(14), 900), tx(ago(0), 50)])).toEqual(['up', 50]);
    // Income is not spending.
    expect(r([tx(ago(8), 100), income(ago(1), 500)])).toEqual(['up', 100]);
  });

  test('a future-dated expense is not part of this week', () => {
    // It used to be counted (the window had no upper bound), turning an
    // improving week into a "declining" one.
    expect(trendFor(0, [tx(daysAheadISO(3, NOW), 200)])).toEqual(['up', 100]);
  });
});

describe('health score: personality', () => {
  const cases: [string, Parameters<typeof bd>[0], SpendingPersonality][] = [
    ['low impulse control outranks everything', { savings: 25, budget: 25, consistency: 20, impulse: 3 }, 'impulsive'],
    ['impulse control of exactly 6 is not impulsive', { savings: 20, budget: 20, impulse: 6 }, 'saver'],
    ['saver needs both savings and discipline', { savings: 19, budget: 25, consistency: 12 }, 'balanced'],
    ['saver outranks inconsistent', { savings: 25, budget: 22, consistency: 4 }, 'saver'],
    ['disciplined needs discipline and consistency', { savings: 15, budget: 20, consistency: 16 }, 'disciplined'],
    ['disciplined without consistency is inconsistent', { savings: 15, budget: 20, consistency: 4 }, 'inconsistent'],
    ['inconsistent outranks spender', { savings: 0, budget: 12, consistency: 4 }, 'inconsistent'],
    ['consistency of exactly 8 is not inconsistent', { savings: 9, budget: 12, consistency: 8 }, 'spender'],
    ['savings of exactly 10 is not a spender', { savings: 10, budget: 12, consistency: 8 }, 'balanced'],
  ];
  for (const [name, p, expected] of cases) {
    test(name, () => expect(determinePersonality(bd(p))).toBe(expected));
  }
});

describe('health score: suggestions', () => {
  // Compared against single-trigger runs rather than literal English, so the
  // order and the cap are pinned whatever the copy becomes.
  const strong = { savings: 25, budget: 25, consistency: 20, goal: 15, impulse: 15 };
  const run = (
    p: Parameters<typeof bd>[0],
    personality: SpendingPersonality = 'balanced',
    settings: HealthScoreSettings = withSettings({ monthlyBudget: 1000, savingsGoal: 500 })
  ) => generateSuggestions(bd({ ...strong, ...p }), personality, settings);

  test('nothing to suggest when every component is strong', () => {
    expect(run({})).toEqual([]);
    expect(run({}, 'saver')).toEqual([]);
    expect(run({}, 'disciplined')).toEqual([]);
  });

  test('each weak component has its own suggestion, chosen by its detail', () => {
    const lowSaver = run({ savings: 10, savingsValue: 5 });
    const someSaver = run({ savings: 10, savingsValue: 12 });
    expect(lowSaver).toHaveLength(1);
    expect(someSaver).toHaveLength(1);
    expect(lowSaver[0]).not.toBe(someSaver[0]);
    expect(run({ savings: 15 })).toEqual([]); // 15 is not weak

    const withBudget = run({ budget: 12 });
    const noBudget = run({ budget: 12 }, 'balanced', withSettings({ savingsGoal: 500 }));
    expect(withBudget).toHaveLength(1);
    expect(noBudget).toHaveLength(1);
    expect(withBudget[0]).not.toBe(noBudget[0]);

    expect(run({ impulse: 8 })).toHaveLength(2); // two habits for impulse control
    expect(run({ impulse: 9 })).toEqual([]);
    expect(run({ consistency: 11 })).toHaveLength(1);
    expect(run({ consistency: 12 })).toEqual([]);
    expect(run({ goal: 8 })).toHaveLength(1);
    expect(run({ goal: 8 }, 'balanced', withSettings({ monthlyBudget: 1000 }))).toEqual([]); // no goal set
  });

  test('a negative budget asks for a budget, as no budget does', () => {
    // The component already treats it as unset; the suggestion used to say
    // "stay within your monthly budget".
    const noBudget = run({ budget: 12 }, 'balanced', withSettings({ savingsGoal: 500 }));
    expect(run({ budget: 12 }, 'balanced', withSettings({ monthlyBudget: -1000, savingsGoal: 500 }))).toEqual(
      noBudget
    );
  });

  test('personality adds one suggestion for impulsive, spender and inconsistent only', () => {
    const extra = (p: SpendingPersonality) => run({}, p);
    expect(extra('impulsive')).toHaveLength(1);
    expect(extra('spender')).toHaveLength(1);
    expect(extra('inconsistent')).toHaveLength(1);
    expect(new Set([...extra('impulsive'), ...extra('spender'), ...extra('inconsistent')]).size).toBe(3);
    expect(extra('balanced')).toEqual([]);
  });

  test('caps at four, in component order, dropping the later ones', () => {
    const all = run(
      { savings: 0, savingsValue: 0, budget: 0, impulse: 3, consistency: 4, goal: 0 },
      'impulsive'
    );
    const savings = run({ savings: 0, savingsValue: 0 });
    const budget = run({ budget: 0 });
    const impulse = run({ impulse: 3 });
    expect(all).toEqual([...savings, ...budget, ...impulse]);
    expect(all).toHaveLength(4);
    // Below the cap, nothing is dropped.
    expect(run({ consistency: 4, goal: 0 }, 'inconsistent')).toEqual([
      ...run({ consistency: 4 }),
      ...run({ goal: 0 }),
      ...run({}, 'inconsistent'),
    ]);
  });
});

describe('health score: total', () => {
  test('a model month scores exactly 100 (A+)', () => {
    // Income 10000, budget 1000, goal 500, and the same 10 spent every day.
    const txs = [income('2026-08-01', 10000), ...dailySeries(Array(30).fill(10))];
    const r = score(txs, withSettings({ monthlyBudget: 1000, savingsGoal: 500 }));
    expect(r.breakdown).toEqual({
      savingsRate: { score: 25, value: 99, maxPoints: 25 },
      budgetDiscipline: { score: 25, value: 67, maxPoints: 25 },
      spendingConsistency: { score: 20, value: 100, maxPoints: 20 },
      goalProgress: { score: 15, value: 100, maxPoints: 15 },
      impulseControl: { score: 15, value: 100, maxPoints: 15 },
    });
    expect(r.totalScore).toBe(100);
    expect(r.grade).toBe('A+');
    expect(r.gradeColor).toBe('#22c55e');
    expect(r.personalityType).toBe('saver');
    expect([r.trend, r.trendValue]).toEqual(['stable', 0]);
    expect(r.suggestions).toEqual([]);
  });

  test('the worst month bottoms out at 7 (F), never below zero', () => {
    // One impulsive splurge of 3000 against income 1000, budget 1000, goal 500.
    const r = score(
      [income('2026-08-01', 1000), tx(ago(0), 3000, { isImpulse: true })],
      withSettings({ monthlyBudget: 1000, savingsGoal: 500 })
    );
    expect([
      r.breakdown.savingsRate.score,
      r.breakdown.budgetDiscipline.score,
      r.breakdown.spendingConsistency.score,
      r.breakdown.goalProgress.score,
      r.breakdown.impulseControl.score,
    ]).toEqual([0, 0, 4, 0, 3]);
    expect(r.totalScore).toBe(7);
    expect(r.grade).toBe('F');
    expect(r.personalityType).toBe('impulsive');
    expect(r.suggestions).toHaveLength(4);
  });

  test('an empty ledger with nothing set scores the neutral 50 (C+)', () => {
    // It used to score 63 (B): "saved 100% of an income of 1".
    const r = score([]);
    expect(r.totalScore).toBe(50);
    expect(r.grade).toBe('C+');
    expect(r.personalityType).toBe('balanced');
  });

  test('settings fields that are missing or NaN read as not set', () => {
    const txs = [income('2026-08-01', 3000), tx(ago(1), 400), tx(ago(9), 250, { isImpulse: true })];
    const ragged = {
      ...BLANK,
      monthlyBudget: undefined,
      monthlyIncome: null,
      savingsGoal: NaN,
    } as unknown as HealthScoreSettings;
    expect(score(txs, ragged)).toEqual(score(txs, BLANK));
    expect(score([], ragged).totalScore).toBe(50);
  });

  test('stays within 0..100 and equals the sum of its parts for any ledger', () => {
    // A seeded generator, so a failure reproduces.
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

    for (let run = 0; run < 400; run++) {
      const txs = Array.from({ length: Math.floor(rand() * 40) }, () =>
        tx(daysAgoISO(Math.floor(rand() * 75) - 5, NOW), Math.round(rand() * 50000) / 100, {
          type: rand() < 0.2 ? 'Income' : 'Expense',
          isImpulse: rand() < 0.3,
        })
      );
      const settings = withSettings({
        monthlyBudget: pick([0, -500, 1, 800, 3000]),
        monthlyIncome: pick([0, -100, 2500, 6000]),
        savingsGoal: pick([0, -50, 300, 5000]),
      });
      const r = score(txs, settings);
      const parts = Object.values(r.breakdown);
      for (const part of parts) {
        expect(part.score).toBeGreaterThanOrEqual(0);
        expect(part.score).toBeLessThanOrEqual(part.maxPoints);
        expect(Number.isInteger(part.score)).toBe(true);
        expect(part.value).toBeGreaterThanOrEqual(0);
        expect(part.value).toBeLessThanOrEqual(100);
      }
      expect(r.totalScore).toBe(parts.reduce((sum, p) => sum + p.score, 0));
      expect(r.totalScore).toBeGreaterThanOrEqual(0);
      expect(r.totalScore).toBeLessThanOrEqual(100);
      expect(r.grade).toBe(getGrade(r.totalScore).grade);
      expect(r.suggestions.length).toBeLessThanOrEqual(4);
    }
  });
});
