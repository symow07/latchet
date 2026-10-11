import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { detectSubscriptions as detectFromEngine, monthlyCost } from './subscriptions/engine';
import { chargesFromTransactions } from './subscriptions/sources';
import { t, getDateFnsLocale } from './i18n/core';
import { categoryLabel } from './category-meta';
import { formatCurrency, projectMonthlyExpenses } from './calculations';
import {
  dayOfMonth,
  daysAgoISO,
  daysBetween,
  daysInMonth,
  isInCurrentMonth,
  isWithinLastDays,
} from './dates';
import type { Transaction } from './transaction';

/** 1 January 2023 was a Sunday. */
const A_SUNDAY = '2023-01-01';

/**
 * Day of the week (0 = Sunday … 6 = Saturday) of a YYYY-MM-DD string, counted
 * in calendar days and so the same in every timezone. `getDay(new Date(dateISO))`
 * read UTC midnight with local getters: west of Greenwich every Saturday came
 * out as a Friday and every Monday as a Sunday.
 */
function weekdayOf(dateISO: string): number {
  return ((daysBetween(A_SUNDAY, dateISO) % 7) + 7) % 7;
}

const isWeekend = (dateISO: string) => {
  const day = weekdayOf(dateISO);
  return day === 0 || day === 6;
};

// Subscription Detection
export interface DetectedSubscription {
  description: string;
  amount: number;
  category: string;
  frequency: 'weekly' | 'monthly' | 'yearly';
  lastCharged: string;
  nextExpected: string;
  occurrences: number;
  totalSpent: number;
}

/** The shared engine's detections with a known cadence. */
function recurringDetections(transactions: Transaction[]) {
  return detectFromEngine(chargesFromTransactions(transactions)).filter(
    (s) => s.cadence !== 'unknown'
  );
}

/**
 * Recurring charges, for the analytics screen.
 *
 * This used to be a second, cruder detector — it grouped by rounded amount plus
 * the first word of the note, and fell back to the category when the note was
 * empty, so it disagreed with the subscriptions screen about the same data. It
 * is now a view over the shared engine.
 */
export function detectSubscriptions(transactions: Transaction[]): DetectedSubscription[] {
  return toAnalyticsView(recurringDetections(transactions));
}

