import { View, ScrollView, Pressable } from 'react-native';
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
  hasEnoughHistory,
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
import { useCallback, useState, useRef, useEffect } from 'react';
import { syncAchievements } from '@/lib/achievementsApi';
import { presentBadgeEarned } from '@/lib/notifications';
import { Flame, Zap, TrendingDown, Calendar, Award, Target, AlertTriangle, Sparkles, Wallet, ChevronRight, BarChart3, Heart, Building2, CreditCard } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { C, R, glow } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BubbleButton, ScreenBackground } from '@/components/ui';
import { t } from '@/lib/i18n/core';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

// Small staggered reveal wrapper to keep the screen feeling alive & bubbly.
function Section({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: any }) {
  return (
    <Animated.View entering={FadeInUp.delay(delay).springify().damping(16)} style={style}>
      {children}
    </Animated.View>
  );
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
  // Below a week of history one purchase dominates the average, so the runway
  // figure would be noise dressed up as a number.
  const enoughHistory = hasEnoughHistory(transactions);
  const survivalDays = enoughHistory
    ? calculateSurvivalDays(balance, avgDailySpend)
    : null;
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

  const lastSyncedRef = useRef<string>('');
  useEffect(() => {
    const key = `${streak}|${badges.join(',')}`;
    if (badges.length === 0 || lastSyncedRef.current === key) return;
    lastSyncedRef.current = key;
    syncAchievements(badges, streak)
      .then((res) => res.newlyEarned.forEach((b) => presentBadgeEarned(b)))
      .catch(() => {});
  }, [badges, streak]);

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
      return { icon: AlertTriangle, color: C.rose, title: 'Budget Exceeded!', message: `You've spent ${budgetUsedPercent}% of your monthly budget. Try to limit spending for the rest of the month.` };
    }
    if (budgetUsedPercent >= 90) {
      return { icon: AlertTriangle, color: C.p400, title: 'Almost at Budget Limit', message: `You've used ${budgetUsedPercent}% of your budget with ${daysInMonth - dayOfMonth} days left. Be mindful of spending!` };
    }
    if (isOverspending) {
      return { icon: AlertTriangle, color: C.p400, title: 'Spending Ahead of Pace', message: `You're spending faster than expected. At this rate, you might exceed your budget by month's end.` };
    }
    if (impulsePercent > 40) {
      return { icon: Zap, color: C.rose, title: 'High Impulse Purchases', message: `${impulsePercent}% of your purchases were impulse buys. Try waiting 24 hours before non-essential purchases.` };
    }
    if (onTrackForSavings && savingsGoal > 0) {
      return { icon: Sparkles, color: C.green, title: 'On Track for Savings!', message: `Great job! You're on track to save ${formatCurrency(currentSavings)} this month, exceeding your goal!` };
    }
    if (isUnderspending) {
      return { icon: Sparkles, color: C.green, title: 'Great Spending Control!', message: `You're spending less than expected. Keep it up to maximize your savings!` };
    }
    if (streak >= 7) {
return { icon: Flame, color: C.p400, title: `${streak}-Day Streak! `, message: `Amazing! You've been tracking your finances consistently. Keep building this habit!` };
    }
    if (disciplineGrade === 'A') {
      return { icon: Award, color: C.p400, title: 'Excellent Discipline!', message: `You're using only ${budgetUsedPercent}% of your budget. You're a budgeting pro!` };
    }
    return null;
  };

  const feedback = getFeedback();
  const go = (path: string) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(path as any); };

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* ── Header + balance ── */}
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 20 }}>
          <Txt weight="semibold" size={15} color={C.lilac}>{getGreeting()}</Txt>
          <View className="flex-row items-center justify-between mt-1">
            {/* The app name, deliberately untranslated. */}
            <Txt weight="bold" size={32} color={C.text}>Budget</Txt>
