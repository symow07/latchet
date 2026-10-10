import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Activity, AlertTriangle, PieChart, RefreshCw, Sparkles } from '@/components/icons';
import { getSettings, getTransactions } from '@/lib/db';
import {
  calculateAverageDailySpend,
  calculateBalance,
  calculateLoggingStreak,
  calculateMonthSpent,
  calculateSurvivalDays,
  formatCurrency,
  getDailySpendingData,
  getUnlockedBadges,
  hasEnoughHistory,
  hasScorableActivity,
} from '@/lib/calculations';
import { badgeLabel } from '@/lib/badge-meta';
import { BAR, S, useC } from '@/lib/design';
import {
  BadgePill,
  BarChart,
  Card,
  Empty,
  Header,
  IconTile,
  LinkRow,
  Screen,
  SectionHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Insights — DESIGN-PROMPT.md §18, and the other half of §5.
 *
 * §5 moves the health score, the streak, the badges, the 14-day chart and the
 * alerts off home and promises they "all live in Insights"; it also says
 * nothing is deleted. So this screen is not merely a menu — the things that
 * had no other screen in the app (the chart, the streak, the badges, the
 * runway line) are rendered here, and the things that already had one are
 * entry rows into it.
 *
 * Held to the density budget (§4): one hero (the chart), then two blocks.
 */
export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const C = useC();
  const router = useRouter();

  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  // The same gate home uses: every metric here measures spending behaviour, so
  // on a fresh account they do not read low, they read *well*.
  const ready = hasScorableActivity(transactions);

  const daily = getDailySpendingData(transactions);
  const twoWeekTotal = daily.reduce((sum, d) => sum + d.amount, 0);
  const streak = calculateLoggingStreak(transactions);
  const monthSpent = calculateMonthSpent(transactions);
  const badges = getUnlockedBadges(transactions, streak, monthSpent, settings?.monthlyBudget ?? 0);

  // Below a week of history one purchase dominates the average, so the runway
  // figure would be noise dressed up as a number.
  const balance = calculateBalance(settings?.startingBalance ?? 0, transactions);
  const runway = hasEnoughHistory(transactions)
    ? calculateSurvivalDays(balance, calculateAverageDailySpend(transactions))
    : null;

  const chart = daily.map((d) => ({
    value: d.amount,
    label: format(new Date(`${d.date}T12:00:00`), 'd MMM', { locale: getDateFnsLocale() }),
  }));

  const rows = [
    { key: 'score', icon: <Activity size={20} color={C.accent} strokeWidth={S.stroke} />, title: t('insightsHub.scoreTitle'), body: t('insightsHub.scoreBody'), to: '/health-score' },
    { key: 'report', icon: <PieChart size={20} color={C.accent} strokeWidth={S.stroke} />, title: t('insightsHub.reportTitle'), body: t('insightsHub.reportBody'), to: '/analytics' },
    { key: 'alerts', icon: <AlertTriangle size={20} color={C.accent} strokeWidth={S.stroke} />, title: t('insightsHub.alertsTitle'), body: t('insightsHub.alertsBody'), to: '/analytics?tab=alerts' },
    { key: 'subs', icon: <RefreshCw size={20} color={C.accent} strokeWidth={S.stroke} />, title: t('insightsHub.subsTitle'), body: t('insightsHub.subsBody'), to: '/subscriptions' },
  ];

  return (
    <Screen pal={C}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}>
        <Header pal={C} title={t('insightsHub.title')} />

        {!ready ? (
          <Empty
            pal={C}
            icon={<Sparkles size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('insightsHub.emptyTitle')}
            body={t('insightsHub.emptyBody')}
            actionLabel={t('insightsHub.emptyAction')}
            onAction={() => router.push('/(tabs)/add')}
            style={{ marginTop: 72 }}
          />
        ) : (
          <>
            {/* Hero — the 14-day chart that used to crowd home */}
            <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
              <Card pal={C}>
                <Type role="cardTitle" color={C.ink}>{t('insightsHub.last14')}</Type>
                <Type role="meta" color={C.inkDim} style={{ marginTop: 2, marginBottom: 16 }}>
                  {t('insightsHub.spentTotal', { amount: formatCurrency(twoWeekTotal) })}
                </Type>
                <BarChart pal={C} data={chart} />
              </Card>
              {runway !== null ? (
                <Type role="body" color={C.inkDim} style={{ marginTop: 12 }}>
                  {t('insightsHub.runway', { days: runway })}
                </Type>
              ) : null}
            </View>

            {/* Streak and badges — their only home in the app */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('insightsHub.streakTitle')} />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C}>
                  <Type role="body" color={C.ink}>
                    {t('insightsHub.streakDays', { count: streak })}
                  </Type>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    {badges.length > 0 ? (
                      badges.map((b) => <BadgePill key={b} pal={C} label={badgeLabel(b)} />)
                    ) : (
                      <Type role="meta" color={C.inkDim}>{t('insightsHub.noBadges')}</Type>
                    )}
                  </View>
                </Card>
              </View>
            </View>

            {/* Everything that already had a screen of its own */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('insightsHub.more')} />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {rows.map((r, i) => (
                    <View key={r.key} style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}>
                      <LinkRow
                        pal={C}
                        icon={<IconTile pal={C}>{r.icon}</IconTile>}
                        title={r.title}
                        body={r.body}
                        onPress={() => router.push(r.to as never)}
                        style={{ paddingVertical: 14 }}
                      />
                    </View>
                  ))}
                </Card>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
