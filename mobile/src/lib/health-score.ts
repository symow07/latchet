import {
  isInCurrentMonth,
  isWithinLastDays,
  daysAgoISO,
  dayOfMonth,
  daysInMonth,
  isBetween,
  todayISO,
} from './dates';
import type { Transaction } from './transaction';
/**
 * Financial Health Score System
 * Calculates a dynamic score (0-100) based on multiple financial factors
 */

interface Settings {
  monthlyBudget: number;
  startingBalance: number;
  hourlyValue: number;
  showTimeCost: number;
  currency: string;
  currencySymbol: string;
  monthlyIncome: number;
  savingsGoal: number;
  spendingStyle: string;
  primaryGoal: string;
}

/** The settings the score reads (a subset of db.ts Settings). */
export type HealthScoreSettings = Settings;

export interface HealthScoreBreakdown {
  savingsRate: { score: number; value: number; maxPoints: number };
  budgetDiscipline: { score: number; value: number; maxPoints: number };
  spendingConsistency: { score: number; value: number; maxPoints: number };
  goalProgress: { score: number; value: number; maxPoints: number };
  impulseControl: { score: number; value: number; maxPoints: number };
}

export interface HealthScoreResult {
  totalScore: number;
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  gradeColor: string;
  breakdown: HealthScoreBreakdown;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
  suggestions: string[];
  personalityType: SpendingPersonality;
}

export type SpendingPersonality =
  | 'saver'        // Low spending, high savings
  | 'balanced'     // Moderate spending, meets goals
  | 'spender'      // High spending, low savings
  | 'impulsive'    // High impulse purchases
  | 'disciplined'  // Stays within budget consistently
  | 'inconsistent'; // Varies widely

// Calculate savings rate score (25 points max)
function calculateSavingsRateScore(
  transactions: Transaction[],
  settings: Settings,
  now: Date
): { score: number; value: number } {
  const monthlyTransactions = transactions.filter(tx => isInCurrentMonth(tx.dateISO, now));

  const monthlyIncome = monthlyTransactions
    .filter(tx => tx.type === 'Income')
    .reduce((sum, tx) => sum + tx.amount, 0) || settings.monthlyIncome || 0;

  // Neutral when the income is unknown. Standing in an income of 1 reported
  // "saved 100%" for an empty month and "saved 0%" for any spending at all,
  // and a negative income turned overspending into savings.
  if (!(monthlyIncome > 0)) {
    return { score: 12, value: 50 };
  }

  const monthlyExpenses = monthlyTransactions
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const savingsRate = Math.max(0, ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100);

  // Score: 30%+ = 25, 20-30% = 20, 10-20% = 15, 5-10% = 10, below 5% = the rounded rate
  let score = 0;
  if (savingsRate >= 30) score = 25;
  else if (savingsRate >= 20) score = 20;
  else if (savingsRate >= 10) score = 15;
  else if (savingsRate >= 5) score = 10;
  else score = Math.round(savingsRate);

  return { score, value: Math.round(savingsRate) };
}

// Calculate budget discipline score (25 points max)
function calculateBudgetDisciplineScore(
  transactions: Transaction[],
  settings: Settings,
  now: Date
): { score: number; value: number } {
  if (!(settings.monthlyBudget > 0)) {
    return { score: 12, value: 50 }; // Neutral if no budget set (or a nonsensical one)
  }

  const monthlyExpenses = transactions
    .filter(tx => tx.type === 'Expense' && isInCurrentMonth(tx.dateISO, now))
    .reduce((sum, tx) => sum + tx.amount, 0);

  const budgetUsedPercent = (monthlyExpenses / settings.monthlyBudget) * 100;
  const expectedUsage = (dayOfMonth(now) / daysInMonth(now)) * 100;

  // Calculate how well they're tracking to budget
  const discipline = Math.max(0, 100 - Math.abs(budgetUsedPercent - expectedUsage));

  let score = 0;
  if (budgetUsedPercent <= expectedUsage - 10) score = 25; // Under budget
  else if (budgetUsedPercent <= expectedUsage) score = 22;
  else if (budgetUsedPercent <= expectedUsage + 10) score = 18;
  else if (budgetUsedPercent <= 100) score = 12;
  // Over budget keeps falling from the in-budget floor: a point per 4% over.
  // (It used to restart from 25, so 104% of the budget outscored being on pace.)
  else score = Math.max(0, 12 - Math.round((budgetUsedPercent - 100) / 4));

  return { score, value: Math.round(discipline) };
}

// Calculate spending consistency score (20 points max)
function calculateSpendingConsistencyScore(
  transactions: Transaction[],
  now: Date
): { score: number; value: number } {
  const last30Days: number[] = [];

  // Get daily spending for last 30 days
  for (let i = 0; i < 30; i++) {
    const dateStr = daysAgoISO(i, now);

    const daySpending = transactions
      .filter(tx => tx.dateISO === dateStr && tx.type === 'Expense')
      .reduce((sum, tx) => sum + tx.amount, 0);

    last30Days.push(daySpending);
  }

  if (last30Days.every(d => d === 0)) {
    return { score: 10, value: 50 }; // Neutral if no data
  }

  // Calculate coefficient of variation (lower = more consistent)
  const mean = last30Days.reduce((a, b) => a + b, 0) / last30Days.length;
  const variance = last30Days.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / last30Days.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

  // Lower CV = higher score
  // CV < 50% = very consistent, CV > 150% = very inconsistent
  const consistency = Math.max(0, 100 - cv);

  let score = 0;
  if (cv < 50) score = 20;
  else if (cv < 80) score = 16;
  else if (cv < 100) score = 12;
  else if (cv < 150) score = 8;
  else score = 4;

  return { score, value: Math.round(consistency) };
}

