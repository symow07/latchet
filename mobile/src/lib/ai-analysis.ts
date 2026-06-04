import { format, subMonths, startOfMonth, endOfMonth, subDays, addMonths } from 'date-fns';
import { calculateHealthScore, getPersonalityDescription, type HealthScoreResult } from './health-score';
import { api } from './api/api';

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

export interface Settings {
  monthlyBudget: number;
  startingBalance: number;
  hourlyValue: number;
  showTimeCost: number;
  monthlyIncome: number;
  savingsGoal: number;
  spendingStyle: string;
  primaryGoal: string;
  currencySymbol: string;
  currency: string;
}

export interface SavingsForecast {
  month: string;
  projectedSavings: number;
  projectedBalance: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CategoryBudgetSuggestion {
  category: string;
  currentSpending: number;
  suggestedBudget: number;
  potentialSavings: number;
  reason: string;
}

export interface SpendingAnalysis {
  currentMonthByCategory: Record<string, number>;
  previousMonthByCategory: Record<string, number>;
  overspendingCategories: string[];
  underspendingCategories: string[];
  spendingSpikes: { date: string; amount: number; category: string }[];
  averageDailySpend: number;
  projectedMonthEndBalance: number;
  impulseSpendingTotal: number;
  impulsePercentage: number;
  savingsRate: number;
  budgetUsagePercentage: number;
  topExpenseCategories: { category: string; amount: number; percentage: number }[];
  weekOverWeekChange: number;
  daysUntilBudgetExceeded: number | null;
  consecutiveDaysOfSpending: number;
  biggestExpenseThisMonth: { amount: number; category: string; note?: string } | null;
  // New enhanced fields
  healthScore: HealthScoreResult;
  savingsForecast: SavingsForecast[];
  categoryBudgetSuggestions: CategoryBudgetSuggestion[];
  longTermProjection: {
    sixMonthBalance: number;
    oneYearBalance: number;
    savingsGoalReachDate: string | null;
  };
}

export function analyzeSpending(
  transactions: Transaction[],
  settings: Settings
): SpendingAnalysis {
  const today = new Date();
  const currentMonthStart = format(startOfMonth(today), 'yyyy-MM-dd');
  const currentMonthEnd = format(endOfMonth(today), 'yyyy-MM-dd');
  const previousMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');
  const previousMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(today, 30), 'yyyy-MM-dd');

  // Current month transactions
  const currentMonthTxs = transactions.filter(
    tx => tx.dateISO >= currentMonthStart && tx.dateISO <= currentMonthEnd
  );

  // Previous month transactions
  const previousMonthTxs = transactions.filter(
    tx => tx.dateISO >= previousMonthStart && tx.dateISO <= previousMonthEnd
  );

  // Last 30 days transactions
  const last30DaysTxs = transactions.filter(
    tx => tx.dateISO >= thirtyDaysAgo
  );

