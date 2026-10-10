import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Camera, MessageCircle, PieChart, PlusSquare, TabIcons, Wallet } from '@/components/icons';
import { getAccounts, getSettings, getTransactions } from '@/lib/db';
import {
  calculateBalance,
  calculateImpulsePercentage,
  calculateLastWeekSpent,
  calculateLoggingStreak,
  calculateMonthSpent,
  calculateWeekSpent,
  formatCurrency,
  getUnlockedBadges,
  hasScorableActivity,
} from '@/lib/calculations';
import { categoryLabel, categoryMarkIndex } from '@/lib/category-meta';
import { pickHomeInsight, type InsightAction } from '@/lib/home-insight';
import { dayOfMonth, daysInMonth } from '@/lib/dates';
import { useSession } from '@/lib/auth/use-session';
import { syncAchievements } from '@/lib/achievementsApi';
import { presentBadgeEarned } from '@/lib/notifications';
import { BAR, S, useC } from '@/lib/design';
import {
  BalanceCard,
  BudgetLine,
  Card,
  CircleAction,
  Empty,
  Header,
  Insight,
  QuickAction,
  Row,
  Screen,
  SectionHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function greetingWord(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 17) return t('greeting.afternoon');
  if (hour < 21) return t('greeting.evening');
  return t('greeting.night');
}

