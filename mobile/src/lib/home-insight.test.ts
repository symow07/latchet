import { describe, expect, it } from 'bun:test';
import { pickHomeInsight, type InsightInput } from './home-insight';

const money = (n: number) => `$${n.toFixed(2)}`;

const base: InsightInput = {
  scorable: true,
  monthSpent: 400,
  monthlyBudget: 1200,
  weekSpent: 100,
  lastWeekSpent: 100,
  impulsePercent: 0,
  streak: 0,
  savingsGoal: 0,
  projectedSavings: 0,
  dayOfMonth: 15,
  daysInMonth: 30,
  money,
};

describe('pickHomeInsight', () => {
  it('says nothing on a fresh account rather than congratulating it', () => {
    expect(pickHomeInsight({ ...base, scorable: false })).toBeNull();
  });

  it('leads with going over budget, and offers both repairs', () => {
    const out = pickHomeInsight({ ...base, monthSpent: 1320 })!;
    expect(out.key).toBe('over');
    expect(out.params.amount).toBe('$120.00');
    expect(out.actions).toEqual(['seeSpending', 'setBudget']);
  });

  it('warns before the budget is gone, with the days left', () => {
    const out = pickHomeInsight({ ...base, monthSpent: 1100 })!;
    expect(out.key).toBe('close');
    expect(out.params).toEqual({ percent: 92, days: 15 });
  });

  it('calls out spending ahead of an even burn-down', () => {
    // Day 15 of 30 is 50% expected; 70% used is beyond the tolerance.
    const out = pickHomeInsight({ ...base, monthSpent: 840 })!;
    expect(out.key).toBe('ahead');
  });

  it('leaves spending slightly ahead of pace alone', () => {
    // 55% used against 50% expected is inside the tolerance.
    expect(pickHomeInsight({ ...base, monthSpent: 660 })!.key).not.toBe('ahead');
  });

  it('reports a meaningful drop against last week', () => {
    const out = pickHomeInsight({ ...base, weekSpent: 82, lastWeekSpent: 100 })!;
    expect(out.key).toBe('down');
    expect(out.params.percent).toBe(18);
    expect(out.actions).toContain('setGoal');
  });

  it('does not offer a savings goal to someone who already has one', () => {
    const out = pickHomeInsight({ ...base, weekSpent: 82, lastWeekSpent: 100, savingsGoal: 300 })!;
    expect(out.key).toBe('downWithGoal');
    expect(out.actions).not.toContain('setGoal');
  });

  it('ignores a drop too small to be a trend', () => {
    expect(pickHomeInsight({ ...base, weekSpent: 95, lastWeekSpent: 100 })!.key).toBe('steady');
  });

  it('does not read a week with no baseline as a 100% improvement', () => {
    const out = pickHomeInsight({ ...base, weekSpent: 0, lastWeekSpent: 0 })!;
    expect(out.key).toBe('steady');
  });

  it('mentions impulse buying ahead of the weekly comparison', () => {
    const out = pickHomeInsight({ ...base, impulsePercent: 61, weekSpent: 10, lastWeekSpent: 100 })!;
    expect(out.key).toBe('impulse');
    expect(out.params.percent).toBe(61);
  });

  it('praises a savings goal only once it is actually on track', () => {
    expect(pickHomeInsight({ ...base, savingsGoal: 300, projectedSavings: 420 })!.key).toBe('saving');
    expect(pickHomeInsight({ ...base, savingsGoal: 300, projectedSavings: 120 })!.key).toBe('steady');
  });

  it('falls back to the streak, then to something deliberately dull', () => {
    expect(pickHomeInsight({ ...base, streak: 9 })!.key).toBe('streak');
    expect(pickHomeInsight(base)!.key).toBe('steady');
  });

  it('never offers more than the two chips the layout has room for', () => {
    const cases: InsightInput[] = [
      { ...base, monthSpent: 1320 },
      { ...base, monthSpent: 1100 },
      { ...base, impulsePercent: 61 },
      { ...base, weekSpent: 50, lastWeekSpent: 100 },
      base,
    ];
    for (const c of cases) expect(pickHomeInsight(c)!.actions.length).toBeLessThanOrEqual(2);
  });

  it('works with no budget set, without dividing by zero', () => {
    const out = pickHomeInsight({ ...base, monthlyBudget: 0, monthSpent: 900 })!;
    expect(out.key).toBe('steady');
    expect(Number.isNaN(out.params.percent as number)).toBe(false);
  });
});