function toAnalyticsView(
  detections: ReturnType<typeof recurringDetections>
): DetectedSubscription[] {
  return detections
    .map((s) => ({
      description: s.merchantDisplay,
      amount: s.typicalAmount,
      category: s.category,
      frequency: s.cadence as 'weekly' | 'monthly' | 'yearly',
      lastCharged: s.lastChargedAt,
      nextExpected: s.nextExpectedAt,
      occurrences: s.occurrences.length,
      totalSpent: s.totalSpent,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// Duplicate Charge Detection
export interface DuplicateCharge {
  transactions: Transaction[];
  amount: number;
  description: string;
  date: string;
  potentialRefund: number;
}

export function detectDuplicateCharges(transactions: Transaction[]): DuplicateCharge[] {
  const duplicates: DuplicateCharge[] = [];

  // Group by date
  const byDate: Record<string, Transaction[]> = {};
  transactions
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      if (!byDate[tx.dateISO]) byDate[tx.dateISO] = [];
      byDate[tx.dateISO].push(tx);
    });

  // Find duplicates on same day with same amount
  Object.entries(byDate).forEach(([date, txs]) => {
    const amountGroups: Record<number, Transaction[]> = {};

    txs.forEach(tx => {
      const key = Math.round(tx.amount * 100);
      if (!amountGroups[key]) amountGroups[key] = [];
      amountGroups[key].push(tx);
    });

    Object.values(amountGroups).forEach(group => {
      if (group.length < 2) return;

      // Within a same-day, same-amount group, only charges that look like the
      // same merchant are duplicates of each other. Each charge joins the first
      // cluster whose first charge it resembles: reporting the whole group
      // swept a different merchant's same-priced charge into the refund, and a
      // pair that did not include the group's first charge was never found.
      const clusters: Transaction[][] = [];
      group.forEach(tx => {
        const cluster = clusters.find(c => similarDescriptions(c[0], tx));
        if (cluster) cluster.push(tx);
        else clusters.push([tx]);
      });

      clusters
        .filter(cluster => cluster.length > 1)
        .forEach(cluster => {
          duplicates.push({
            transactions: cluster,
            amount: cluster[0].amount,
            description: descriptionOf(cluster[0]),
            date,
            potentialRefund: cluster[0].amount * (cluster.length - 1),
          });
        });
    });
  });

  return duplicates;
}

/** The note, trimmed, or the category when there is none. */
function descriptionOf(tx: Transaction): string {
  return tx.note?.trim() || tx.category;
}

/**
 * Same first word either way round. Trimmed first: a note with a leading space
 * has an empty first word, which every other description "contains".
 */
function similarDescriptions(a: Transaction, b: Transaction): boolean {
  const descA = descriptionOf(a).toLowerCase();
  const descB = descriptionOf(b).toLowerCase();
  return descB.includes(descA.split(/\s+/)[0]) || descA.includes(descB.split(/\s+/)[0]);
}

// Unusual Transaction Detection
export interface UnusualTransaction {
  transaction: Transaction;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  averageForCategory: number;
  deviation: number;
}

export function detectUnusualTransactions(transactions: Transaction[]): UnusualTransaction[] {
  const unusual: UnusualTransaction[] = [];

  // Calculate category averages
  const categoryStats: Record<string, { total: number; count: number; amounts: number[] }> = {};

  transactions
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      if (!categoryStats[tx.category]) {
        categoryStats[tx.category] = { total: 0, count: 0, amounts: [] };
      }
      categoryStats[tx.category].total += tx.amount;
      categoryStats[tx.category].count++;
      categoryStats[tx.category].amounts.push(tx.amount);
    });

  // Calculate mean and standard deviation for each category
  Object.keys(categoryStats).forEach(category => {
    const stats = categoryStats[category];
    const mean = stats.total / stats.count;
    const variance = stats.amounts.reduce((sum, amt) => sum + Math.pow(amt - mean, 2), 0) / stats.count;
    // σ is floored at 10% of the average: in a near-constant category (a
    // subscription, a fare) σ is tiny and a price rise of cents measured as
    // three or four σ — an alert for nothing.
    const stdDev = Math.max(Math.sqrt(variance), mean * 0.1);

    // Find transactions more than 2 standard deviations from mean
    transactions
      .filter(tx => tx.type === 'Expense' && tx.category === category)
      .forEach(tx => {
        const deviation = (tx.amount - mean) / (stdDev || 1);

        if (deviation > 2) {
          let severity: 'low' | 'medium' | 'high' = 'low';
          let reason = '';

          if (deviation > 4) {
            severity = 'high';
            // "N× higher than your typical purchase" is the multiple of the
            // average, not the σ count (which said 4× for a purchase 7× the norm).
            reason = t('analytics.reasonMultiple', {
              times: Math.round(tx.amount / mean),
              category: categoryLabel(category),
            });
          } else if (deviation > 3) {
            severity = 'medium';
            reason = t('analytics.reasonSignificant', { category: categoryLabel(category) });
          } else {
            reason = t('analytics.reasonAbove', { category: categoryLabel(category) });
          }

          unusual.push({
            transaction: tx,
            reason,
            severity,
            averageForCategory: mean,
            deviation,
          });
        }
      });
  });

  return unusual.sort((a, b) => b.deviation - a.deviation).slice(0, 10);
}

// Weekend/Seasonal Spending Analysis
export interface SpendingPattern {
  type: 'weekend' | 'weekday' | 'seasonal';
  period: string;
  totalSpent: number;
  averageTransaction: number;
  transactionCount: number;
  topCategories: { category: string; amount: number }[];
  /** Seasonal patterns only: the projected total for this month. */
  projectedTotal?: number;
  insight: string;
}

