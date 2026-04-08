import { format, subDays, subMonths, startOfMonth, endOfMonth, getDay, differenceInDays } from 'date-fns';

export interface Transaction {
  id: string;
  amount: number;
  category: string;
  type: string;
  isImpulse: number;
  note?: string;
  dateISO: string;
  createdAt: string;
}

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

export function detectSubscriptions(transactions: Transaction[]): DetectedSubscription[] {
  const subscriptions: DetectedSubscription[] = [];

  // Group transactions by similar amounts and descriptions
  const grouped: Record<string, Transaction[]> = {};

  transactions
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      // Create a key based on amount (rounded) and first word of note
      const amountKey = Math.round(tx.amount * 100) / 100;
      const descKey = (tx.note || tx.category).toLowerCase().split(' ')[0];
      const key = `${amountKey}_${descKey}`;

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(tx);
    });

  // Analyze each group for recurring patterns
  Object.entries(grouped).forEach(([key, txs]) => {
    if (txs.length < 2) return;

    // Sort by date
    const sorted = [...txs].sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    // Calculate intervals between transactions
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = differenceInDays(
        new Date(sorted[i].dateISO),
        new Date(sorted[i - 1].dateISO)
      );
      intervals.push(days);
    }

    if (intervals.length === 0) return;

    // Determine average interval
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Detect frequency
    let frequency: 'weekly' | 'monthly' | 'yearly' | null = null;
    if (avgInterval >= 5 && avgInterval <= 10) frequency = 'weekly';
    else if (avgInterval >= 25 && avgInterval <= 35) frequency = 'monthly';
    else if (avgInterval >= 350 && avgInterval <= 380) frequency = 'yearly';

    if (!frequency) return;

    // Calculate next expected date
    const lastTx = sorted[sorted.length - 1];
    const daysToAdd = frequency === 'weekly' ? 7 : frequency === 'monthly' ? 30 : 365;
    const nextDate = new Date(lastTx.dateISO);
    nextDate.setDate(nextDate.getDate() + daysToAdd);

    subscriptions.push({
      description: lastTx.note || lastTx.category,
      amount: lastTx.amount,
      category: lastTx.category,
      frequency,
      lastCharged: lastTx.dateISO,
      nextExpected: format(nextDate, 'yyyy-MM-dd'),
      occurrences: txs.length,
      totalSpent: txs.reduce((sum, t) => sum + t.amount, 0),
    });
  });

  return subscriptions.sort((a, b) => b.amount - a.amount);
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
            reason = `${Math.round(deviation)}x higher than your typical ${category} purchase`;
          } else if (deviation > 3) {
            severity = 'medium';
            reason = `Significantly higher than your average ${category} spending`;
          } else {
            reason = `Above average for ${category}`;
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
      period: 'Last 30 days',
      totalSpent: weekendTotal,
      averageTransaction: weekendTotal / (weekendTxs.length || 1),
      transactionCount: weekendTxs.length,
      topCategories: weekendCategories,
      insight: `You spend ${Math.round((weekendDailyAvg / weekdayDailyAvg - 1) * 100)}% more on weekends. Top weekend expenses: ${weekendCategories.map(c => c.category).join(', ')}`,
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
      insight: `Spending is up ${Math.round((thisMonthTotal / lastMonthTotal - 1) * 100)}% compared to last month. Projected total: $${projectedTotal.toFixed(0)}`,
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
        tip = 'Try meal prepping to reduce food delivery impulse buys';
      } else if (category === 'Shopping' && impulsePercentage > 40) {
        tip = 'Use a 24-hour rule before making non-essential purchases';
      } else if (category === 'Subscriptions') {
        tip = 'Review subscriptions - cancel ones you haven\'t used in 30 days';
      } else if (category === 'Transport' && data.total > 200) {
        tip = 'Consider carpooling or public transit to cut costs';
      } else if (impulsePercentage > 50) {
        tip = `${Math.round(impulsePercentage)}% of ${category} spending is impulse - set a category budget`;
      } else {
        tip = `Track ${category} spending more closely to identify savings`;
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