  // Calculate spending by category for current month
  const currentMonthByCategory: Record<string, number> = {};
  currentMonthTxs
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      currentMonthByCategory[tx.category] = (currentMonthByCategory[tx.category] || 0) + tx.amount;
    });

  // Calculate spending by category for previous month
  const previousMonthByCategory: Record<string, number> = {};
  previousMonthTxs
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      previousMonthByCategory[tx.category] = (previousMonthByCategory[tx.category] || 0) + tx.amount;
    });

  // Find overspending and underspending categories
  const overspendingCategories: string[] = [];
  const underspendingCategories: string[] = [];

  Object.keys(currentMonthByCategory).forEach(category => {
    const current = currentMonthByCategory[category] || 0;
    const previous = previousMonthByCategory[category] || 0;

    if (previous > 0) {
      const changePercent = ((current - previous) / previous) * 100;
      if (changePercent > 20) {
        overspendingCategories.push(category);
      } else if (changePercent < -20) {
        underspendingCategories.push(category);
      }
    }
  });

  // Detect spending spikes (single day spending > 2x average)
  const dailySpending: Record<string, { total: number; transactions: Transaction[] }> = {};
  last30DaysTxs
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      if (!dailySpending[tx.dateISO]) {
        dailySpending[tx.dateISO] = { total: 0, transactions: [] };
      }
      dailySpending[tx.dateISO].total += tx.amount;
      dailySpending[tx.dateISO].transactions.push(tx);
    });

  const dailyAmounts = Object.values(dailySpending).map(d => d.total);
  const avgDaily = dailyAmounts.length > 0
    ? dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length
    : 0;

  const spendingSpikes: { date: string; amount: number; category: string }[] = [];
  Object.entries(dailySpending).forEach(([date, data]) => {
    if (data.total > avgDaily * 2 && avgDaily > 0) {
      // Find the biggest transaction that day
      const biggestTx = data.transactions.sort((a, b) => b.amount - a.amount)[0];
      spendingSpikes.push({
        date,
        amount: data.total,
        category: biggestTx?.category || 'Unknown',
      });
    }
  });

  // Calculate current month totals
  const currentMonthExpenses = currentMonthTxs
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const currentMonthIncome = currentMonthTxs
    .filter(tx => tx.type === 'Income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  // Impulse spending analysis
  const impulseTransactions = last30DaysTxs.filter(tx => tx.type === 'Expense' && tx.isImpulse);
  const impulseSpendingTotal = impulseTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpenses30Days = last30DaysTxs
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const impulsePercentage = totalExpenses30Days > 0
    ? (impulseSpendingTotal / totalExpenses30Days) * 100
    : 0;

  // Budget usage
  const monthlyBudgetSafe = Number(settings.monthlyBudget) || 0;
  const monthlyIncomeSafe = Number(settings.monthlyIncome) || 0;
  const budgetUsagePercentage = monthlyBudgetSafe > 0
    ? (currentMonthExpenses / monthlyBudgetSafe) * 100
    : 0;

  // Savings rate
  const totalIncome = monthlyIncomeSafe > 0 ? monthlyIncomeSafe : currentMonthIncome;
  const savingsRate = totalIncome > 0
    ? ((totalIncome - currentMonthExpenses) / totalIncome) * 100
    : 0;

  // Project end of month balance
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - dayOfMonth;
  const projectedAdditionalSpending = avgDaily * remainingDays;

  const currentBalance = transactions.reduce((bal, tx) => {
    return tx.type === 'Income' ? bal + tx.amount : bal - tx.amount;
  }, Number(settings.startingBalance) || 0);

  const projectedMonthEndBalance = currentBalance - projectedAdditionalSpending;

  // Top expense categories
  const sortedCategories = Object.entries(currentMonthByCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: currentMonthExpenses > 0 ? (amount / currentMonthExpenses) * 100 : 0,
    }));

  // Week over week change
  const thisWeekStart = format(subDays(today, 7), 'yyyy-MM-dd');
  const lastWeekStart = format(subDays(today, 14), 'yyyy-MM-dd');
  const lastWeekEnd = format(subDays(today, 8), 'yyyy-MM-dd');

  const thisWeekSpending = transactions
    .filter(tx => tx.type === 'Expense' && tx.dateISO >= thisWeekStart)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const lastWeekSpending = transactions
    .filter(tx => tx.type === 'Expense' && tx.dateISO >= lastWeekStart && tx.dateISO <= lastWeekEnd)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const weekOverWeekChange = lastWeekSpending > 0
    ? ((thisWeekSpending - lastWeekSpending) / lastWeekSpending) * 100
    : 0;

  // Days until budget exceeded
  let daysUntilBudgetExceeded: number | null = null;
  if (monthlyBudgetSafe > 0 && avgDaily > 0) {
    const remainingBudget = monthlyBudgetSafe - currentMonthExpenses;
    if (remainingBudget > 0) {
      daysUntilBudgetExceeded = Math.floor(remainingBudget / avgDaily);
    } else {
      daysUntilBudgetExceeded = 0; // Already exceeded
    }
  }

  // Consecutive days of spending
  let consecutiveDays = 0;
  for (let i = 0; i < 30; i++) {
    const checkDate = format(subDays(today, i), 'yyyy-MM-dd');
    const hasSpending = transactions.some(tx => tx.dateISO === checkDate && tx.type === 'Expense');
    if (hasSpending) {
      consecutiveDays++;
    } else if (i > 0) {
      break;
    }
  }

  // Biggest expense this month
  const biggestExpense = currentMonthTxs
    .filter(tx => tx.type === 'Expense')
    .sort((a, b) => b.amount - a.amount)[0];

  // Calculate health score
  const healthScore = calculateHealthScore(transactions, settings);

  // Generate savings forecast (6 months)
  const safeDayOfMonth = Math.max(1, dayOfMonth); // Prevent division by zero
  const monthlyNetSavings = (monthlyIncomeSafe || currentMonthIncome) - (currentMonthExpenses / safeDayOfMonth * 30);
  const savingsForecast: SavingsForecast[] = [];
  let runningBalance = currentBalance;

  for (let i = 1; i <= 6; i++) {
    const forecastMonth = addMonths(today, i);
    runningBalance += monthlyNetSavings;
    savingsForecast.push({
      month: format(forecastMonth, 'MMM yyyy'),
      projectedSavings: monthlyNetSavings,
      projectedBalance: runningBalance,
      confidence: i <= 2 ? 'high' : i <= 4 ? 'medium' : 'low',
    });
  }

  // Generate category budget suggestions
  const categoryBudgetSuggestions: CategoryBudgetSuggestion[] = sortedCategories.slice(0, 3).map(cat => {
    const prevAmount = previousMonthByCategory[cat.category] || cat.amount;
    const avgAmount = (cat.amount + prevAmount) / 2;
    const suggestedBudget = Math.round(avgAmount * 0.9); // Suggest 10% reduction
    const potentialSavings = cat.amount - suggestedBudget;

    let reason = '';
    if (cat.amount > prevAmount * 1.2) {
      reason = 'Spending increased significantly this month';
    } else if (cat.percentage > 30) {
      reason = 'This category takes a large portion of your budget';
    } else {
      reason = 'Small reductions here can add up over time';
    }

    return {
      category: cat.category,
      currentSpending: cat.amount,
      suggestedBudget,
      potentialSavings: Math.max(0, potentialSavings),
      reason,
    };
  }).filter(s => s.potentialSavings > 0);

  // Long term projections
  const sixMonthBalance = currentBalance + (monthlyNetSavings * 6);
  const oneYearBalance = currentBalance + (monthlyNetSavings * 12);

  let savingsGoalReachDate: string | null = null;
  const savingsGoalSafe = Number(settings.savingsGoal) || 0;
  if (savingsGoalSafe > 0 && monthlyNetSavings > 0) {
    const monthsToGoal = Math.ceil(savingsGoalSafe / monthlyNetSavings);
    if (monthsToGoal <= 24) {
      savingsGoalReachDate = format(addMonths(today, monthsToGoal), 'MMMM yyyy');
    }
  }

  return {
    currentMonthByCategory,
    previousMonthByCategory,
    overspendingCategories,
    underspendingCategories,
    spendingSpikes,
    averageDailySpend: avgDaily,
    projectedMonthEndBalance,
    impulseSpendingTotal,
    impulsePercentage,
    savingsRate,
    budgetUsagePercentage,
    topExpenseCategories: sortedCategories,
    weekOverWeekChange,
    daysUntilBudgetExceeded,
    consecutiveDaysOfSpending: consecutiveDays,
    biggestExpenseThisMonth: biggestExpense
      ? { amount: biggestExpense.amount, category: biggestExpense.category, note: biggestExpense.note }
      : null,
    healthScore,
    savingsForecast,
    categoryBudgetSuggestions,
    longTermProjection: {
      sixMonthBalance,
      oneYearBalance,
      savingsGoalReachDate,
    },
  };
}

