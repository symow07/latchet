import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Briefcase, Receipt, Users, Wrench } from '@/components/icons';
import { categoryIcon } from '@/components/category-icon';
import { useSession } from '@/lib/auth/use-session';
import { getExpenses } from '@/lib/expenseApi';
import { getBusiness } from '@/lib/businessApi';
import { getBudget } from '@/lib/budgetApi';
import { roleOf } from '@/lib/group-members';
import { pendingForViewer } from '@/lib/expense-review';
import { detectSubscriptions } from '@/lib/business-subscription-detection';
import { expenseCategoryLabel, expenseStatusLabel } from '@/lib/expense-meta';
import { pickBizInsight, type BizInsightAction } from '@/lib/biz-insight';
import { formatCurrency } from '@/lib/calculations';
import { BAR, S, useC, type Palette } from '@/lib/design';
import {
  Amount,
  AnchorBudget,
  BalanceCard,
  Card,
  CircleAction,
  Empty,
  Header,
  IconTile,
  InfoRow,
  Insight,
  QuickAction,
  Screen,
  SectionHeader,
  Type,
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
 * An expense's review state, as a colour that always travels with its word:
 * approved is green, rejected red, pending the warning tone.
 */
function statusTone(pal: Palette, status: string): string {
  return status === 'approved' ? pal.positive : status === 'rejected' ? pal.negative : pal.warning;
}

/** Good news earns the identity's self-drawing check; a queue or a warning does not. */
const GOOD_NEWS = new Set(['steady']);

/**
 * Business home — DESIGN-PROMPT.md §32.
 *
 * The direct counterpart to personal home: the same skeleton, the same
 * spacing, the same components and the same identity. The profile changes the
 * content, never the colours. A user switching profiles should feel they
 * changed rooms, not apps (§0), and the way to earn that is for these two
 * files to differ only in what they are about.
 *
 * The approved total is the espresso anchor, with the month's budget folded
 * into it as on personal home; the pending queue is the insight (see
 * biz-insight for why it is folded in rather than given its own block).
 */
export default function BusinessHomeScreen() {
  const insets = useSafeAreaInsets();
  const B = useC();
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

  const viewerId = session?.user?.id;
  const myRole = roleOf(business, viewerId);

  const approved = allExpenses.filter((e) => e.status === 'approved');
  // What is waiting for *this* viewer: an owner's own expense waits for a
  // manager, not for them, so it is counted as theirs rather than as a review.
  const { toReview, mine } = pendingForViewer(allExpenses, viewerId, myRole);
  const approvedTotal = approved.reduce((s, e) => s + e.amount, 0);

  const monthlyBudget = budgetData?.budget.totalMonthly ?? 0;
  const approvedSpend = budgetData?.spending.approved ?? approvedTotal;
  const tools = detectSubscriptions(allExpenses);

  const insight = pickBizInsight({
    pendingCount: toReview > 0 ? toReview : mine,
    canReview: toReview > 0,
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
            // Shown instead of the anchor, so its action is the espresso block.
            actionVariant="ink"
            icon={<Receipt size={26} color={B.accent} strokeWidth={S.stroke} />}
            title={t('bizHome.emptyTitle')}
            body={t('bizHome.emptyBody')}
            actionLabel={t('bizHome.emptyAction')}
            onAction={() => router.push('/(business-tabs)/expenses')}
            style={{ marginTop: 80 }}
          />
        ) : (
          <>
            {/* 1 — the approved total: the screen's one espresso anchor, with
                the month's budget inside it as on personal home — a metallic
                silver line and the silver Remaining figure. */}
            <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
              <BalanceCard
                pal={B}
                label={t('bizHome.approvedLabel')}
                amount={approvedTotal}
                caption={t('bizHome.approvedCaption', { count: approved.length })}
                format={formatCurrency}
                onPress={() => router.push('/(business-tabs)/expenses')}
              >
                {monthlyBudget > 0 ? (
                  <AnchorBudget
                    pal={B}
                    spent={approvedSpend}
                    budget={monthlyBudget}
                    format={formatCurrency}
                    remainingLabel={t('bizStats.remaining')}
                    budgetLabel={t('businessInsights.budgetLabel')}
                    sentence={budgetSentence()}
                    style={{ marginTop: 24 }}
                  />
                ) : (
                  <Type role="meta" color={B.onEspressoDim} style={{ marginTop: 16 }}>
                    {budgetSentence()}
                  </Type>
                )}
              </BalanceCard>
            </View>

            {/* Two shortcuts, neither of which the tab bar already gives,
                mirroring the personal home: the two are a designed pair. Add
                and Review used to sit here too, and both only opened the
                Expenses tab, one tap away in the bar (Add is that screen's
                +, and the insight below carries "Review them"). Four tiles
                also left each too narrow for its label: "Review" broke
                mid-word. */}
            <View
              style={{ flexDirection: 'row', paddingHorizontal: S.screen, gap: 12, marginTop: 24 }}
            >
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

            {/* 2 — one insight, which is where the pending count lives. The
                budget it used to sit under now lives inside the anchor. */}
            <Insight
              pal={B}
              check={GOOD_NEWS.has(insight.key)}
              text={t(`bizHome.${insight.key}`, insight.params)}
              actions={insight.actions.map((a) => ({
                label: t(a === 'review' ? 'bizHome.review' : a === 'tools' ? 'bizHome.tools' : 'home.action.setBudget'),
                onPress: () => router.push(ROUTES[a] as never),
              }))}
              style={{ marginTop: S.section }}
            />

            {/* 3 — recent expenses. Each is money out, so its amount is red
                with a minus; its review state is a word in its own tone
                (approved green, rejected red, pending amber), so the state
                never rests on colour alone. */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader
                pal={B}
                title={t('bizHome.recent')}
                actionLabel={t('bizHome.seeAll')}
                onAction={() => router.push('/(business-tabs)/expenses')}
              />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {recent.map((e, i) => {
                    const Glyph = categoryIcon(e.category);
                    return (
                      <View
                        key={e.id}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : undefined}
                      >
                        <InfoRow
                          pal={B}
                          title={e.description}
                          meta={`${e.submitter.name} · ${expenseCategoryLabel(e.category)}`}
                          lead={
                            <IconTile pal={B} size={40} style={{ backgroundColor: B.groundSunk }}>
                              <Glyph size={22} color={B.ink} />
                            </IconTile>
                          }
                          trailing={
                            <View style={{ alignItems: 'flex-end' }}>
                              <Amount
                                value={-e.amount}
                                format={formatCurrency}
                                size={17}
                                weight="medium"
                                color={B.negative}
                                signed
                              />
                              <Type role="meta" color={statusTone(B, e.status)}>
                                {expenseStatusLabel(e.status)}
                              </Type>
                            </View>
                          }
                          onPress={() => router.push('/(business-tabs)/expenses')}
                        />
                      </View>
                    );
                  })}
                </Card>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
