import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Briefcase, ClipboardCheck, PlusSquare, Receipt, Users, Wrench } from '@/components/icons';
import { useSession } from '@/lib/auth/use-session';
import { getExpenses } from '@/lib/expenseApi';
import { getBusiness } from '@/lib/businessApi';
import { getBudget } from '@/lib/budgetApi';
import { roleOf } from '@/lib/group-members';
import { detectSubscriptions } from '@/lib/business-subscription-detection';
import { expenseCategoryLabel } from '@/lib/expense-meta';
import { pickBizInsight, type BizInsightAction } from '@/lib/biz-insight';
import { formatCurrency } from '@/lib/calculations';
import { BAR, S, useB } from '@/lib/design';
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
} from '@/components/kit';
import { t } from '@/lib/i18n/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function greetingWord(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 17) return t('greeting.afternoon');
  if (hour < 21) return t('greeting.evening');
  return t('greeting.night');
}

/**
 * Business home — DESIGN-PROMPT.md §32.
 *
 * The direct counterpart to personal home: the same skeleton, the same
 * spacing, the same components, mint instead of violet. A user switching
 * profiles should feel they changed rooms, not apps (§0), and the way to earn
 * that is for these two files to differ only in what they are about.
 *
 * The approved total is the one dark object; the pending queue is the insight
 * (see biz-insight for why it is folded in rather than given its own block).
 */
export default function BusinessHomeScreen() {
  const insets = useSafeAreaInsets();
  const B = useB();
  const { data: session } = useSession();

  const { data: allExpenses = [], isLoading } = useQuery({
    queryKey: ['biz-expenses', undefined],
    queryFn: () => getExpenses(),
  });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });
  // The budget lives on the backend and may not be set; a failure here should
  // cost the budget line, not the screen.
  const { data: budgetData } = useQuery({
    queryKey: ['biz-budget'],
    queryFn: getBudget,
    retry: false,
  });

  const firstName = session?.user?.name?.split(' ')[0];
  const title = firstName
    ? t('home.greetingName', { greeting: greetingWord(), name: firstName })
    : greetingWord();

  const myRole = roleOf(business, session?.user?.id);
  const canReview = myRole === 'owner' || myRole === 'manager';

  const approved = allExpenses.filter((e) => e.status === 'approved');
  const pending = allExpenses.filter((e) => e.status === 'pending');
  const mine = pending.filter((e) => e.submitter.id === session?.user?.id);
  const approvedTotal = approved.reduce((s, e) => s + e.amount, 0);

  const monthlyBudget = budgetData?.budget.totalMonthly ?? 0;
  const approvedSpend = budgetData?.spending.approved ?? approvedTotal;
  const tools = detectSubscriptions(allExpenses);

  const insight = pickBizInsight({
    pendingCount: canReview ? pending.length : mine.length,
    canReview,
    monthlyBudget,
    approvedSpend,
    toolMonthly: tools.monthlyTotal,
    money: formatCurrency,
  });

  const ROUTES: Record<BizInsightAction, string> = {
    review: '/(business-tabs)/expenses',
    tools: '/business-tools',
    setBudget: '/(business-tabs)/insights',
  };

  const budgetSentence = () => {
    if (monthlyBudget <= 0) return t('bizHome.budgetNone');
    const remaining = monthlyBudget - approvedSpend;
    return remaining >= 0
      ? t('bizHome.budgetLeft', {
          left: formatCurrency(remaining),
          budget: formatCurrency(monthlyBudget),
        })
      : t('bizHome.budgetOver', {
          amount: formatCurrency(-remaining),
          budget: formatCurrency(monthlyBudget),
        });
  };

  const recent = allExpenses.slice(0, 5);

  return (
    <Screen pal={B}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}
      >
        {/* Same demotion as personal home, and for the same reason: the
            approved total below is the subject, not the time of day. */}
        <Header
          pal={B}
          title={title}
          role="section"
          subtitle={business?.name ?? undefined}
          actions={
            <CircleAction
              pal={B}
              label={t('business.businessTools')}
              onPress={() => router.push('/business-tools')}
            >
              <Briefcase size={19} color={B.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        {isLoading ? (
          <ActivityIndicator color={B.accent} style={{ marginTop: 80 }} />
        ) : allExpenses.length === 0 ? (
          <Empty
            pal={B}
            icon={<Receipt size={26} color={B.accent} strokeWidth={S.stroke} />}
            title={t('bizHome.emptyTitle')}
            body={t('bizHome.emptyBody')}
            actionLabel={t('bizHome.emptyAction')}
            onAction={() => router.push('/(business-tabs)/expenses')}
            style={{ marginTop: 80 }}
          />
        ) : (
          <>
            {/* 1 — the approved total, as the one dark object */}
            <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
              <BalanceCard
                pal={B}
                label={t('bizHome.approvedLabel')}
                amount={approvedTotal}
                caption={t('bizHome.approvedCaption', { count: approved.length })}
                format={formatCurrency}
                onPress={() => router.push('/(business-tabs)/expenses')}
              />
            </View>

            {/* The four places people go straight from here. Mirrors the
                personal home — the two are a designed pair, so the rhythm and
                the affordances match and only the accent differs. */}
            <View
              style={{ flexDirection: 'row', paddingHorizontal: S.screen, gap: 12, marginTop: S.group }}
            >
              <QuickAction
                pal={B}
                label={t('bizHome.quickAdd')}
                Icon={PlusSquare}
                onPress={() => router.push('/(business-tabs)/expenses')}
              />
              {/* A clipboard with a tick, not the double tick.
                  `CheckCheck` is a utility mark and stays a hairline one — this
                  row had two of them among two solid pictures, which is the
                  same mismatch the personal row had once. */}
              <QuickAction
                pal={B}
                label={t('bizHome.quickReview')}
                Icon={ClipboardCheck}
                onPress={() => router.push('/(business-tabs)/expenses')}
              />
              <QuickAction
                pal={B}
                label={t('bizHome.quickTools')}
                Icon={Wrench}
                onPress={() => router.push('/business-tools')}
              />
              <QuickAction
                pal={B}
                label={t('bizHome.quickTeam')}
                Icon={Users}
                onPress={() => router.push('/business-team')}
              />
            </View>

            {/* 2 — one budget line */}
            <BudgetLine
              pal={B}
              sentence={budgetSentence()}
              spent={approvedSpend}
              budget={monthlyBudget}
              style={{ marginTop: S.section }}
            />

            {/* 3 — one insight, which is where the pending count lives */}
            <Insight
              pal={B}
              text={t(`bizHome.${insight.key}`, insight.params)}
              actions={insight.actions.map((a) => ({
                label: t(a === 'review' ? 'bizHome.review' : a === 'tools' ? 'bizHome.tools' : 'home.action.setBudget'),
                onPress: () => router.push(ROUTES[a] as never),
              }))}
              style={{ marginTop: S.group }}
            />

            {/* 4 — recent expenses */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader
                pal={B}
                title={t('bizHome.recent')}
                actionLabel={t('bizHome.seeAll')}
                onAction={() => router.push('/(business-tabs)/expenses')}
              />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {recent.map((e, i) => (
                    <View
                      key={e.id}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : undefined}
                    >
                      <Row
                        pal={B}
                        title={e.description}
                        meta={`${e.submitter.name} · ${expenseCategoryLabel(e.category)}`}
                        amount={-e.amount}
                        format={formatCurrency}
                        markColor={
                          e.status === 'approved'
                            ? B.positive
                            : e.status === 'rejected'
                              ? B.negative
                              : B.warning
                        }
                        onPress={() => router.push('/(business-tabs)/expenses')}
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
