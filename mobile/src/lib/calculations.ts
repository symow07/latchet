import { format, startOfDay, subDays, startOfMonth, endOfMonth } from 'date-fns';

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

export function calculateAverageDailySpend(transactions: Transaction[]): number {
  const { start, end } = getDateRange(30);
  const filtered = transactions.filter(
    tx => tx.type === 'Expense' && tx.dateISO >= start && tx.dateISO <= end
  );

  if (filtered.length === 0) return 0;

  const total = filtered.reduce((sum, tx) => sum + tx.amount, 0);
  const days = 30; // Past 30 days

  return total / days;
}

export function calculateSurvivalDays(
  currentBalance: number,
  averageDailySpend: number
): number {
  if (averageDailySpend === 0) return Infinity;
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