export function buildAIPrompt(
  analysis: SpendingAnalysis | null,
  settings: Settings | null,
  userMessage: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
): string {
  if (!analysis || !settings) {
    const messages = conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n\n');
    return `You are a friendly AI financial advisor built into a personal budgeting app called "Budget". The user has not added any transactions yet, so you don't have spending data to analyze. Be helpful, friendly, and encourage them to start tracking their expenses to get personalized advice.

CONVERSATION HISTORY:
${messages}

User: ${userMessage}

Respond as the AI financial advisor:`;
  }

  const currencySymbol = settings.currencySymbol || '$';
  const personality = getPersonalityDescription(analysis.healthScore.personalityType);

  // Safely coerce potentially null/undefined numeric settings to numbers
  const monthlyBudget = Number(settings.monthlyBudget) || 0;
  const monthlyIncome = Number(settings.monthlyIncome) || 0;
  const savingsGoal = Number(settings.savingsGoal) || 0;
  const hourlyValue = Number(settings.hourlyValue) || 0;

  const systemContext = `You are a friendly and knowledgeable AI financial advisor built into a personal budgeting app called "Budget". You help users understand and improve their spending habits.

USER'S FINANCIAL PROFILE:
- Monthly Budget: ${currencySymbol}${monthlyBudget.toFixed(2)}
- Monthly Income: ${currencySymbol}${monthlyIncome.toFixed(2)}
- Savings Goal: ${currencySymbol}${savingsGoal.toFixed(2)}
- Spending Style: ${settings.spendingStyle || 'moderate'}
- Primary Goal: ${settings.primaryGoal || 'track spending'}
- Hourly Rate: ${currencySymbol}${hourlyValue.toFixed(2)}/hr

FINANCIAL HEALTH SCORE: ${analysis.healthScore.totalScore}/100 (Grade: ${analysis.healthScore.grade})
- Savings Rate: ${analysis.healthScore.breakdown.savingsRate.score}/${analysis.healthScore.breakdown.savingsRate.maxPoints} pts
- Budget Discipline: ${analysis.healthScore.breakdown.budgetDiscipline.score}/${analysis.healthScore.breakdown.budgetDiscipline.maxPoints} pts
- Spending Consistency: ${analysis.healthScore.breakdown.spendingConsistency.score}/${analysis.healthScore.breakdown.spendingConsistency.maxPoints} pts
- Goal Progress: ${analysis.healthScore.breakdown.goalProgress.score}/${analysis.healthScore.breakdown.goalProgress.maxPoints} pts
- Impulse Control: ${analysis.healthScore.breakdown.impulseControl.score}/${analysis.healthScore.breakdown.impulseControl.maxPoints} pts
- Weekly Trend: ${analysis.healthScore.trend === 'up' ? '↑ Improving' : analysis.healthScore.trend === 'down' ? '↓ Declining' : '→ Stable'}

SPENDING PERSONALITY: "${personality.title}"
${personality.description}

CURRENT SPENDING ANALYSIS:
- Budget Usage: ${analysis.budgetUsagePercentage.toFixed(1)}% of monthly budget used
- Average Daily Spend: ${currencySymbol}${analysis.averageDailySpend.toFixed(2)}
- Projected Month-End Balance: ${currencySymbol}${analysis.projectedMonthEndBalance.toFixed(2)}
- Savings Rate: ${analysis.savingsRate.toFixed(1)}%
- Impulse Purchases: ${analysis.impulsePercentage.toFixed(1)}% of spending (${currencySymbol}${analysis.impulseSpendingTotal.toFixed(2)} total)
- Week-over-Week Change: ${analysis.weekOverWeekChange > 0 ? '+' : ''}${analysis.weekOverWeekChange.toFixed(1)}%
${analysis.daysUntilBudgetExceeded !== null ? `- Days Until Budget Exceeded: ${analysis.daysUntilBudgetExceeded === 0 ? 'ALREADY EXCEEDED' : analysis.daysUntilBudgetExceeded + ' days'}` : ''}

TOP SPENDING CATEGORIES THIS MONTH:
${analysis.topExpenseCategories.map(c => `- ${c.category}: ${currencySymbol}${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}%)`).join('\n')}

${analysis.overspendingCategories.length > 0 ? `OVERSPENDING CATEGORIES (vs last month): ${analysis.overspendingCategories.join(', ')}` : ''}
${analysis.underspendingCategories.length > 0 ? `IMPROVED CATEGORIES (vs last month): ${analysis.underspendingCategories.join(', ')}` : ''}

LONG-TERM PROJECTIONS:
- 6-Month Balance Projection: ${currencySymbol}${analysis.longTermProjection.sixMonthBalance.toFixed(2)}
- 1-Year Balance Projection: ${currencySymbol}${analysis.longTermProjection.oneYearBalance.toFixed(2)}
${analysis.longTermProjection.savingsGoalReachDate ? `- Savings Goal Target Date: ${analysis.longTermProjection.savingsGoalReachDate}` : ''}

${analysis.categoryBudgetSuggestions.length > 0 ? `BUDGET OPTIMIZATION SUGGESTIONS:
${analysis.categoryBudgetSuggestions.map(s => `- ${s.category}: Reduce from ${currencySymbol}${s.currentSpending.toFixed(2)} to ${currencySymbol}${s.suggestedBudget.toFixed(2)} (save ${currencySymbol}${s.potentialSavings.toFixed(2)})`).join('\n')}` : ''}

${analysis.spendingSpikes.length > 0 ? `SPENDING SPIKES DETECTED:
${analysis.spendingSpikes.map(s => `- ${s.date}: ${currencySymbol}${s.amount.toFixed(2)} (${s.category})`).join('\n')}` : ''}

${analysis.biggestExpenseThisMonth ? `BIGGEST EXPENSE THIS MONTH: ${currencySymbol}${analysis.biggestExpenseThisMonth.amount.toFixed(2)} on ${analysis.biggestExpenseThisMonth.category}${analysis.biggestExpenseThisMonth.note ? ` (${analysis.biggestExpenseThisMonth.note})` : ''}` : ''}

GUIDELINES FOR YOUR RESPONSES:
1. Be conversational, friendly, and encouraging - not preachy or judgmental
2. Give specific, actionable advice based on the user's actual data
3. Reference specific numbers, categories, and trends from their spending
4. Consider their spending personality type when giving advice
5. If they're doing well, celebrate their wins!
6. If there are concerns, frame them constructively with solutions
7. Keep responses concise (2-4 short paragraphs max)
8. Use the currency symbol ${currencySymbol} for all amounts
9. When relevant, mention their health score and how to improve it
10. For forecasting questions, use the long-term projections data
11. Adapt your tone based on personality: encouraging for spenders, affirming for savers`;

  const messages = conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n\n');

  return `${systemContext}

CONVERSATION HISTORY:
${messages}

User: ${userMessage}

Respond as the AI financial advisor:`;
}

