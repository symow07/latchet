import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Camera, MessageCircle, Repeat, Wallet } from '@/components/icons';
import { categoryIcon } from '@/components/category-icon';
import { GettingStarted } from '@/components/GettingStarted';
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
import { categoryLabel } from '@/lib/category-meta';
import { pickHomeInsight, type InsightAction } from '@/lib/home-insight';
import { dayOfMonth, daysInMonth } from '@/lib/dates';
import { useSession } from '@/lib/auth/use-session';
import { syncAchievements } from '@/lib/achievementsApi';
import { presentBadgeEarned } from '@/lib/notifications';
import { BAR, S, useC } from '@/lib/design';
import {
  AnchorBudget,
  BalanceCard,
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
import { ELEVATION } from '@/lib/identity/tokens';
import { accountTypeLabel, signedAccountBalance } from '@/lib/tx-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How far the anchor's shadow reaches past the card, above and below. The
 * balance pager clips to its own bounds, so it is padded by this much.
 */
const PAGER_BLEED = {
  top: Math.max(...ELEVATION.anchor.map((l) => l.blur - l.y)),
  bottom: Math.max(...ELEVATION.anchor.map((l) => l.y + l.blur)),
};

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
    // The goal editor, which writes the goal alone. This used to open
    // onboarding again, which reset the currency and the starting balance.
    setGoal: '/goal',
    ask: '/(tabs)/advisor',
    seeImpulse: '/analytics?tab=insights',
  };

  // Good news gets the identity's self-drawing check; cautions do not.
  const GOOD_NEWS = new Set(['saving', 'streak', 'steady', 'down', 'downWithGoal']);

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
      // A card's or a loan's balance is what you owe, so it reads as negative
      // against the others rather than adding to them.
      amount: signedAccountBalance(a),
      caption: accountTypeLabel(a.type),
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
          <>
            <Empty
              pal={C}
              // Shown instead of the anchor, so its action is the espresso block.
              actionVariant="ink"
              icon={<Wallet size={26} color={C.accent} strokeWidth={S.stroke} />}
              title={t('home.emptyTitle')}
              body={t('home.emptyBody')}
              actionLabel={t('home.emptyAction')}
              onAction={() => router.push('/(tabs)/add')}
              style={{ marginTop: 80 }}
            />
            {/* What onboarding left to connect, until it is done or hidden. */}
            <GettingStarted style={{ marginTop: S.section }} />
          </>
        ) : (
          <>
            {/* 1 — the balance */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={cardWidth + 12}
              decelerationRate="fast"
              // Horizontal ScrollViews fill their parent without this. The
              // pager clips to its bounds, so it is padded by the anchor's
              // shadow and pulled back by the same amount: without that the
              // shadow ended in a straight line under the card.
              style={{ flexGrow: 0, marginTop: 24 - PAGER_BLEED.top, marginBottom: -PAGER_BLEED.bottom }}
              contentContainerStyle={{
                paddingHorizontal: S.screen,
                paddingTop: PAGER_BLEED.top,
                paddingBottom: PAGER_BLEED.bottom,
                gap: 12,
              }}
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
                >
                  {/* The month's budget lives inside the total card, as in the
                      identity's sample: a metallic silver line and the silver
                      Remaining figure. The account cards carry only their own
                      balance. */}
                  {i === 0 ? (
                    monthlyBudget > 0 ? (
                      <AnchorBudget
                        pal={C}
                        spent={monthSpent}
                        budget={monthlyBudget}
                        format={formatCurrency}
                        remainingLabel={t('bizStats.remaining')}
                        budgetLabel={t('tabs.budget')}
                        sentence={budgetSentence()}
                        style={{ marginTop: 24 }}
                      />
                    ) : (
                      <Type role="meta" color={C.onEspressoDim} style={{ marginTop: 16 }}>
                        {budgetSentence()}
                      </Type>
                    )
                  ) : null}
                </BalanceCard>
              ))}
            </ScrollView>

            {cards.length > 1 ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                {cards.map((c, i) => (
                  <View
                    key={c.key}
                    // The current page is longer as well as darker, so it
                    // does not rest on colour alone.
                    style={{
                      width: i === page ? 16 : 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: i === page ? C.ink : C.silver,
                    }}
                  />
                ))}
              </View>
            ) : null}

            {/* Two shortcuts, neither of which the tab bar already gives.
                Add and Insights are tabs, and Budgets is one tap from the
                balance card, so the old four-tile row mostly duplicated the
                bar. Scan Receipt and Subscriptions are the two places people
                go straight from here that the bar does not reach. */}
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
                label={t('receiptScan.title')}
                Icon={Camera}
                onPress={() => router.push('/receipt-scan')}
              />
              <QuickAction
                pal={C}
                label={t('subscriptionsScreen.title')}
                Icon={Repeat}
                onPress={() => router.push('/subscriptions')}
              />
            </View>

            {/* What onboarding's Connect your data left undone, and a
                savings goal: a short list that ticks itself off and goes
                when it is done or hidden (components/GettingStarted.tsx). */}
            <GettingStarted style={{ marginTop: S.section }} />

            {/* One insight, in plain English. The budget it would sit under
                now lives inside the balance card. */}
            {insight ? (
              <Insight
                pal={C}
                check={GOOD_NEWS.has(insight.key)}
                text={t(`home.insight.${insight.key}`, insight.params)}
                actions={insight.actions.map((a) => ({
                  label: t(`home.action.${a}`),
                  onPress: () => router.push(ROUTES[a] as never),
                }))}
                style={{ marginTop: S.section }}
              />
            ) : null}

            {/* Recent activity */}
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
                          icon={categoryIcon(tx.category, tx.type)}
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