<Pill label=" You're doing great" color={C.p400} />
          </View>
          <Txt weight="medium" size={13} color={C.textFaint} style={{ marginTop: 4 }}>
            {format(new Date(), 'EEEE, MMMM d')}
          </Txt>

          {/* Balance hero card */}
          <Section delay={40}>
            <LinearGradient
              colors={[C.p700, C.p600, C.p800]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[{ borderRadius: R.xl, padding: 22, marginTop: 18, overflow: 'hidden' }, glow(C.p600, 0.45, 26)]}
            >
              <View
                style={{ position: 'absolute', top: -40, right: -30, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.10)' }}
              />
              <View className="flex-row items-center justify-between">
                <Txt weight="semibold" size={13} color="rgba(255,255,255,0.8)">{t('dashboard.currentBalance')}</Txt>
                <IconBubble color="#ffffff" size={36} radius={14} style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.25)' }}>
                  <Wallet size={18} color="#fff" />
                </IconBubble>
              </View>
              <Txt weight="bold" size={42} color="#fff" style={{ marginTop: 6 }}>{formatCurrency(balance)}</Txt>

              <View className="flex-row justify-between items-end" style={{ marginTop: 18 }}>
                <View className="flex-row items-center" style={{ gap: 10 }}>
                  <IconBubble color="#ffffff" size={40} style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.2)' }}>
                    <Calendar size={19} color="#fff" />
                  </IconBubble>
                  <View>
                    <Txt size={11} color="rgba(255,255,255,0.65)">
                      {enoughHistory ? 'Survival' : 'Survival (need a week)'}
                    </Txt>
                    <Txt weight="bold" size={19} color="#fff">
                      {survivalDays === null ? '—' : `${survivalDays} days`}
                    </Txt>
                  </View>
                </View>
                <View className="items-end">
                  <Txt size={11} color="rgba(255,255,255,0.65)">{t('dashboard.avgDaily')}</Txt>
                  <Txt weight="semibold" size={17} color="#fff">{formatCurrency(avgDailySpend)}</Txt>
                </View>
              </View>
            </LinearGradient>
          </Section>
        </View>

        {/* ── Feedback banner ── */}
        {feedback && (
          <Section delay={80} style={{ paddingHorizontal: 20, marginTop: 16 }}>
            <GlassCard tint={`${feedback.color}1a`} border={`${feedback.color}3a`} radius={R.lg}>
              <View className="flex-row items-start" style={{ gap: 12 }}>
                <IconBubble color={feedback.color}>
                  <feedback.icon size={20} color={feedback.color} />
                </IconBubble>
                <View className="flex-1">
                  <Txt weight="bold" size={15} color={C.text}>{feedback.title}</Txt>
                  <Txt size={13} color={C.textDim} style={{ marginTop: 3, lineHeight: 19 }}>{feedback.message}</Txt>
                </View>
              </View>
            </GlassCard>
          </Section>
        )}

        {/* ── Accounts summary ── */}
        {accounts.length > 0 && (
          <Section delay={110} style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <Pressable onPress={() => go('/accounts')}>
              <GlassCard tint={`${C.p500}14`} border={`${C.p500}2e`}>
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <Wallet size={15} color={C.p400} />
                    <Txt weight="semibold" size={12} color={C.p300}>{t('dashboard.myAccounts')}</Txt>
                  </View>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Txt size={11} color={C.textFaint}>{t('dashboard.viewAll')}</Txt>
                    <ChevronRight size={14} color={C.p400} />
                  </View>
                </View>
                <View className="flex-row items-center justify-between">
                  <View>
                    <Txt size={11} color={C.textFaint}>{t('dashboard.totalBalance')}</Txt>
                    <Txt weight="bold" size={24} color={C.text}>{settings?.currencySymbol || '$'}{totalAccountBalance.toFixed(2)}</Txt>
                  </View>
                  <View className="flex-row">
                    {accounts.slice(0, 3).map((account, idx) => (
                      <View key={account.id} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: account.color, marginLeft: idx > 0 ? -10 : 0, borderWidth: 2, borderColor: C.bg }}>
                        <Txt weight="bold" size={12} color="#fff">{account.name.charAt(0)}</Txt>
                      </View>
                    ))}
                    {accounts.length > 3 && (
                      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgRaise, marginLeft: -10, borderWidth: 2, borderColor: C.bg }}>
                        <Txt weight="bold" size={12} color="#fff">+{accounts.length - 3}</Txt>
                      </View>
                    )}
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          </Section>
        )}

        {/* ── Quick stats ── */}
        <Section delay={140} style={{ paddingHorizontal: 20, marginTop: 18 }}>
          <View className="flex-row" style={{ gap: 12, marginBottom: 12 }}>
            <GlassCard style={{ flex: 1 }} tint={`${C.rose}14`} border={`${C.rose}2a`} radius={R.lg}>
              <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
                <IconBubble color={C.rose} size={32} radius={12}><TrendingDown size={15} color={C.rose} /></IconBubble>
                <Txt size={11} color={C.textDim}>{t('dashboard.today')}</Txt>
              </View>
              <Txt weight="bold" size={21} color={C.text}>{formatCurrency(todaySpent)}</Txt>
            </GlassCard>
            <GlassCard style={{ flex: 1 }} tint={`${C.p500}14`} border={`${C.p500}2a`} radius={R.lg}>
              <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
                <IconBubble color={C.p400} size={32} radius={12}><Zap size={15} color={C.p400} /></IconBubble>
                <Txt size={11} color={C.textDim}>{t('dashboard.thisWeek')}</Txt>
              </View>
              <Txt weight="bold" size={21} color={C.text}>{formatCurrency(weekSpent)}</Txt>
            </GlassCard>
          </View>

          <GlassCard tint={`${C.p600}14`} border={`${C.p600}2a`} radius={R.lg}>
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <IconBubble color={C.p500} size={42}><Flame size={20} color={C.p400} /></IconBubble>
                <View>
                  <Txt size={11} color={C.textDim}>{t('dashboard.thisMonth')}</Txt>
                  <Txt weight="bold" size={24} color={C.text}>{formatCurrency(monthSpent)}</Txt>
                </View>
              </View>
              <View className="items-end">
                <Txt size={11} color={C.textFaint}>{t('dashboard.budget')}</Txt>
                <Txt weight="semibold" size={14} color={C.textDim}>{formatCurrency(settings?.monthlyBudget ?? 0)}</Txt>
              </View>
            </View>
          </GlassCard>
        </Section>

        {/* ── Discipline + impulse ── */}
        <Section delay={170} style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <View className="flex-row" style={{ gap: 12 }}>
            <GlassCard style={{ flex: 1 }} tint={`${C.p500}14`} border={`${C.p500}2a`} radius={R.lg}>
              <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
                <Target size={15} color={C.p400} />
                <Txt size={11} color={C.textDim}>{t('dashboard.discipline')}</Txt>
              </View>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <View style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: `${C.p500}26` }}>
                  <Txt weight="bold" size={28} color={C.text}>{disciplineGrade}</Txt>
                </View>
                <View className="flex-1">
                  <View style={{ height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                    <View style={{ height: '100%', borderRadius: 999, width: `${Math.min(((monthSpent / (settings?.monthlyBudget ?? 1)) * 100), 100)}%`, backgroundColor: C.p500 }} />
                  </View>
                  <Txt size={11} color={C.textFaint} style={{ marginTop: 5 }}>{Math.round((monthSpent / (settings?.monthlyBudget ?? 1)) * 100)}% used</Txt>
                </View>
              </View>
            </GlassCard>
            <GlassCard style={{ flex: 1 }} tint={`${C.rose}14`} border={`${C.rose}2a`} radius={R.lg}>
              <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
                <Zap size={15} color={C.rose} />
                <Txt size={11} color={C.textDim}>{t('dashboard.impulse')}</Txt>
              </View>
              <Txt weight="bold" size={36} color={C.text}>{impulsePercent}%</Txt>
              <Txt size={11} color={C.textFaint} style={{ marginTop: 2 }}>of purchases</Txt>
            </GlassCard>
          </View>
        </Section>

        {/* ── Streak ── */}
        <Section delay={200} style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <GlassCard tint={`${C.p700}1f`} border={`${C.p700}40`}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <LinearGradient colors={[C.p600, C.p400]} style={[{ width: 52, height: 52, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, glow(C.p500, 0.4, 12)]}>
                  <Flame size={22} color={C.p400} />
                </LinearGradient>
                <View>
                  <Txt size={11} color={C.textDim}>{t('dashboard.loggingStreak')}</Txt>
                  <Txt weight="bold" size={22} color={C.text}>{streak} days</Txt>
                  {streak >= 3 && <Txt size={11} color={C.p300} style={{ marginTop: 1 }}>{t('dashboard.keepItUp')}</Txt>}
                </View>
              </View>
{badges.length > 0 && <Pill label={` ${badges.length} badges`} color={C.p400} />}
            </View>
          </GlassCard>
        </Section>

        {/* ── Badges ── */}
        {badges.length > 0 && (
          <Section delay={220} style={{ paddingHorizontal: 20, marginTop: 12 }}>
            <GlassCard tint={`${C.p700}14`} border={`${C.p700}28`}>
              <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
                <Award size={15} color={C.p400} />
                <Txt weight="semibold" size={12} color={C.p300}>{t('dashboard.badges')}</Txt>
              </View>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {badges.map((badge, idx) => (
<Pill key={idx} label={` ${badge}`} color={C.p400} />
                ))}
              </View>
            </GlassCard>
          </Section>
        )}

        {/* ── 14-day chart ── */}
        <Section delay={250} style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <GlassCard>
            <Txt size={12} color={C.textDim} style={{ marginBottom: 14 }}>{t('dashboard.last14Days')}</Txt>
            <View style={{ height: 112, flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
              {dailyData.length > 0 ? (
                dailyData.map((day, idx) => {
                  const height = (day.amount / maxSpending) * 100;
                  const isToday = idx === dailyData.length - 1;
                  return (
                    <View key={idx} style={{ flex: 1, height: `${Math.max(height, 8)}%`, borderRadius: 8, backgroundColor: isToday ? C.p400 : `${C.p500}40` }} />
                  );
                })
              ) : (
                <View className="flex-1 items-center justify-center">
<Txt size={13} color={C.textFaint} style={{ textAlign: 'center' }}>No data yet{'\n'}Start tracking! </Txt>
                </View>
              )}
            </View>
{dailyData.length > 0 && <Txt size={11} color={C.textFaint} style={{ textAlign: 'center', marginTop: 12 }}>Peak: {formatCurrency(maxDaily)} </Txt>}
          </GlassCard>
        </Section>

        {/* ── Smart Analytics ── */}
        <Section delay={270} style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <Pressable onPress={() => go('/analytics')}>
            <GlassCard tint={`${C.p700}16`} border={`${C.p700}2e`}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <IconBubble color={C.p500} size={48} radius={18}><BarChart3 size={23} color={C.p400} /></IconBubble>
                  <View>
                    <Txt weight="bold" size={15} color={C.text}>{t('dashboard.smartAnalytics')}</Txt>
                    <Txt size={12} color={C.textDim} style={{ marginTop: 1 }}>{t('dashboard.smartAnalyticsHint')}</Txt>
                  </View>
                </View>
                <ChevronRight size={20} color={C.p400} />
              </View>
            </GlassCard>
          </Pressable>
        </Section>

        {/* ── Health score ── */}
        {healthScore && (
          <Section delay={290} style={{ paddingHorizontal: 20, marginTop: 12 }}>
            <Pressable onPress={() => go('/health-score')}>
              <LinearGradient colors={[C.p800, C.p600, C.p400]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: R.lg, padding: 18 }, glow(C.p500, 0.4, 20)]}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <View style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
                      <Txt weight="bold" size={22} color="#fff">{healthScore.totalScore}</Txt>
                    </View>
                    <View>
                      <Txt weight="bold" size={17} color="#fff">{t('dashboard.healthScore')}</Txt>
                      <Txt size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 1 }}>
                        Grade {healthScore.grade} • {healthScore.trend === 'up' ? '↑' : healthScore.trend === 'down' ? '↓' : '→'} {healthScore.trend === 'stable' ? 'Stable' : `${healthScore.trendValue}%`}
                      </Txt>
                    </View>
                  </View>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Heart size={18} color="#fff" />
                    <ChevronRight size={20} color="#fff" />
                  </View>
                </View>
              </LinearGradient>
            </Pressable>
          </Section>
        )}

        {/* ── Subscriptions ── */}
        {allSubscriptions.filter(s => s.status !== 'canceled').length > 0 && (
          <Section delay={310} style={{ paddingHorizontal: 20, marginTop: 12 }}>
            <Pressable onPress={() => go('/subscriptions')}>
              <GlassCard tint={`${C.p700}16`} border={`${C.p700}2e`}>
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <IconBubble color={C.lilac} size={42}><CreditCard size={20} color={C.lilac} /></IconBubble>
                    <View>
                      <Txt weight="bold" size={15} color={C.text}>{t('dashboard.subscriptions')}</Txt>
                      <Txt size={12} color={C.textDim} style={{ marginTop: 1 }}>{formatCurrency(subMonthlyTotal)}/mo recurring</Txt>
                    </View>
                  </View>
                  <ChevronRight size={20} color={C.lilac} />
                </View>
                {upcomingCharges.length > 0 && (
                  <View style={{ borderRadius: R.md, padding: 12, backgroundColor: `${C.p500}16` }}>
                    <Txt weight="semibold" size={11} color={C.p400} style={{ marginBottom: 3 }}>
{upcomingCharges.length} charge{upcomingCharges.length > 1? 's': ''} due in 7 days
                    </Txt>
                    {upcomingCharges.slice(0, 2).map(s => (
                      <Txt key={s.id} size={11} color={C.textDim}>{s.merchantDisplay} · {formatCurrency(s.typicalAmount)}</Txt>
                    ))}
                  </View>
                )}
              </GlassCard>
            </Pressable>
          </Section>
        )}

        {/* ── Link bank ── */}
        <Section delay={330} style={{ paddingHorizontal: 20, marginTop: 12 }}>
          <Pressable onPress={() => go('/link-bank')}>
            <GlassCard tint={`${C.p800}1c`} border={`${C.p800}38`}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <IconBubble color={C.p600} size={48} radius={18}><Building2 size={23} color={C.p500} /></IconBubble>
                  <View>
                    <Txt weight="bold" size={15} color={C.text}>{t('dashboard.linkBank')}</Txt>
                    <Txt size={12} color={C.textDim} style={{ marginTop: 1 }}>{t('dashboard.linkBankHint')}</Txt>
                  </View>
                </View>
                <ChevronRight size={20} color={C.p500} />
              </View>
            </GlassCard>
          </Pressable>
        </Section>

        {/* ── CTA ── */}
        <Section delay={350} style={{ paddingHorizontal: 20, marginTop: 18 }}>
<BubbleButton label="Let's track that " onPress={() => router.push('/add')} />
        </Section>
      </ScrollView>
    </ScreenBackground>
  );
}