// Routes through the backend AI proxy (POST /api/ai/chat) so the OpenAI key
// stays server-side and never ships in the mobile bundle. The full prompt is
// assembled on-device by buildAIPrompt(); the second arg is retained for
// call-site compatibility but unused.
export async function getAIResponse(
  prompt: string,
  _apiKey?: string
): Promise<string> {
  const { response } = await api.post<{ response: string }>('/api/ai/chat', { prompt });
  return response;
}

// Quick insights that don't require API call
export function getQuickInsights(analysis: SpendingAnalysis, settings: Settings): string[] {
  const insights: string[] = [];
  const currencySymbol = settings.currencySymbol || '$';
  const monthlyBudgetSafe = Number(settings.monthlyBudget) || 0;

  if (analysis.budgetUsagePercentage >= 100) {
    insights.push(`⚠️ You've exceeded your monthly budget by ${currencySymbol}${(analysis.budgetUsagePercentage / 100 * monthlyBudgetSafe - monthlyBudgetSafe).toFixed(2)}`);
  } else if (analysis.budgetUsagePercentage >= 80) {
    insights.push(`⚡ ${(100 - analysis.budgetUsagePercentage).toFixed(0)}% budget remaining - spend carefully!`);
  }

  if (analysis.impulsePercentage > 30) {
    insights.push(`🛍️ ${analysis.impulsePercentage.toFixed(0)}% impulse purchases - consider a 24hr wait rule`);
  }

  if (analysis.overspendingCategories.length > 0) {
    insights.push(`📈 Spending up in: ${analysis.overspendingCategories.join(', ')}`);
  }

  if (analysis.underspendingCategories.length > 0) {
    insights.push(`✅ Great savings in: ${analysis.underspendingCategories.join(', ')}`);
  }

  if (analysis.savingsRate > 20) {
    insights.push(`💰 Excellent ${analysis.savingsRate.toFixed(0)}% savings rate!`);
  } else if (analysis.savingsRate < 0) {
    insights.push(`⚠️ Spending more than earning this month`);
  }

  if (analysis.weekOverWeekChange > 20) {
    insights.push(`📊 Spending up ${analysis.weekOverWeekChange.toFixed(0)}% vs last week`);
  } else if (analysis.weekOverWeekChange < -20) {
    insights.push(`🎉 Spending down ${Math.abs(analysis.weekOverWeekChange).toFixed(0)}% vs last week!`);
  }

  return insights.slice(0, 4); // Max 4 quick insights
}