/**
 * Home — DESIGN-PROMPT.md §12, built to the four-item rule in §5.
 *
 * What used to be here: balance, a budget meter, a 14-day chart, a health
 * score, a streak, badges, accounts and recent activity, stacked. What is here
 * now: a greeting and the balance, one budget line, one insight, five rows of
 * recent activity. Everything else moved to Insights and to the balance card's
 * own detail screen — one tap deeper, nothing deleted (§5).
 *
 * The hardest part of this screen is what it refuses to say. When in doubt
 * about whether something belongs, it doesn't.
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const hasMounted = useRef(false);
  const [page, setPage] = useState(0);

  // Refetch on focus, but do not change the query keys to do it. Keying on a
  // counter mints a brand-new query with no cache, so every return to this
  // screen rendered once with empty data before the rows came back — a visible
  // flash, and a flash of the first-run empty state. Invalidating keeps the
  // last data on screen while the refetch runs.
  useFocusEffect(
    useCallback(() => {
      if (!hasMounted.current) {
        hasMounted.current = true;
        return;
      }
      for (const key of ['accounts', 'settings', 'transactions']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    }, [queryClient])
  );

  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const { data: session } = useSession();

  const firstName = session?.user?.name?.split(' ')[0];
  const title = firstName
    ? t('home.greetingName', { greeting: greetingWord(), name: firstName })
    : greetingWord();

  const balance = calculateBalance(settings?.startingBalance ?? 0, transactions);
  const monthSpent = calculateMonthSpent(transactions);
  const monthlyBudget = settings?.monthlyBudget ?? 0;
  const scorable = hasScorableActivity(transactions);
  const streak = calculateLoggingStreak(transactions);

  // Badges moved to Insights, but earning one is not a screen — it is a side
  // effect of having recorded something, and this is the screen every session
  // passes through. Dropping it with the badge *display* would have quietly
  // stopped both the backend sync and the "you earned a badge" notification.
  const badges = getUnlockedBadges(transactions, streak, monthSpent, monthlyBudget);
  const lastSyncedRef = useRef<string>('');
  useEffect(() => {
    const key = `${streak}|${badges.join(',')}`;
    if (badges.length === 0 || lastSyncedRef.current === key) return;
    lastSyncedRef.current = key;
    syncAchievements(badges, streak)
      .then((res) => res.newlyEarned.forEach((b) => presentBadgeEarned(b)))
      .catch(() => {});
  }, [badges, streak]);

  const insight = pickHomeInsight({
    scorable,
    monthSpent,
    monthlyBudget,
    weekSpent: calculateWeekSpent(transactions),
    lastWeekSpent: calculateLastWeekSpent(transactions),
    impulsePercent: calculateImpulsePercentage(transactions),
    streak,
    savingsGoal: settings?.savingsGoal ?? 0,
    projectedSavings: (settings?.monthlyIncome ?? 0) - monthSpent,
    dayOfMonth: dayOfMonth(),
    daysInMonth: daysInMonth(),
    money: formatCurrency,
  });

  const ROUTES: Record<InsightAction, string> = {
    seeSpending: '/analytics',
    setBudget: '/category-budgets',
    setGoal: '/onboarding',
    ask: '/(tabs)/advisor',
    seeImpulse: '/analytics?tab=insights',
  };

  const budgetSentence = () => {
    if (monthlyBudget <= 0) return t('home.budgetNone');
    const remaining = monthlyBudget - monthSpent;
    return remaining >= 0
      ? t('home.budgetLeft', { left: formatCurrency(remaining), budget: formatCurrency(monthlyBudget) })
      : t('home.budgetOver', { amount: formatCurrency(-remaining), budget: formatCurrency(monthlyBudget) });
  };

  // The carousel: total balance first, then one card per account, each clipped
  // by the screen edge so the next one peeks (§1.9, §6.1).
  // useWindowDimensions rather than Dimensions.get, so the carousel re-measures
  // on rotation and in iPad split view instead of keeping its first width.
  const { width } = useWindowDimensions();
  const cardWidth = width - S.screen * 2 - 34;
  const cards = [
    {
      key: 'total',
      label: t('home.balanceLabel'),
      amount: balance,
      caption: t('home.balanceCaption', { count: accounts.length }),
    },
    ...accounts.map((a) => ({
      key: a.id,
      label: a.name,
      // A credit account's balance is what you owe, so it reads as negative
      // against the others rather than adding to them.
      amount: a.type === 'credit' ? -a.balance : a.balance,
      // The stored type is `credit`; the string is keyed `creditCard`. Every
      // other type keys straight through.
      caption: a.type === 'credit'
        ? t('accountTypes.creditCard')
        : t(`accountTypes.${a.type}`),
    })),
  ];

  const recent = transactions.slice(0, 5);
  const firstRun = transactions.length === 0 && accounts.length === 0;

  return (
    <Screen pal={C}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}>
        {/* The greeting is a greeting, not the headline — see Header's `role`.
            Every finance app worth the comparison leads with the number, so
            this sits at `section` and the hero below it is what the eye lands
            on, which is the order §1.1 asked for all along. */}
        <Header
          pal={C}
          title={title}
          role="section"
          actions={
            <CircleAction pal={C} label={t('home.ask')} onPress={() => router.push('/(tabs)/advisor')}>
              <MessageCircle size={19} color={C.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        {firstRun ? (
          <Empty
            pal={C}
            icon={<Wallet size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            actionLabel={t('home.emptyAction')}
            onAction={() => router.push('/(tabs)/add')}
            style={{ marginTop: 80 }}
          />
        ) : (
          <>
            {/* 1 — the balance */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={cardWidth + 12}
              decelerationRate="fast"
              // Horizontal ScrollViews fill their parent without this.
              style={{ flexGrow: 0, marginTop: 24 }}
              contentContainerStyle={{ paddingHorizontal: S.screen, gap: 12 }}
              onMomentumScrollEnd={(e) =>
                setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 12)))
              }
            >
              {cards.map((c, i) => (
                <BalanceCard
                  key={c.key}
                  pal={C}
                  label={c.label}
                  amount={c.amount}
                  caption={c.caption}
                  format={formatCurrency}
                  onPress={() => router.push('/accounts')}
                  style={{ width: cardWidth }}
                  // One gradient moment per screen (§1.10): only the first card
                  // carries the arc, so scrolling the carousel does not turn it
                  // into a pattern.
                  plain={i > 0}
                />
              ))}
            </ScrollView>

            {cards.length > 1 ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                {cards.map((c, i) => (
                  <View
                    key={c.key}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: i === page ? C.ink : C.groundSunk,
                    }}
                  />
                ))}
              </View>
            ) : null}

            {/* The four places people go straight from here.
                §6.8 has had this component since the redesign and nothing
                rendered it, so every one of these was two taps away behind a
                tab. It sits at `S.group` from the balance because it belongs
                to it — this whole block is "your money and what to do with
                it" — and the next block is a full `S.section` away. */}
            <View
              style={{
                flexDirection: 'row',
                paddingHorizontal: S.screen,
                gap: 12,
                marginTop: cards.length > 1 ? S.group : 24,
              }}
            >
              <QuickAction
                pal={C}
                label={t('home.quickAdd')}
                Icon={PlusSquare}
                onPress={() => router.push('/(tabs)/add')}
              />
              <QuickAction
                pal={C}
                label={t('home.quickScan')}
                Icon={Camera}
                onPress={() => router.push('/receipt-scan')}
              />
              {/* The bar's own Insights glyph, not `Sparkles`.

                  Both open the same screen, and they were wearing different
                  icons for it — a shortcut whose picture disagrees with the
                  destination's is worse than no shortcut. Sparkles lost for the
                  reason the generator already records for the tab: it says
                  "AI", and the page is charts.

                  Add is *not* held to the same rule, and the difference is the
                  register rather than the subject. Sparkles and a bar chart are
                  two different pictures of one page. `PlusSquare` and the bar's
                  plus are the same mark twice: a hairline cross reads correctly
                  in a bar of hairline glyphs and reads like a mistake in a row
                  of solid ones. Matching the neighbours it is actually beside
                  is what both choices come down to. */}
              <QuickAction
                pal={C}
                label={t('home.quickInsights')}
                Icon={TabIcons.insights.fill}
                onPress={() => router.push('/(tabs)/insights')}
              />
              <QuickAction
                pal={C}
                label={t('home.quickBudgets')}
                Icon={PieChart}
                onPress={() => router.push('/category-budgets')}
              />
            </View>

            {/* 2 — one budget line */}
            <BudgetLine
              pal={C}
              sentence={budgetSentence()}
              spent={monthSpent}
              budget={monthlyBudget}
              style={{ marginTop: S.section }}
            />

            {/* 3 — one insight, in plain English */}
            {insight ? (
              <Insight
                pal={C}
                text={t(`home.insight.${insight.key}`, insight.params)}
                actions={insight.actions.map((a) => ({
                  label: t(`home.action.${a}`),
                  onPress: () => router.push(ROUTES[a] as never),
                }))}
                // `group`, not `section`: the budget line and the sentence
                // about it are one thought.
                style={{ marginTop: S.group }}
              />
            ) : null}

            {/* 4 — recent activity */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader
                pal={C}
                title={t('home.recent')}
                actionLabel={recent.length > 0 ? t('home.seeAll') : undefined}
                onAction={recent.length > 0 ? () => router.push('/(tabs)/transactions') : undefined}
              />
              {recent.length > 0 ? (
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {recent.map((tx, i) => (
                      <View
                        key={tx.id}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                      >
                        <Row
                          pal={C}
                          title={tx.note?.trim() || categoryLabel(tx.category)}
                          meta={`${categoryLabel(tx.category)} · ${format(new Date(`${tx.dateISO}T12:00:00`), 'd MMM', { locale: getDateFnsLocale() })}`}
                          amount={tx.type === 'Income' ? tx.amount : -tx.amount}
                          format={formatCurrency}
                          markColor={C.cat[categoryMarkIndex(tx.category, C.cat.length)]}
                          onPress={() => router.push('/(tabs)/transactions')}
                        />
                      </View>
                    ))}
                  </Card>
                </View>
              ) : (
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={C}>
                    <Type role="body" color={C.inkDim}>
                      {t('home.recentEmpty')}
                    </Type>
                  </Card>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
