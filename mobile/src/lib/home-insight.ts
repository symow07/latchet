/**
 * The one thing the home screen says out loud.
 *
 * DESIGN-PROMPT.md §5 takes the dashboard apart: the health score, the streak,
 * the badges, the 14-day chart and the alerts all move to Insights, and what
 * replaces them on home is a single sentence of plain English with up to two
 * action chips. That sentence has to be chosen well, because it is now the
 * only interpretation the screen offers.
 *
 * This module picks it. It returns a key and its parameters rather than a
 * string, so the screen does the translating and this file stays free of any
 * native or i18n import — which is what lets it be unit-tested.
 *
 * The ordering is deliberate: an insight the user can act on beats one that
 * merely describes, and a warning beats praise. The fallback is deliberately
 * unexciting, because inventing drama from steady spending is how a calm app
 * starts to feel like a slot machine.
 */

/** What a chip beneath the insight does. The screen maps these to routes. */
export type InsightAction = 'seeSpending' | 'setBudget' | 'setGoal' | 'ask' | 'seeImpulse';

export interface HomeInsight {
  /** Key under `home.insight` in the locale files. */
  key: string;
  /** Interpolation values. Money arrives pre-formatted; percentages are integers. */
  params: Record<string, string | number>;
  /** At most two — §5 and §6.3. */
  actions: InsightAction[];
}

export interface InsightInput {
  /** False on a fresh account: nothing recorded, so nothing to interpret. */
  scorable: boolean;
  monthSpent: number;
  monthlyBudget: number;
  weekSpent: number;
  lastWeekSpent: number;
  /** 0–100. */
  impulsePercent: number;
  streak: number;
  savingsGoal: number;
  /** Income minus month spend. Negative is possible. */
  projectedSavings: number;
  dayOfMonth: number;
  daysInMonth: number;
  /** The screen's own formatter, so amounts carry the user's currency. */
  money: (n: number) => string;
}

/** Below this, "you spent less than last week" is noise rather than a trend. */
const MEANINGFUL_DROP = 10;

/** Percentage points ahead of an even burn-down before we call it "ahead". */
const AHEAD_TOLERANCE = 10;

export function pickHomeInsight(input: InsightInput): HomeInsight | null {
  const {
    scorable, monthSpent, monthlyBudget, weekSpent, lastWeekSpent,
    impulsePercent, streak, savingsGoal, projectedSavings,
    dayOfMonth, daysInMonth, money,
  } = input;

  // A fresh account has nothing to say. Every metric here measures spending
  // behaviour, so with nothing recorded they do not read low — they read
  // *well*, and congratulating someone for having done nothing is worse than
  // staying quiet. The screen shows its first-run empty state instead.
  if (!scorable) return null;

  const hasBudget = monthlyBudget > 0;
  const usedPercent = hasBudget ? Math.round((monthSpent / monthlyBudget) * 100) : 0;
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);

  if (hasBudget && monthSpent > monthlyBudget) {
    return {
      key: 'over',
      params: { amount: money(monthSpent - monthlyBudget), budget: money(monthlyBudget) },
      actions: ['seeSpending', 'setBudget'],
    };
  }

  if (hasBudget && usedPercent >= 90) {
    return {
      key: 'close',
      params: { percent: usedPercent, days: daysLeft },
      actions: ['seeSpending'],
    };
  }

  if (hasBudget && daysInMonth > 0) {
    const expected = (dayOfMonth / daysInMonth) * 100;
    if (usedPercent > expected + AHEAD_TOLERANCE) {
      return {
        key: 'ahead',
        params: { percent: usedPercent, days: daysLeft },
        actions: ['seeSpending'],
      };
    }
  }

  if (impulsePercent > 40) {
    return {
      key: 'impulse',
      params: { percent: Math.round(impulsePercent) },
      actions: ['seeImpulse', 'ask'],
    };
  }

  // Guard on lastWeekSpent rather than on the drop: with no spending at all
  // last week the "drop" is 100% and the sentence would congratulate someone
  // for a week that never had a baseline.
  if (lastWeekSpent > 0 && weekSpent < lastWeekSpent) {
    const drop = Math.round(((lastWeekSpent - weekSpent) / lastWeekSpent) * 100);
    if (drop >= MEANINGFUL_DROP) {
      return {
        key: savingsGoal > 0 ? 'downWithGoal' : 'down',
        params: { percent: drop },
        actions: savingsGoal > 0 ? ['seeSpending'] : ['setGoal', 'seeSpending'],
      };
    }
  }

  if (savingsGoal > 0 && projectedSavings >= savingsGoal) {
    return {
      key: 'saving',
      params: { amount: money(projectedSavings) },
      actions: ['seeSpending'],
    };
  }

  if (streak >= 7) {
    return { key: 'streak', params: { days: streak }, actions: ['ask'] };
  }

  return { key: 'steady', params: {}, actions: ['ask'] };
}