export function analyzeSpendingPatterns(
  transactions: Transaction[],
  now: Date = new Date()
): SpendingPattern[] {
  const patterns: SpendingPattern[] = [];
  const today = now;

  // The last 30 days, today included, and nothing future-dated.
  const recentTxs = transactions.filter(
    tx => tx.type === 'Expense' && isWithinLastDays(tx.dateISO, 30, now)
  );

  // Weekend vs Weekday analysis
  const weekendTxs = recentTxs.filter(tx => isWeekend(tx.dateISO));
  const weekdayTxs = recentTxs.filter(tx => !isWeekend(tx.dateISO));

  const weekendTotal = weekendTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const weekdayTotal = weekdayTxs.reduce((sum, tx) => sum + tx.amount, 0);

  // Per-day averages over the weekend days and weekdays the window actually
  // holds (8 to 10 of the 30 are weekend days, depending on today).
  let weekendDays = 0;
  for (let i = 0; i < 30; i++) if (isWeekend(daysAgoISO(i, now))) weekendDays++;
  const weekendDailyAvg = weekendTotal / weekendDays;
  const weekdayDailyAvg = weekdayTotal / (30 - weekendDays);

  // Needs weekday spending to compare against, as the month comparison needs
  // last month: weekend-only spending used to read "Infinity% more".
  if (weekdayTotal > 0 && weekendDailyAvg > weekdayDailyAvg * 1.3) {
    const weekendCategories = getTopCategories(weekendTxs, 3);
    patterns.push({
      type: 'weekend',
      period: t('analytics.periodLast30'),
      totalSpent: weekendTotal,
      averageTransaction: weekendTotal / (weekendTxs.length || 1),
      transactionCount: weekendTxs.length,
      topCategories: weekendCategories,
      insight: t('analytics.weekendInsight', {
        pct: Math.round((weekendDailyAvg / weekdayDailyAvg - 1) * 100),
        categories: weekendCategories.map(c => categoryLabel(c.category)).join(', '),
      }),
    });
  }

  // Monthly comparison (this month vs last month)
  const lastMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');

  // This calendar month only: a future-dated expense next month is not this month's.
  const thisMonthTxs = transactions.filter(
    tx => tx.type === 'Expense' && isInCurrentMonth(tx.dateISO, now)
  );
  const lastMonthTxs = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= lastMonthStart && tx.dateISO <= lastMonthEnd
  );

  const thisMonthTotal = thisMonthTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const lastMonthTotal = lastMonthTxs.reduce((sum, tx) => sum + tx.amount, 0);

  if (lastMonthTotal > 0 && thisMonthTotal > lastMonthTotal * 1.2) {
    // The app's one month-end projection: the month's own run rate over its
    // real length, leaning on last month while only a few days are in. This
    // was (spent / day) × 30, which on the 3rd multiplied three days by 30.
    const projectedTotal = projectMonthlyExpenses({
      currentMonthExpenses: thisMonthTotal,
      dayOfMonth: dayOfMonth(now),
      daysInMonth: daysInMonth(now),
      previousMonthExpenses: lastMonthTotal,
    });

    patterns.push({
      type: 'seasonal',
      // The month in the reader's language ('LLLL' is the standalone name).
      period: format(today, 'LLLL yyyy', { locale: getDateFnsLocale() }),
      totalSpent: thisMonthTotal,
      averageTransaction: thisMonthTotal / (thisMonthTxs.length || 1),
      transactionCount: thisMonthTxs.length,
      topCategories: getTopCategories(thisMonthTxs, 3),
      projectedTotal,
      insight: t('analytics.seasonalInsight', {
        pct: Math.round((thisMonthTotal / lastMonthTotal - 1) * 100),
        // In the user's currency and number format; this was a hard-coded $.
        projected: formatCurrency(projectedTotal),
      }),
    });
  }

  return patterns;
}

// Top Waste Categories
export interface WasteCategory {
  category: string;
  totalSpent: number;
  impulseSpent: number;
  impulsePercentage: number;
  transactionCount: number;
  averageTransaction: number;
  potentialSavings: number;
  tip: string;
}

