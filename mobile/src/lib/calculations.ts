import { format, startOfDay, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { todayISO, daysAgoISO, daysBetween } from './dates';

export interface DailySpending {
  date: string;
  amount: number;
}

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

export function getDateRange(days: number): { start: string; end: string } {
  const today = startOfDay(new Date());
  const start = subDays(today, days - 1);
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(today, 'yyyy-MM-dd'),
  };
}

export function getMonthRange(): { start: string; end: string } {
  const today = new Date();
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  };
}

export function calculateTodaySpent(transactions: Transaction[]): number {
  const today = format(new Date(), 'yyyy-MM-dd');
  return transactions
    .filter(tx => tx.type === 'Expense' && tx.dateISO === today)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export function calculateWeekSpent(transactions: Transaction[]): number {
  const { start, end } = getDateRange(7);
  return transactions
    .filter(tx => tx.type === 'Expense' && tx.dateISO >= start && tx.dateISO <= end)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export function calculateMonthSpent(transactions: Transaction[]): number {
  const { start, end } = getMonthRange();
  return transactions
    .filter(tx => tx.type === 'Expense' && tx.dateISO >= start && tx.dateISO <= end)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export function calculateTotalIncome(transactions: Transaction[]): number {
  const { start, end } = getMonthRange();
  return transactions
    .filter(tx => tx.type === 'Income' && tx.dateISO >= start && tx.dateISO <= end)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export function calculateBalance(
  startingBalance: number,
  transactions: Transaction[]
): number {
  const income = transactions
    .filter(tx => tx.type === 'Income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const expenses = transactions
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  return startingBalance + income - expenses;
}

/**
 * Minimum days of history before a daily run-rate means anything.
 *
 * Below this, one purchase dominates the average and every figure derived from
 * it — survival days, month-end projection, six-month forecast — is noise
 * presented as fact.
 */
export const MIN_HISTORY_DAYS = 7;

/**
 * How many days of history the data actually covers, capped at `window`.
 *
 * Dividing by a constant 30 regardless of how long the account has existed was
 * the bug: a two-day-old account with $60 of spending reported $2/day, and
 * survival days then claimed roughly two years of runway.
 */
export function getHistorySpanDays(transactions: Transaction[], window = 30): number {
  const today = todayISO();
  const windowStart = daysAgoISO(window - 1);

  let earliest: string | null = null;
  for (const tx of transactions) {
    if (tx.dateISO > today) continue;
    if (earliest === null || tx.dateISO < earliest) earliest = tx.dateISO;
  }
  if (earliest === null) return 0;

  const from = earliest > windowStart ? earliest : windowStart;
  return Math.min(window, daysBetween(from, today) + 1);
}

/** True once there is enough history to extrapolate from. */
export function hasEnoughHistory(transactions: Transaction[]): boolean {
  return getHistorySpanDays(transactions) >= MIN_HISTORY_DAYS;
}

export function calculateAverageDailySpend(transactions: Transaction[]): number {
  const { start, end } = getDateRange(30);
  const filtered = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= start && tx.dateISO <= end
  );

  if (filtered.length === 0) return 0;

  const total = filtered.reduce((sum, tx) => sum + tx.amount, 0);
  // Divide by the days actually observed, not a flat 30.
  const days = Math.max(1, getHistorySpanDays(transactions, 30));

  return total / days;
}

/**
 * Project a full month's expenses from a partial month.
 *
 * Naively scaling the month to date (`spent / dayOfMonth * daysInMonth`) is
 * violently unstable early on — on the 1st, a single $200 purchase implies
 * $6,000 for the month. Weight the current month by how much of it has actually
 * happened and let last month's actual carry the rest, until two weeks in when
 * the current month can stand alone.
 */
export function projectMonthlyExpenses(params: {
  currentMonthExpenses: number;
  dayOfMonth: number;
  daysInMonth: number;
  previousMonthExpenses: number;
}): number {
  const { currentMonthExpenses, daysInMonth, previousMonthExpenses } = params;
  const day = Math.max(1, params.dayOfMonth);

  const runRate = (currentMonthExpenses / day) * daysInMonth;
  if (previousMonthExpenses <= 0) return runRate;

  const currentWeight = Math.min(1, day / 14);
  return runRate * currentWeight + previousMonthExpenses * (1 - currentWeight);
}

/**
 * Days of runway at the current burn rate, or null when the number would be
 * meaningless — no spending at all, or not enough history to have a rate.
 *
 * Previously returned Infinity for the no-spending case, which the dashboard
 * tested for with `=== 999` and therefore rendered literally as "Infinity days".
 */
export function calculateSurvivalDays(
  currentBalance: number,
  averageDailySpend: number
): number | null {
  if (!isFinite(averageDailySpend) || averageDailySpend <= 0) return null;
  if (currentBalance <= 0) return 0;
  return Math.floor(currentBalance / averageDailySpend);
}

export function calculateImpulsePercentage(transactions: Transaction[]): number {
  const { start, end } = getDateRange(30);
  const filtered = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= start && tx.dateISO <= end
  );

  if (filtered.length === 0) return 0;

  const impulseCount = filtered.filter(tx => tx.isImpulse).length;
  return Math.round((impulseCount / filtered.length) * 100);
}

export function calculateDisciplineGrade(
  monthlyBudget: number,
  monthlySpent: number
): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (monthlyBudget === 0) return 'C'; // No budget set: neutral grade

  const ratio = monthlySpent / monthlyBudget;

  if (ratio <= 0.7) return 'A';
  if (ratio <= 0.85) return 'B';
  if (ratio <= 1.0) return 'C';
  if (ratio <= 1.15) return 'D';
  return 'F';
}

export function getDailySpendingData(transactions: Transaction[]): DailySpending[] {
  const { start } = getDateRange(14);
  const filtered = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= start
  );

  const dailyMap = new Map<string, number>();

  // Initialize last 14 days with 0
  for (let i = 0; i < 14; i++) {
    const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
    dailyMap.set(date, 0);
  }

  // Add actual spending
  filtered.forEach(tx => {
    const current = dailyMap.get(tx.dateISO) ?? 0;
    dailyMap.set(tx.dateISO, current + tx.amount);
  });

  // Convert to array and sort
  return Array.from(dailyMap.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateLoggingStreak(transactions: Transaction[]): number {
  const sorted = [...transactions].sort((a, b) => b.dateISO.localeCompare(a.dateISO));

  if (sorted.length === 0) return 0;

  let streak = 0;
  let currentDate = new Date();
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

  for (let i = 0; i < 365; i++) {
    const checkDate = format(subDays(currentDate, i), 'yyyy-MM-dd');
    const hasTransaction = sorted.some(tx => tx.dateISO === checkDate);

    if (hasTransaction) {
      streak++;
    } else if (i > 0) {
      // Break streak if there's a gap (but allow today to be missing)
      break;
    }
  }

  return streak;
}

export function getUnlockedBadges(
  transactions: Transaction[],
  streak: number,
  monthlySpent: number,
  monthlyBudget: number
): string[] {
  const badges: string[] = [];

  // "0 Impulse Day" badge - if today has no impulse transactions
  const today = format(new Date(), 'yyyy-MM-dd');
  const todayTxs = transactions.filter(tx => tx.dateISO === today);
  if (todayTxs.length > 0 && todayTxs.every(tx => !tx.isImpulse)) {
    badges.push('0 Impulse Day');
  }

  // "7-Day Streak" badge
  if (streak >= 7) {
    badges.push('7-Day Streak');
  }

  // "30-Day Streak" badge
  if (streak >= 30) {
    badges.push('30-Day Streak');
  }

  // "Budget Master" badge - stayed under budget
  if (monthlyBudget > 0 && monthlySpent <= monthlyBudget) {
    badges.push('Budget Master');
  }

  // "No Subscriptions" badge - no subscriptions this month
  const { start, end } = getMonthRange();
  const subscriptionTxs = transactions.filter(
    tx =>
      tx.category === 'Subscriptions' &&
      tx.dateISO >= start &&
      tx.dateISO <= end &&
      tx.type === 'Expense'
  );
  if (subscriptionTxs.length === 0) {
    badges.push('No Subscriptions');
  }

  return badges;
}

// The user's chosen currency, applied app-wide. Updated whenever settings load
// (see getSettings in db.ts) so all formatCurrency call sites stay in sync
// without threading the symbol through every component.
let activeSymbol = '$';
let activeCurrency = 'USD';

export function setActiveCurrency(code?: string | null, symbol?: string | null): void {
  if (code) activeCurrency = code;
  if (symbol) activeSymbol = symbol;
}

export function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  // Proper locale currency formatting; fall back to symbol + grouped number
  // (Hermes Intl can be inconsistent for some currency codes).
  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: activeCurrency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(abs);
    return amount < 0 ? `-${formatted}` : formatted;
  } catch {
    const n = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${amount < 0 ? '-' : ''}${activeSymbol}${n}`;
  }
}

export function formatTimeCost(costInMinutes: number): string {
  const hours = Math.floor(costInMinutes / 60);
  const minutes = costInMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function calculateTimeCost(amount: number, hourlyValue: number): number {
  if (hourlyValue === 0) return 0;
  return Math.round((amount / hourlyValue) * 60); // Return in minutes
}
