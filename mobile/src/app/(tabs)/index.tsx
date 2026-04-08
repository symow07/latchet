import { View, Text, ScrollView, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { getTransactions, getSettings, getAccounts, getSubscriptions } from '@/lib/db';
import {
  calculateTodaySpent,
  calculateWeekSpent,
  calculateMonthSpent,
  calculateBalance,
  calculateAverageDailySpend,
  calculateSurvivalDays,
  calculateImpulsePercentage,
  calculateDisciplineGrade,
  getDailySpendingData,
  calculateLoggingStreak,
  getUnlockedBadges,
  formatCurrency,
} from '@/lib/calculations';
import { calculateHealthScore } from '@/lib/health-score';
import { getUpcomingCharges, monthlySubscriptionTotal } from '@/lib/subscription-detection';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState, useRef } from 'react';
import { Flame, Zap, TrendingDown, Calendar, Award, Target, AlertTriangle, Sparkles, Wallet, ChevronRight, BarChart3, Heart, Building2, CreditCard } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning! ☀️';
  if (hour < 17) return 'Good afternoon! 🌤️';
  if (hour < 21) return 'Good evening! 🌆';
  return 'Good night! 🌙';
}

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);
  const hasMounted = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (hasMounted.current) {
        setRefreshKey(prev => prev + 1);
      } else {
        hasMounted.current = true;
      }
    }, [])
  );

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', refreshKey],
    queryFn: getTransactions,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings', refreshKey],
    queryFn: getSettings,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', refreshKey],
    queryFn: getAccounts,
  });

  const { data: allSubscriptions = [] } = useQuery({
    queryKey: ['subscriptions', refreshKey],
    queryFn: () => getSubscriptions(),
  });

  const upcomingCharges = getUpcomingCharges(allSubscriptions, 7);
  const subMonthlyTotal = monthlySubscriptionTotal(allSubscriptions);

  const totalAccountBalance = accounts.reduce((sum, acc) => {
    const adjustedBalance = acc.type === 'credit' ? -acc.balance : acc.balance;
    return sum + adjustedBalance;
  }, 0);

  const todaySpent = calculateTodaySpent(transactions);
  const weekSpent = calculateWeekSpent(transactions);
  const monthSpent = calculateMonthSpent(transactions);
  const balance = calculateBalance(settings?.startingBalance ?? 0, transactions);
  const avgDailySpend = calculateAverageDailySpend(transactions);
  const survivalDays = calculateSurvivalDays(balance, avgDailySpend);
  const impulsePercent = calculateImpulsePercentage(transactions);
  const disciplineGrade = calculateDisciplineGrade(settings?.monthlyBudget ?? 0, monthSpent);
  const dailyData = getDailySpendingData(transactions);
  const streak = calculateLoggingStreak(transactions);
  const badges = getUnlockedBadges(
    transactions,
    streak,
    monthSpent,
    settings?.monthlyBudget ?? 0
  );

  const maxDaily = Math.max(...dailyData.map(d => d.amount), 1);
  const maxSpending = Math.max(100, maxDaily * 1.2);

  const healthScore = settings ? calculateHealthScore(transactions, settings) : null;

  const budgetUsedPercent = settings?.monthlyBudget
    ? Math.round((monthSpent / settings.monthlyBudget) * 100)
    : 0;
  const savingsGoal = settings?.savingsGoal || 0;
  const monthlyIncome = settings?.monthlyIncome || 0;
  const currentSavings = monthlyIncome - monthSpent;
  const onTrackForSavings = currentSavings >= savingsGoal;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const dayOfMonth = new Date().getDate();
  const expectedBudgetUsed = (dayOfMonth / daysInMonth) * 100;
  const isOverspending = budgetUsedPercent > expectedBudgetUsed + 10;
  const isUnderspending = budgetUsedPercent < expectedBudgetUsed - 10;

  const getFeedback = () => {
    if (budgetUsedPercent >= 100) {
      return {
        type: 'warning',
        icon: AlertTriangle,
        iconColor: '#ef4444',
        bgColor: 'rgba(239, 68, 68, 0.12)',
        borderColor: 'rgba(239, 68, 68, 0.25)',
        title: "Budget Exceeded!",
        message: `You've spent ${budgetUsedPercent}% of your monthly budget. Try to limit spending for the rest of the month.`,
      };
    }
    if (budgetUsedPercent >= 90) {
      return {
        type: 'warning',
        icon: AlertTriangle,
        iconColor: '#c084fc',
        bgColor: 'rgba(192, 132, 252, 0.12)',
        borderColor: 'rgba(192, 132, 252, 0.25)',
        title: "Almost at Budget Limit",
        message: `You've used ${budgetUsedPercent}% of your budget with ${daysInMonth - dayOfMonth} days left. Be mindful of spending!`,
      };
    }
    if (isOverspending) {
      return {
        type: 'warning',
        icon: AlertTriangle,
        iconColor: '#c084fc',
        bgColor: 'rgba(192, 132, 252, 0.12)',
        borderColor: 'rgba(192, 132, 252, 0.25)',
        title: "Spending Ahead of Pace",
        message: `You're spending faster than expected. At this rate, you might exceed your budget by month's end.`,
      };
    }
    if (impulsePercent > 40) {
      return {
        type: 'warning',
        icon: Zap,
        iconColor: '#f472b6',
        bgColor: 'rgba(244, 114, 182, 0.12)',
        borderColor: 'rgba(244, 114, 182, 0.25)',
        title: "High Impulse Purchases",
        message: `${impulsePercent}% of your purchases were impulse buys. Try waiting 24 hours before non-essential purchases.`,
      };
    }
    if (onTrackForSavings && savingsGoal > 0) {
      return {
        type: 'success',
        icon: Sparkles,
        iconColor: '#22c55e',
        bgColor: 'rgba(34, 197, 94, 0.12)',
        borderColor: 'rgba(34, 197, 94, 0.25)',
        title: "On Track for Savings! 🎉",
        message: `Great job! You're on track to save ${formatCurrency(currentSavings)} this month, exceeding your goal!`,
      };
    }
    if (isUnderspending) {
      return {
        type: 'success',
        icon: Sparkles,
        iconColor: '#22c55e',
        bgColor: 'rgba(34, 197, 94, 0.12)',
        borderColor: 'rgba(34, 197, 94, 0.25)',
        title: "Great Spending Control! 💚",
        message: `You're spending less than expected. Keep it up to maximize your savings!`,
      };
    }
    if (streak >= 7) {
      return {
        type: 'success',
        icon: Flame,
        iconColor: '#a855f7',
        bgColor: 'rgba(168, 85, 247, 0.12)',
        borderColor: 'rgba(168, 85, 247, 0.25)',
        title: `${streak}-Day Streak! 🔥`,
        message: `Amazing! You've been tracking your finances consistently. Keep building this habit!`,
      };
    }
    if (disciplineGrade === 'A') {
      return {
        type: 'success',
        icon: Award,
        iconColor: '#c084fc',
        bgColor: 'rgba(192, 132, 252, 0.12)',
        borderColor: 'rgba(192, 132, 252, 0.25)',
        title: "Excellent Discipline! ⭐",
        message: `You're using only ${budgetUsedPercent}% of your budget. You're a budgeting pro!`,
      };
    }
    return null;
  };

  const feedback = getFeedback();

  return (
    <View className="flex-1" style={{ backgroundColor: '#06060f' }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Deep Purple/Black Gradient Header */}
        <LinearGradient
          colors={['#2e1065', '#4c1d95', '#6d28d9', '#06060f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: 32,
            paddingHorizontal: 20,
            borderBottomLeftRadius: 36,
            borderBottomRightRadius: 36,
          }}
        >
          {/* Header Title */}
          <View className="mb-6">
            <Text className="text-purple-200/80 text-base font-medium mb-1">{getGreeting()}</Text>
            <Text className="text-3xl font-bold text-white">Budget</Text>
            <Text className="text-base text-purple-200/70 mt-1">
              {format(new Date(), 'EEEE, MMMM d')} — you're doing great! 💜
            </Text>
          </View>

          {/* Balance Card - Purple Glassmorphism */}
          <View
            className="rounded-3xl p-5 overflow-hidden"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
          >
            <Text className="text-purple-200/80 text-sm font-medium mb-1">Current Balance 🏦</Text>
            <Text className="text-4xl font-bold text-white mb-4">{formatCurrency(balance)}</Text>

            <View className="flex-row justify-between">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-white/15 items-center justify-center mr-3">
                  <Calendar size={20} color="white" />
                </View>
                <View>
                  <Text className="text-purple-200/60 text-xs">Survival</Text>
                  <Text className="text-xl font-bold text-white">
                    {survivalDays === 999 ? '∞' : survivalDays} days
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text className="text-purple-200/60 text-xs">Avg Daily</Text>
                <Text className="text-lg font-semibold text-white">{formatCurrency(avgDailySpend)}</Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* Smart Feedback Banner */}
        {feedback && (
          <View className="px-4 mt-4">
            <View
              className="rounded-3xl p-4 flex-row items-start"
              style={{
                backgroundColor: feedback.bgColor,
                borderWidth: 1,
                borderColor: feedback.borderColor,
              }}
            >
              <View
                className="w-10 h-10 rounded-2xl items-center justify-center mr-3"
                style={{ backgroundColor: `${feedback.iconColor}20` }}
              >
                <feedback.icon size={20} color={feedback.iconColor} />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold mb-1">{feedback.title}</Text>
                <Text className="text-purple-200/70 text-sm leading-5">{feedback.message}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Accounts Summary */}
        {accounts.length > 0 && (
          <View className="px-4 mt-4">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/accounts');
              }}
            >
              <View
                className="rounded-3xl p-4"
                style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)' }}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <Wallet size={16} color="#c084fc" />
                    <Text className="text-purple-300 text-xs ml-2 font-medium">My Accounts 👛</Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-purple-400/70 text-xs mr-1">View All</Text>
                    <ChevronRight size={14} color="#c084fc" />
                  </View>
                </View>
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-purple-200/60 text-xs">Total Balance</Text>
                    <Text className="text-2xl font-bold text-white">
                      {settings?.currencySymbol || '$'}{totalAccountBalance.toFixed(2)}
                    </Text>
                  </View>
                  <View className="flex-row">
                    {accounts.slice(0, 3).map((account, idx) => (
                      <View
                        key={account.id}
                        className="w-8 h-8 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: account.color,
                          marginLeft: idx > 0 ? -8 : 0,
                          borderWidth: 2,
                          borderColor: '#06060f',
                        }}
                      >
                        <Text className="text-white text-xs font-bold">
                          {account.name.charAt(0)}
                        </Text>
                      </View>
                    ))}
                    {accounts.length > 3 && (
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: '#1e1b2e',
                          marginLeft: -8,
                          borderWidth: 2,
                          borderColor: '#06060f',
                        }}
                      >
                        <Text className="text-white text-xs font-bold">
                          +{accounts.length - 3}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </Pressable>
          </View>
        )}

        {/* Quick Stats Grid */}
        <View className="px-4 mt-6">
          <View className="flex-row gap-3 mb-3">
            {/* Today */}
            <View
              className="flex-1 rounded-3xl p-4"
              style={{ backgroundColor: 'rgba(251, 113, 133, 0.1)', borderWidth: 1, borderColor: 'rgba(251, 113, 133, 0.18)' }}
            >
              <View className="flex-row items-center mb-2">
                <View className="w-8 h-8 rounded-2xl bg-rose-500/15 items-center justify-center mr-2">
                  <TrendingDown size={16} color="#fb7185" />
                </View>
                <Text className="text-rose-300/80 text-xs">Today 🌅</Text>
              </View>
              <Text className="text-xl font-bold text-white">{formatCurrency(todaySpent)}</Text>
            </View>

            {/* Week */}
            <View
              className="flex-1 rounded-3xl p-4"
              style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.18)' }}
            >
              <View className="flex-row items-center mb-2">
                <View className="w-8 h-8 rounded-2xl bg-purple-500/15 items-center justify-center mr-2">
                  <Zap size={16} color="#c084fc" />
                </View>
                <Text className="text-purple-300/80 text-xs">This Week ⚡</Text>
              </View>
              <Text className="text-xl font-bold text-white">{formatCurrency(weekSpent)}</Text>
            </View>
          </View>

          {/* Month */}
          <View
            className="rounded-3xl p-4 mb-3"
            style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.18)' }}
          >
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-2xl bg-violet-500/15 items-center justify-center mr-3">
                  <Flame size={20} color="#8b5cf6" />
                </View>
                <View>
                  <Text className="text-violet-300/80 text-xs">This Month 📅</Text>
                  <Text className="text-2xl font-bold text-white">{formatCurrency(monthSpent)}</Text>
                </View>
              </View>
              <View className="items-end">
                <Text className="text-gray-500 text-xs">Budget</Text>
                <Text className="text-gray-300 font-semibold">{formatCurrency(settings?.monthlyBudget ?? 0)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Discipline & Impulse Row */}
        <View className="px-4 flex-row gap-3 mb-4">
          {/* Discipline Grade */}
          <View
            className="flex-1 rounded-3xl p-4"
            style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.18)' }}
          >
            <View className="flex-row items-center mb-3">
              <Target size={16} color="#c084fc" />
              <Text className="text-purple-300/80 text-xs ml-2">Discipline ⭐</Text>
            </View>
            <View className="flex-row items-center">
              <View className="w-14 h-14 rounded-2xl bg-purple-500/20 items-center justify-center mr-3">
                <Text className="text-3xl font-bold text-white">{disciplineGrade}</Text>
              </View>
              <View className="flex-1">
                <View className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(((monthSpent / (settings?.monthlyBudget ?? 1)) * 100), 100)}%`,
                      backgroundColor: '#a855f7',
                    }}
                  />
                </View>
                <Text className="text-purple-200/50 text-xs mt-1">
                  {Math.round((monthSpent / (settings?.monthlyBudget ?? 1)) * 100)}% used
                </Text>
              </View>
            </View>
          </View>

          {/* Impulse */}
          <View
            className="flex-1 rounded-3xl p-4"
            style={{ backgroundColor: 'rgba(244, 114, 182, 0.1)', borderWidth: 1, borderColor: 'rgba(244, 114, 182, 0.18)' }}
          >
            <View className="flex-row items-center mb-3">
              <Zap size={16} color="#f472b6" />
              <Text className="text-pink-300/80 text-xs ml-2">Impulse ⚡</Text>
            </View>
            <Text className="text-4xl font-bold text-white">{impulsePercent}%</Text>
            <Text className="text-pink-200/50 text-xs mt-1">of purchases</Text>
          </View>
        </View>

        {/* Streak Card */}
        <View className="px-4 mb-4">
          <View
            className="rounded-3xl p-4 flex-row items-center justify-between"
            style={{ backgroundColor: 'rgba(109, 40, 217, 0.15)', borderWidth: 1, borderColor: 'rgba(109, 40, 217, 0.3)' }}
          >
            <View className="flex-row items-center">
              <LinearGradient
                colors={['#7c3aed', '#a855f7']}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Text className="text-2xl">🔥</Text>
              </LinearGradient>
              <View>
                <Text className="text-purple-300/80 text-xs">Logging Streak</Text>
                <Text className="text-2xl font-bold text-white">{streak} days</Text>
                {streak >= 3 && <Text className="text-purple-300 text-xs mt-0.5">Keep it up, you're on fire!</Text>}
              </View>
            </View>
            {badges.length > 0 && (
              <View className="bg-purple-500/20 rounded-2xl px-3 py-1.5 border border-purple-500/30">
                <Text className="text-purple-300 text-xs font-bold">🏆 {badges.length} badges</Text>
              </View>
            )}
          </View>
        </View>

        {/* Badges */}
        {badges.length > 0 && (
          <View className="px-4 mb-4">
            <View
              className="rounded-3xl p-4"
              style={{ backgroundColor: 'rgba(109, 40, 217, 0.1)', borderWidth: 1, borderColor: 'rgba(109, 40, 217, 0.2)' }}
            >
              <View className="flex-row items-center mb-3">
                <Award size={16} color="#c084fc" />
                <Text className="text-purple-300 text-xs ml-2 font-medium">Badges Unlocked 🎖️</Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {badges.map((badge, idx) => (
                  <View key={idx} className="bg-purple-500/20 border border-purple-500/30 rounded-2xl px-3 py-1.5">
                    <Text className="text-xs font-semibold text-purple-300">🌟 {badge}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Spending Chart */}
        <View className="px-4 mb-4">
          <View
            className="rounded-3xl p-4"
            style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
          >
            <Text className="text-gray-400 text-xs mb-4">Last 14 Days 📊</Text>
            <View className="h-28 flex-row items-end gap-1">
              {dailyData.length > 0 ? (
                dailyData.map((day, idx) => {
                  const height = (day.amount / maxSpending) * 100;
                  const isToday = idx === dailyData.length - 1;
                  return (
                    <View
                      key={idx}
                      className="flex-1 rounded-t-xl"
                      style={{
                        height: `${Math.max(height, 8)}%`,
                        backgroundColor: isToday ? '#a855f7' : 'rgba(168, 85, 247, 0.3)',
                      }}
                    />
                  );
                })
              ) : (
                <View className="flex-1 items-center justify-center">
                  <Text className="text-gray-500 text-center">No data yet{'\n'}Start tracking! 📝</Text>
                </View>
              )}
            </View>
            {dailyData.length > 0 && (
              <Text className="text-gray-600 text-xs text-center mt-3">
                Peak: {formatCurrency(maxDaily)} 📈
              </Text>
            )}
          </View>
        </View>

        {/* Smart Analytics Card */}
        <View className="px-4 mb-4">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/analytics');
            }}
          >
            <View
              className="rounded-3xl p-4 flex-row items-center justify-between"
              style={{ backgroundColor: 'rgba(124, 58, 237, 0.1)', borderWidth: 1, borderColor: 'rgba(124, 58, 237, 0.22)' }}
            >
              <View className="flex-row items-center">
                <View className="w-12 h-12 rounded-2xl bg-violet-500/15 items-center justify-center mr-3">
                  <BarChart3 size={24} color="#8b5cf6" />
                </View>
                <View>
                  <Text className="text-white font-semibold">Smart Analytics 🧠</Text>
                  <Text className="text-purple-300/70 text-xs mt-0.5">
                    Subscriptions, patterns & waste detection
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color="#8b5cf6" />
            </View>
          </Pressable>
        </View>

        {/* Financial Health Score Card */}
        {healthScore && (
          <View className="px-4 mb-4">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/health-score');
              }}
            >
              <LinearGradient
                colors={['#4c1d95', '#7c3aed', '#a855f7']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 24, padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="w-14 h-14 rounded-2xl bg-white/15 items-center justify-center mr-3">
                      <Text className="text-white text-2xl font-bold">{healthScore.totalScore}</Text>
                    </View>
                    <View>
                      <Text className="text-white font-bold text-lg">Health Score 💗</Text>
                      <Text className="text-white/80 text-xs mt-0.5">
                        Grade {healthScore.grade} • {healthScore.trend === 'up' ? '↑' : healthScore.trend === 'down' ? '↓' : '→'} {healthScore.trend === 'stable' ? 'Stable' : `${healthScore.trendValue}%`}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center">
                    <Heart size={18} color="white" />
                    <ChevronRight size={20} color="white" style={{ marginLeft: 4 }} />
                  </View>
                </View>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {/* Subscriptions Card */}
        {allSubscriptions.filter(s => s.status !== 'canceled').length > 0 && (
          <View className="px-4 mb-4">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/subscriptions');
              }}
            >
              <View
                className="rounded-3xl p-4"
                style={{ backgroundColor: 'rgba(109, 40, 217, 0.1)', borderWidth: 1, borderColor: 'rgba(109, 40, 217, 0.22)' }}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 rounded-2xl bg-violet-500/15 items-center justify-center mr-3">
                      <CreditCard size={20} color="#a78bfa" />
                    </View>
                    <View>
                      <Text className="text-white font-semibold">Subscriptions 📱</Text>
                      <Text className="text-violet-300/70 text-xs mt-0.5">
                        {formatCurrency(subMonthlyTotal)}/mo in recurring charges
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#a78bfa" />
                </View>
                {upcomingCharges.length > 0 && (
                  <View
                    className="rounded-2xl p-3"
                    style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)' }}
                  >
                    <Text className="text-purple-400 text-xs font-semibold mb-1">
                      ⏰ {upcomingCharges.length} charge{upcomingCharges.length > 1 ? 's' : ''} due in 7 days
                    </Text>
                    {upcomingCharges.slice(0, 2).map(s => (
                      <Text key={s.id} className="text-purple-300/80 text-xs">
                        {s.merchantDisplay} · {formatCurrency(s.typicalAmount)}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </Pressable>
          </View>
        )}

        {/* Link Bank Account Card */}
        <View className="px-4 mb-4">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/link-bank');
            }}
          >
            <View
              className="rounded-3xl p-4 flex-row items-center justify-between"
              style={{ backgroundColor: 'rgba(91, 33, 182, 0.12)', borderWidth: 1, borderColor: 'rgba(91, 33, 182, 0.25)' }}
            >
              <View className="flex-row items-center">
                <View className="w-12 h-12 rounded-2xl bg-violet-600/15 items-center justify-center mr-3">
                  <Building2 size={24} color="#7c3aed" />
                </View>
                <View>
                  <Text className="text-white font-semibold">Link Bank Account 🏦</Text>
                  <Text className="text-purple-300/70 text-xs mt-0.5">
                    Auto-sync transactions securely
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color="#7c3aed" />
            </View>
          </Pressable>
        </View>

        {/* Add Transaction Button */}
        <View className="px-4 mt-2">
          <Pressable
            onPress={() => router.push('/add')}
            className="active:scale-98"
          >
            <LinearGradient
              colors={['#6d28d9', '#a855f7']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 20,
                paddingVertical: 18,
                alignItems: 'center',
              }}
            >
              <Text className="text-white font-bold text-lg">Let's track that 💜</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