export function getTopWasteCategories(
  transactions: Transaction[],
  now: Date = new Date()
): WasteCategory[] {
  // This calendar month only (a future-dated expense next month used to count).
  const monthTxs = transactions.filter(
    tx => tx.type === 'Expense' && isInCurrentMonth(tx.dateISO, now)
  );

  // Group by category
  const categoryData: Record<string, { total: number; impulse: number; count: number }> = {};

  monthTxs.forEach(tx => {
    if (!categoryData[tx.category]) {
      categoryData[tx.category] = { total: 0, impulse: 0, count: 0 };
    }
    categoryData[tx.category].total += tx.amount;
    categoryData[tx.category].count++;
    if (tx.isImpulse) {
      categoryData[tx.category].impulse += tx.amount;
    }
  });

  const wasteCategories: WasteCategory[] = Object.entries(categoryData)
    .map(([category, data]) => {
      // A category of zero-amount rows has no impulse share (not NaN%).
      const impulsePercentage = data.total > 0 ? (data.impulse / data.total) * 100 : 0;
      const potentialSavings = data.impulse * 0.5; // Assume 50% of impulse could be saved

      let tip = '';
      if (category === 'Food' && impulsePercentage > 30) {
        tip = t('analytics.tipFood');
      } else if (category === 'Shopping' && impulsePercentage > 40) {
        tip = t('analytics.tipShopping');
      } else if (category === 'Subscriptions') {
        tip = t('analytics.tipSubscriptions');
      } else if (category === 'Transport' && data.total > 200) {
        tip = t('analytics.tipTransport');
      } else if (impulsePercentage > 50) {
        tip = t('analytics.tipImpulse', { pct: Math.round(impulsePercentage), category: categoryLabel(category) });
      } else {
        tip = t('analytics.tipTrack', { category: categoryLabel(category) });
      }

      return {
        category,
        totalSpent: data.total,
        impulseSpent: data.impulse,
        impulsePercentage,
        transactionCount: data.count,
        averageTransaction: data.total / data.count,
        potentialSavings,
        tip,
      };
    })
    .sort((a, b) => {
      // Sort by waste potential (impulse spending + high spending)
      const scoreA = a.impulseSpent + (a.totalSpent * 0.3);
      const scoreB = b.impulseSpent + (b.totalSpent * 0.3);
      return scoreB - scoreA;
    })
    .slice(0, 3);

  return wasteCategories;
}

// Helper function
function getTopCategories(transactions: Transaction[], limit: number): { category: string; amount: number }[] {
  const categoryTotals: Record<string, number> = {};

  transactions.forEach(tx => {
    categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
  });

  return Object.entries(categoryTotals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// Overdue bills
/**
 * How many unpaid bills are past due on `todayISO` — Bill Reminders' "· N
 * overdue". A bill due today is due, not overdue: counting it (days ≤ 0) put
 * "1 bill to pay · 1 overdue" over a bill that was simply due that day, while
 * its own row said "Due today". Compared as calendar dates, so it is the same
 * in every timezone.
 */
export function overdueBillCount(
  bills: readonly { isPaid: boolean; nextDueDate: string }[],
  todayISO: string
): number {
  return bills.filter((b) => !b.isPaid && b.nextDueDate.slice(0, 10) < todayISO).length;
}

// Full Analytics Summary
export interface AnalyticsSummary {
  subscriptions: DetectedSubscription[];
  duplicateCharges: DuplicateCharge[];
  unusualTransactions: UnusualTransaction[];
  spendingPatterns: SpendingPattern[];
  wasteCategories: WasteCategory[];
  totalMonthlySubscriptions: number;
  potentialMonthlySavings: number;
  alertCount: number;
}

export function generateAnalyticsSummary(
  transactions: Transaction[],
  now: Date = new Date()
): AnalyticsSummary {
  const recurring = recurringDetections(transactions);
  const subscriptions = toAnalyticsView(recurring);
  const duplicateCharges = detectDuplicateCharges(transactions);
  const unusualTransactions = detectUnusualTransactions(transactions);
  const spendingPatterns = analyzeSpendingPatterns(transactions, now);
  const wasteCategories = getTopWasteCategories(transactions, now);

  // Weekly and yearly charges converted to a month, as the subscriptions
  // screens do; this used to add the monthly ones only.
  const totalMonthlySubscriptions = monthlyCost(recurring);

  const potentialMonthlySavings =
    wasteCategories.reduce((sum, w) => sum + w.potentialSavings, 0) +
    duplicateCharges.reduce((sum, d) => sum + d.potentialRefund, 0);

  const alertCount =
    duplicateCharges.length +
    unusualTransactions.filter(u => u.severity === 'high').length;

  return {
    subscriptions,
    duplicateCharges,
    unusualTransactions,
    spendingPatterns,
    wasteCategories,
    totalMonthlySubscriptions,
    potentialMonthlySavings,
    alertCount,
  };
}
