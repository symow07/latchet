import { format, subDays, subMonths, startOfMonth, endOfMonth, getDay } from 'date-fns';
import { detectSubscriptions as detectFromEngine } from './subscriptions/engine';
import { chargesFromTransactions } from './subscriptions/sources';
import { t } from './i18n/core';
import { categoryLabel } from './category-meta';
import type { Transaction } from './transaction';

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

/**
 * Recurring charges, for the analytics screen.
 *
 * This used to be a second, cruder detector — it grouped by rounded amount plus
 * the first word of the note, and fell back to the category when the note was
 * empty, so it disagreed with the subscriptions screen about the same data. It
 * is now a view over the shared engine.
 */
export function detectSubscriptions(transactions: Transaction[]): DetectedSubscription[] {
  return detectFromEngine(chargesFromTransactions(transactions))
    .filter((s) => s.cadence !== 'unknown')
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

    Object.entries(amountGroups).forEach(([amount, group]) => {
      if (group.length > 1) {
        // Check if descriptions are similar
        const firstDesc = (group[0].note || group[0].category).toLowerCase();
        const similarCount = group.filter(tx => {
          const desc = (tx.note || tx.category).toLowerCase();
          return desc.includes(firstDesc.split(' ')[0]) || firstDesc.includes(desc.split(' ')[0]);
        }).length;

        if (similarCount > 1) {
          duplicates.push({
            transactions: group,
            amount: group[0].amount,
            description: group[0].note || group[0].category,
            date,
            potentialRefund: group[0].amount * (group.length - 1),
          });
        }
      }
    });
  });

  return duplicates;
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
    const stdDev = Math.sqrt(variance);

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
            reason = t('analytics.reasonMultiple', {
              times: Math.round(deviation),
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
  insight: string;
}

export function analyzeSpendingPatterns(transactions: Transaction[]): SpendingPattern[] {
  const patterns: SpendingPattern[] = [];
  const today = new Date();
  const thirtyDaysAgo = format(subDays(today, 30), 'yyyy-MM-dd');

  const recentTxs = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= thirtyDaysAgo
  );

  // Weekend vs Weekday analysis
  const weekendTxs = recentTxs.filter(tx => {
    const day = getDay(new Date(tx.dateISO));
    return day === 0 || day === 6; // Sunday or Saturday
  });

  const weekdayTxs = recentTxs.filter(tx => {
    const day = getDay(new Date(tx.dateISO));
    return day !== 0 && day !== 6;
  });

  const weekendTotal = weekendTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const weekdayTotal = weekdayTxs.reduce((sum, tx) => sum + tx.amount, 0);

  // Weekend days in 30 days ≈ 8-9, weekdays ≈ 21-22
  const weekendDailyAvg = weekendTotal / 8;
  const weekdayDailyAvg = weekdayTotal / 22;

  if (weekendDailyAvg > weekdayDailyAvg * 1.3) {
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
  const thisMonth = format(startOfMonth(today), 'yyyy-MM-dd');
  const lastMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');

  const thisMonthTxs = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= thisMonth
  );
  const lastMonthTxs = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= lastMonthStart && tx.dateISO <= lastMonthEnd
  );

  const thisMonthTotal = thisMonthTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const lastMonthTotal = lastMonthTxs.reduce((sum, tx) => sum + tx.amount, 0);

  if (lastMonthTotal > 0 && thisMonthTotal > lastMonthTotal * 1.2) {
    const dayOfMonth = today.getDate();
    const projectedTotal = (thisMonthTotal / dayOfMonth) * 30;

    patterns.push({
      type: 'seasonal',
      period: format(today, 'MMMM yyyy'),
      totalSpent: thisMonthTotal,
      averageTransaction: thisMonthTotal / (thisMonthTxs.length || 1),
      transactionCount: thisMonthTxs.length,
      topCategories: getTopCategories(thisMonthTxs, 3),
      insight: t('analytics.seasonalInsight', {
        pct: Math.round((thisMonthTotal / lastMonthTotal - 1) * 100),
        projected: `$${projectedTotal.toFixed(0)}`,
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

export function getTopWasteCategories(transactions: Transaction[]): WasteCategory[] {
  const today = new Date();
  const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');

  const monthTxs = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= monthStart
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
      const impulsePercentage = (data.impulse / data.total) * 100;
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

export function generateAnalyticsSummary(transactions: Transaction[]): AnalyticsSummary {
  const subscriptions = detectSubscriptions(transactions);
  const duplicateCharges = detectDuplicateCharges(transactions);
  const unusualTransactions = detectUnusualTransactions(transactions);
  const spendingPatterns = analyzeSpendingPatterns(transactions);
  const wasteCategories = getTopWasteCategories(transactions);

  const totalMonthlySubscriptions = subscriptions
    .filter(s => s.frequency === 'monthly')
    .reduce((sum, s) => sum + s.amount, 0);

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