// Calculate goal progress score (15 points max)
function calculateGoalProgressScore(
  transactions: Transaction[],
  settings: Settings,
  now: Date
): { score: number; value: number } {
  if (!(settings.savingsGoal > 0)) {
    return { score: 8, value: 50 }; // Neutral if no goal set (a negative one would reward dissaving)
  }

  const monthlyTransactions = transactions.filter(tx => isInCurrentMonth(tx.dateISO, now));

  const monthlyIncome = monthlyTransactions
    .filter(tx => tx.type === 'Income')
    .reduce((sum, tx) => sum + tx.amount, 0) || settings.monthlyIncome || 0;

  const monthlyExpenses = monthlyTransactions
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const currentSavings = monthlyIncome - monthlyExpenses;
  const progressPercent = (currentSavings / settings.savingsGoal) * 100;

  let score = 0;
  if (progressPercent >= 100) score = 15;
  else if (progressPercent >= 75) score = 12;
  else if (progressPercent >= 50) score = 9;
  else if (progressPercent >= 25) score = 6;
  else score = Math.max(0, Math.round(progressPercent / 5));

  // A percentage like every other component's value: dissaving reads as 0.
  return { score, value: Math.round(Math.max(0, Math.min(100, progressPercent))) };
}

// Calculate impulse control score (15 points max)
function calculateImpulseControlScore(
  transactions: Transaction[],
  now: Date
): { score: number; value: number } {
  const recentTransactions = transactions.filter(
    tx => tx.type === 'Expense' && isWithinLastDays(tx.dateISO, 30, now)
  );

  if (recentTransactions.length === 0) {
    return { score: 8, value: 50 }; // Neutral if no data
  }

  const impulseCount = recentTransactions.filter(tx => tx.isImpulse).length;
  const impulsePercent = (impulseCount / recentTransactions.length) * 100;
  const controlPercent = 100 - impulsePercent;

  let score = 0;
  if (impulsePercent <= 10) score = 15;
  else if (impulsePercent <= 20) score = 12;
  else if (impulsePercent <= 30) score = 9;
  else if (impulsePercent <= 50) score = 6;
  else score = 3;

  return { score, value: Math.round(controlPercent) };
}

// Calculate weekly trend
function calculateTrend(
  transactions: Transaction[],
  now: Date
): { trend: 'up' | 'down' | 'stable'; trendValue: number } {
  const oneWeekAgo = daysAgoISO(6, now);
  const twoWeeksAgo = daysAgoISO(13, now);

  // Bounded at today: a future-dated expense has not happened this week.
  const thisWeekTx = transactions.filter(tx => isBetween(tx.dateISO, oneWeekAgo, todayISO(now)));

  const lastWeekTx = transactions.filter(tx =>
    isBetween(tx.dateISO, twoWeeksAgo, daysAgoISO(7, now))
  );

  const thisWeekSpending = thisWeekTx
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const lastWeekSpending = lastWeekTx
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  if (lastWeekSpending === 0) {
    return { trend: 'stable', trendValue: 0 };
  }

  const changePercent = ((lastWeekSpending - thisWeekSpending) / lastWeekSpending) * 100;

  if (changePercent > 10) return { trend: 'up', trendValue: Math.round(changePercent) };
  if (changePercent < -10) return { trend: 'down', trendValue: Math.round(Math.abs(changePercent)) };
  return { trend: 'stable', trendValue: 0 };
}

// Determine spending personality. The order of the checks is the precedence.
export function determinePersonality(breakdown: HealthScoreBreakdown): SpendingPersonality {
  const { savingsRate, budgetDiscipline, impulseControl, spendingConsistency } = breakdown;

  // High impulse = impulsive
  if (impulseControl.score < 6) return 'impulsive';

  // High savings, high discipline = saver
  if (savingsRate.score >= 20 && budgetDiscipline.score >= 20) return 'saver';

  // High discipline = disciplined
  if (budgetDiscipline.score >= 20 && spendingConsistency.score >= 16) return 'disciplined';

  // Low consistency = inconsistent
  if (spendingConsistency.score < 8) return 'inconsistent';

  // Low savings = spender
  if (savingsRate.score < 10) return 'spender';

  return 'balanced';
}

