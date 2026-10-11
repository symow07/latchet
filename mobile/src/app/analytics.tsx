import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PartyPopper, RefreshCw } from '@/components/icons';

import { getSettings, getTransactions } from '@/lib/db';
import { formatCurrency } from '@/lib/calculations';
import { categoryLabel } from '@/lib/category-meta';
import {
  generateAnalyticsSummary,
  type AnalyticsSummary,
} from '@/lib/behavior-detection';
import { R, S, useC } from '@/lib/design';
import { categoryIcon } from '@/components/category-icon';
import {
  BalanceCard,
  Card,
  Empty,
  FilterChip,
  InfoRow,
  LinkRow,
  Row,
  Screen,
  SectionHeader,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

/** A stored YYYY-MM-DD as "12 Oct" in the reader's language, read as a calendar date. */
function shortDate(iso: string): string {
  return format(parseISO(`${iso.slice(0, 10)}T00:00:00`), 'd MMM', { locale: getDateFnsLocale() });
}

type TabType = 'overview' | 'subscriptions' | 'insights' | 'alerts';

/**
 * Spending report — DESIGN-PROMPT.md §20, plus the alerts of board §21.
 *
 * This screen was the loudest thing in the app. It opened on an amber
 * gradient header in a hue that appears nowhere else in the system, carried
 * four pill tabs filled in `#f59e0b`, and then stacked five *different*
 * tinted card styles — purple, blue, red, amber, green — each with a 1px
 * border in its own colour. Six section labels were 11px uppercase, which §3
 * has no style for on purpose: adding one is what makes an app look like a
 * dashboard, and "dashboard" is the first word in §1's anti-tone list.
 *
 * The rebuild keeps every finding and changes how they are said. One espresso
 * anchor carries the number worth acting on — what you could save — and folds
 * the alert count into its caption, so the two competing stat tiles become
 * one. Everything below is plain cards and rows on the page, and severity is
 * written in words rather than encoded in a border colour, which is the same
 * rule §3 applies to signed amounts. A flagged transaction is a transaction:
 * its category's glyph, and its amount signed and in red.
 */

/** Rows of a card, hairline-separated. Used four times here; it is not worth
 *  a kit component until a second screen needs it. */
function Rows({ pal, children }: { pal: ReturnType<typeof useC>; children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        {items.map((child, i) => (
          <View
            key={i}
            style={i > 0 ? { borderTopWidth: 1, borderTopColor: pal.hairline } : undefined}
          >
            {child}
          </View>
        ))}
      </Card>
    </View>
  );
}

/** A paragraph of the advisor's prose, with its subject above it. §1.3. */
function Note({
  pal,
  title,
  body,
  footnote,
}: {
  pal: ReturnType<typeof useC>;
  title: string;
  body: string;
  footnote?: string;
}) {
  return (
    <View style={{ paddingVertical: 14 }}>
      <Type role="cardTitle" color={pal.ink}>
        {title}
      </Type>
      <Type role="body" color={pal.inkDim} style={{ marginTop: 4 }}>
        {body}
      </Type>
      {footnote ? (
        <Type role="meta" color={pal.accent} style={{ marginTop: 8 }}>
          {footnote}
        </Type>
      ) : null}
    </View>
  );
}

export default function AnalyticsScreen() {
  const C = useC();
  const router = useRouter();

  // The Insights hub links straight to a section — "Alerts" there should open
  // alerts here, not drop the user on Overview to find them.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const initialTab: TabType =
    tab === 'subscriptions' || tab === 'insights' || tab === 'alerts' ? tab : 'overview';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
  });
  // Read so the screen re-renders when the currency changes; the amounts
  // themselves go through the shared formatter.
  useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const transactionsLength = transactions.length;
  useEffect(() => {
    if (transactionsLength > 0) setAnalytics(generateAnalyticsSummary(transactions));
  }, [transactionsLength, transactions]);

  const alertCount = analytics?.alertCount ?? 0;
  const tabs: readonly { id: TabType; label: string }[] = [
    { id: 'overview', label: t('analyticsTabs.overview') },
    { id: 'subscriptions', label: t('analyticsTabs.subscriptions') },
    { id: 'insights', label: t('analyticsTabs.insights') },
    { id: 'alerts', label: t('analyticsTabs.alerts') },
  ];

  const priority = (severity: 'low' | 'medium' | 'high') =>
    severity === 'high'
      ? t('analytics.priorityHigh')
      : severity === 'medium'
        ? t('analytics.priorityMedium')
        : t('analytics.priorityLow');

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 80 }}
      >
        <SubHeader pal={C} title={t('analytics.title')} onBack={() => router.back()} />

        {/* The one espresso anchor. Two stat tiles became one card because only
            one of the two numbers is something you can act on; the other is
            a count, and a count belongs in a caption. */}
        <BalanceCard
          pal={C}
          label={t('analytics.potentialSavings')}
          amount={analytics?.potentialMonthlySavings ?? 0}
          format={formatCurrency}
          caption={t('analytics.alertsCaption', { count: alertCount })}
          style={{ paddingHorizontal: S.screen, marginTop: 24 }}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 24 }}
          contentContainerStyle={{ paddingHorizontal: S.screen, gap: 8 }}
        >
          {tabs.map((tabSpec) => (
            <FilterChip
              key={tabSpec.id}
              pal={C}
              label={tabSpec.label}
              active={activeTab === tabSpec.id}
              onPress={() => setActiveTab(tabSpec.id)}
            />
          ))}
        </ScrollView>

        {!analytics ? (
          <Empty
            pal={C}
            icon={<RefreshCw size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('common.nothingYet')}
            body={t('analytics.noPatterns')}
            style={{ marginTop: 72 }}
          />
        ) : activeTab === 'overview' ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader pal={C} title={t('analytics.topWaste')} />
            <Rows pal={C}>
              {analytics.wasteCategories.map((waste, i) => (
                <InfoRow
                  key={waste.category}
                  pal={C}
                  title={categoryLabel(waste.category)}
                  meta={[
                    t('common.transactions', { count: waste.transactionCount }),
                    `${t('analytics.avg')} ${formatCurrency(waste.averageTransaction)}`,
                    `${Math.round(waste.impulsePercentage)}% ${t('importExtra.impulse')}`,
                  ].join(' · ')}
                  amount={waste.totalSpent}
                  format={formatCurrency}
                  lead={
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: R.pill,
                        borderCurve: 'continuous',
                        backgroundColor: C.groundSunk,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Type role="meta" color={C.inkDim}>
                        {i + 1}
                      </Type>
                    </View>
                  }
                />
              ))}
            </Rows>

            {analytics.spendingPatterns.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('analytics.patternsDetected')} />
                <Rows pal={C}>
                  {analytics.spendingPatterns.map((pattern) => (
                    <Note
                      key={pattern.type + pattern.period}
                      pal={C}
                      title={
                        pattern.type === 'weekend'
                          ? t('analytics.weekendSpike')
                          : t('analytics.seasonalChange')
                      }
                      body={pattern.insight}
                    />
                  ))}
                </Rows>
              </View>
            ) : null}

            <View style={{ marginTop: S.section }}>
              <Rows pal={C}>
                <LinkRow
                  pal={C}
                  title={t('analytics.monthlySubscriptions')}
                  body={formatCurrency(analytics.totalMonthlySubscriptions)}
                  onPress={() => setActiveTab('subscriptions')}
                />
              </Rows>
            </View>
          </View>
        ) : activeTab === 'subscriptions' ? (
          <View style={{ marginTop: S.section }}>
            {analytics.subscriptions.length === 0 ? (
              <Empty
                pal={C}
                icon={<RefreshCw size={26} color={C.accent} strokeWidth={S.stroke} />}
                title={t('common.nothingYet')}
                body={t('analytics.noPatterns')}
                style={{ marginTop: 40 }}
              />
            ) : (
              <>
                <SectionHeader
                  pal={C}
                  title={t('analytics.recurringFound', { count: analytics.subscriptions.length })}
                />
                <Rows pal={C}>
                  {analytics.subscriptions.map((sub) => (
                    <InfoRow
                      key={`${sub.description}-${sub.amount}`}
                      pal={C}
                      title={sub.description}
                      meta={[
                        t(`frequency.${sub.frequency}`),
                        `${t('analytics.nextDue')} ${shortDate(sub.nextExpected)}`,
                        `${t('analytics.totalSpent')} ${formatCurrency(sub.totalSpent)}`,
                      ].join(' · ')}
                      amount={sub.amount}
                      format={formatCurrency}
                    />
                  ))}
                </Rows>
              </>
            )}
          </View>
        ) : activeTab === 'insights' ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader pal={C} title={t('analytics.savingsTips')} />
            <Rows pal={C}>
              {analytics.wasteCategories.map((waste) => (
                <Note
                  key={waste.category}
                  pal={C}
                  title={categoryLabel(waste.category)}
                  body={waste.tip}
                  footnote={t('analytics.savingsPerMonth', {
                    amount: formatCurrency(waste.potentialSavings),
                  })}
                />
              ))}
            </Rows>

            {analytics.spendingPatterns.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('analytics.behavioralInsights')} />
                <Rows pal={C}>
                  {analytics.spendingPatterns.map((pattern) => (
                    <Note
                      key={pattern.type + pattern.period}
                      pal={C}
                      title={
                        pattern.type === 'weekend'
                          ? t('analytics.weekendSpending')
                          : t('analytics.seasonalTrend')
                      }
                      body={pattern.insight}
                    />
                  ))}
                </Rows>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ marginTop: S.section }}>
            {alertCount === 0 ? (
              /* §8 board 21: the all-clear should feel like a reward, not
                 like a screen that failed to load. */
              <Empty
                pal={C}
                icon={<PartyPopper size={26} color={C.accent} strokeWidth={S.stroke} />}
                title={t('analytics.allClear')}
                body={t('analytics.allClearBody')}
                style={{ marginTop: 40 }}
              />
            ) : (
              <>
                {analytics.duplicateCharges.length > 0 ? (
                  <>
                    <SectionHeader pal={C} title={t('analytics.duplicateCharges')} />
                    <Rows pal={C}>
                      {analytics.duplicateCharges.map((dup) => (
                        <InfoRow
                          key={`${dup.description}-${dup.date}`}
                          pal={C}
                          title={dup.description}
                          meta={`${t('analytics.chargesOf', {
                            count: dup.transactions.length,
                            amount: formatCurrency(dup.amount),
                            date: shortDate(dup.date),
                          })} · ${t('analytics.refundLine', {
                            amount: formatCurrency(dup.potentialRefund),
                          })}`}
                          amount={-dup.potentialRefund}
                          format={formatCurrency}
                          tone={C.negative}
                        />
                      ))}
                    </Rows>
                  </>
                ) : null}

                {analytics.unusualTransactions.length > 0 ? (
                  <View
                    style={{
                      marginTop: analytics.duplicateCharges.length > 0 ? S.section : 0,
                    }}
                  >
                    <SectionHeader pal={C} title={t('analytics.unusualTransactions')} />
                    <Rows pal={C}>
                      {analytics.unusualTransactions.map((unusual) => (
                        <Row
                          key={unusual.transaction.id}
                          pal={C}
                          title={
                            unusual.transaction.note ||
                            categoryLabel(unusual.transaction.category)
                          }
                          // Severity is said, not shown. Three tinted card
                          // styles asked the reader to learn a colour
                          // vocabulary to find out which alert mattered.
                          meta={`${priority(unusual.severity)} · ${unusual.reason}`}
                          // Only expenses are flagged, so the amount is money
                          // out: signed and red, as in every transaction list.
                          amount={-unusual.transaction.amount}
                          format={formatCurrency}
                          icon={categoryIcon(unusual.transaction.category, unusual.transaction.type)}
                        />
                      ))}
                    </Rows>
                  </View>
                ) : null}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