// Get grade from score
export function getGrade(score: number): { grade: HealthScoreResult['grade']; color: string } {
  if (score >= 90) return { grade: 'A+', color: '#22c55e' };
  if (score >= 80) return { grade: 'A', color: '#4ade80' };
  if (score >= 70) return { grade: 'B+', color: '#84cc16' };
  if (score >= 60) return { grade: 'B', color: '#eab308' };
  if (score >= 50) return { grade: 'C+', color: '#f59e0b' };
  if (score >= 40) return { grade: 'C', color: '#f97316' };
  if (score >= 30) return { grade: 'D', color: '#ef4444' };
  return { grade: 'F', color: '#dc2626' };
}

// Generate improvement suggestions (at most four)
export function generateSuggestions(
  breakdown: HealthScoreBreakdown,
  personality: SpendingPersonality,
  settings: Settings
): string[] {
  const suggestions: string[] = [];

  // Savings suggestions
  if (breakdown.savingsRate.score < 15) {
    if (breakdown.savingsRate.value < 10) {
      suggestions.push('Try to save at least 10% of your income each month');
    } else {
      suggestions.push('Increase your savings rate by reducing discretionary spending');
    }
  }

  // Budget discipline suggestions
  if (breakdown.budgetDiscipline.score < 15) {
    if (!(settings.monthlyBudget > 0)) {
      suggestions.push('Set a monthly budget to better track your spending');
    } else {
      suggestions.push('Review your spending to stay within your monthly budget');
    }
  }

  // Impulse control suggestions
  if (breakdown.impulseControl.score < 9) {
    suggestions.push('Wait 24 hours before making non-essential purchases');
    suggestions.push('Create a "want vs need" list before shopping');
  }

  // Consistency suggestions
  if (breakdown.spendingConsistency.score < 12) {
    suggestions.push('Try to spread your spending more evenly throughout the month');
  }

  // Goal suggestions
  if (breakdown.goalProgress.score < 9 && settings.savingsGoal > 0) {
    suggestions.push('Automate transfers to savings to hit your goal');
  }

  // Personality-based suggestions
  switch (personality) {
    case 'impulsive':
      suggestions.push('Consider using a spending journal to track impulse urges');
      break;
    case 'spender':
      suggestions.push('Try the 50/30/20 rule: 50% needs, 30% wants, 20% savings');
      break;
    case 'inconsistent':
      suggestions.push('Create a weekly spending allowance to improve consistency');
      break;
  }

  return suggestions.slice(0, 4); // Return top 4 suggestions
}

/**
 * The health score, as of `now`.
 *
 * `now` defaults to the current moment; tests pass a fixed date so every band
 * can be pinned without depending on the wall clock.
 */
export function calculateHealthScore(
  transactions: Transaction[],
  settings: Settings,
  now: Date = new Date()
): HealthScoreResult {
  const savingsRate = calculateSavingsRateScore(transactions, settings, now);
  const budgetDiscipline = calculateBudgetDisciplineScore(transactions, settings, now);
  const spendingConsistency = calculateSpendingConsistencyScore(transactions, now);
  const goalProgress = calculateGoalProgressScore(transactions, settings, now);
  const impulseControl = calculateImpulseControlScore(transactions, now);

  const breakdown: HealthScoreBreakdown = {
    savingsRate: { ...savingsRate, maxPoints: 25 },
    budgetDiscipline: { ...budgetDiscipline, maxPoints: 25 },
    spendingConsistency: { ...spendingConsistency, maxPoints: 20 },
    goalProgress: { ...goalProgress, maxPoints: 15 },
    impulseControl: { ...impulseControl, maxPoints: 15 },
  };

  const totalScore =
    savingsRate.score +
    budgetDiscipline.score +
    spendingConsistency.score +
    goalProgress.score +
    impulseControl.score;

  const { grade, color } = getGrade(totalScore);
  const { trend, trendValue } = calculateTrend(transactions, now);
  const personalityType = determinePersonality(breakdown);
  const suggestions = generateSuggestions(breakdown, personalityType, settings);

  return {
    totalScore,
    grade,
    gradeColor: color,
    breakdown,
    trend,
    trendValue,
    suggestions,
    personalityType,
  };
}

// Get personality description
export function getPersonalityDescription(personality: SpendingPersonality): {
  title: string;
  description: string;
  icon: string;
  color: string;
} {
  switch (personality) {
    case 'saver':
      return {
        title: 'The Saver',
        description: 'You prioritize saving and are great at building wealth over time.',
        icon: '',
        color: '#22c55e',
      };
    case 'balanced':
      return {
        title: 'The Balanced',
        description: 'You maintain a healthy balance between spending and saving.',
        icon: '',
        color: '#3b82f6',
      };
    case 'spender':
      return {
        title: 'The Spender',
        description: 'You enjoy spending but may need to focus more on savings.',
        icon: '',
        color: '#f59e0b',
      };
    case 'impulsive':
      return {
        title: 'The Spontaneous',
        description: 'You make quick decisions. Try pausing before purchases.',
        icon: '',
        color: '#f472b6',
      };
    case 'disciplined':
      return {
        title: 'The Disciplined',
        description: 'You stick to your budget consistently. Great self-control!',
        icon: '',
        color: '#a855f7',
      };
    case 'inconsistent':
      return {
        title: 'The Variable',
        description: 'Your spending varies. Try creating more predictable patterns.',
        icon: '',
        color: '#6b7280',
      };
  }
}
