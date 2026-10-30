import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronUp, Wrench } from '@/components/icons';
import { categoryIcon } from '@/components/category-icon';

import { getExpenses } from '@/lib/expenseApi';
import {
  formatNextCharge,
  toolsOverview,
  type DetectedSubscription,
} from '@/lib/business-subscription-detection';
import { getEmailDetectedForBusiness } from '@/lib/emailSubscriptionApi';
import { EmailScanCard } from '@/components/EmailScanCard';
import { formatCurrency } from '@/lib/calculations';
import { expenseCategoryLabel } from '@/lib/expense-meta';
import { R, S, useC, type Palette } from '@/lib/design';
import {
  BalanceCard,
  Card,
  CategoryTile,
  Empty,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  Stat,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

const readDate = (iso: string) => parseISO(iso.length > 10 ? iso : `${iso}T00:00:00`);
const longDate = (iso: string) => format(readDate(iso), 'd MMM yyyy', { locale: getDateFnsLocale() });

// ─── Cancel guide ────────────────────────────────────────────────────────────

function CancelGuideSheet({
  pal,
  sub,
  monthly,
  onClose,
}: {
  pal: Palette;
  sub: DetectedSubscription | null;
  /** The tool's cost per month: its charge, normalised by how often it falls. */
  monthly: number;
  onClose: () => void;
}) {
  if (!sub) return null;
  const steps = [
    { title: t('businessTools.step1Title'), body: sub.cancelInstructions },
    { title: t('businessTools.step2Title'), body: t('businessTools.step2Body') },
    { title: t('businessTools.step3Title'), body: t('businessTools.step3Body') },
  ];

  return (
    <Sheet pal={pal} visible onClose={onClose} title={sub.name}>
      <ScrollView
        style={{ maxHeight: 480 }}
        contentContainerStyle={{ paddingHorizontal: S.card, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', gap: 24 }}>
          {/* A rate needs a cadence: an irregular tool has no monthly cost
              to show, rather than a misleading zero. */}
          {sub.isRecurring ? (
            <Stat
              pal={pal}
              label={t('businessTools.monthlyCost')}
              value={monthly}
              format={formatCurrency}
              size={22}
            />
          ) : null}
          <Stat
            pal={pal}
            label={t('businessTools.nextCharge')}
            value={formatNextCharge(sub.nextChargeDate)}
            size={22}
          />
        </View>
        {sub.isRecurring ? (
          <Type role="meta" color={pal.inkDim} style={{ marginTop: 8 }}>
            {t('businessTools.perYear', { amount: formatCurrency(monthly * 12) })}
          </Type>
        ) : null}

        <Type role="cardTitle" color={pal.ink} style={{ marginTop: 24, marginBottom: 12 }}>
          {t('businessTools.cancelSteps')}
        </Type>
        <View style={{ gap: 16 }}>
          {steps.map((step, i) => (
            <View key={step.title} style={{ flexDirection: 'row', gap: 12 }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: R.pill,
                  borderCurve: 'continuous',
                  backgroundColor: pal.groundSunk,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 1,
                }}
              >
                <Type role="meta" color={pal.inkDim}>
                  {i + 1}
                </Type>
              </View>
              <View style={{ flex: 1 }}>
                <Type role="cardTitle" color={pal.ink}>
                  {step.title}
                </Type>
                <Type role="body" color={pal.inkDim} style={{ marginTop: 2 }}>
                  {step.body}
                </Type>
              </View>
            </View>
          ))}
        </View>

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16 }}>
          {t('businessTools.cancelBefore', {
            date: longDate(sub.nextChargeDate),
            amount: formatCurrency(sub.amount),
          })}
        </Type>

        {sub.cancelUrl ? (
          <PrimaryButton
            pal={pal}
            label={t('businessTools.openBilling')}
            onPress={() => sub.cancelUrl && Linking.openURL(sub.cancelUrl)}
            style={{ marginTop: 16 }}
          />
        ) : (
          <Type role="body" color={pal.inkDim} style={{ marginTop: 16 }}>
            {t('businessTools.searchFor', { name: sub.name })}
          </Type>
        )}
      </ScrollView>
    </Sheet>
  );
}

// ─── One tool ────────────────────────────────────────────────────────────────

function ToolRow({
  pal,
  sub,
  monthly,
  onCancelGuide,
}: {
  pal: Palette;
  sub: DetectedSubscription;
  /** Per month, so a yearly tool's annual cost is its price, not twelve of them. */
  monthly: number;
  onCancelGuide: (sub: DetectedSubscription) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Led by the category's glyph on a sunk tile, as every row is. It used to be
  // a coloured dot for how soon the charge falls, which was colour carrying a
  // meaning on its own; the meta line already says it in words ("Overdue",
  // "In 3 days").
  const glyph = categoryIcon(sub.category);

  // Business categories (Software, Travel, Meals, Office) are their own
  // vocabulary; the personal categoryLabel left them in English.
  const meta = [
    expenseCategoryLabel(sub.category),
    sub.isRecurring ? t('businessTools.recurring') : null,
    formatNextCharge(sub.nextChargeDate),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View>
      <InfoRow
        pal={pal}
        title={sub.name}
        meta={meta}
        amount={sub.amount}
        format={formatCurrency}
        onPress={() => setExpanded((v) => !v)}
        lead={<CategoryTile pal={pal} icon={glyph} />}
        trailing={
          expanded ? (
            <ChevronUp size={17} color={pal.inkFaint} strokeWidth={S.stroke} />
          ) : (
            <ChevronDown size={17} color={pal.inkFaint} strokeWidth={S.stroke} />
          )
        }
      />

      {expanded ? (
        <View style={{ paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {/* Only a tool with a cadence has a yearly cost; an irregular
                one has its charges, not a rate. */}
            {sub.isRecurring ? (
              <Stat
                pal={pal}
                label={t('businessTools.annualCost')}
                value={monthly * 12}
                format={formatCurrency}
                size={17}
                style={{ flex: 1 }}
              />
            ) : null}
            <Stat
              pal={pal}
              label={t('businessTools.lastCharged')}
              value={longDate(sub.lastChargeDate)}
              size={17}
              style={{ flex: 1 }}
            />
            {sub.isRecurring ? (
              <Stat
                pal={pal}
                label={t('businessTools.monthsSeen')}
                value={`${sub.monthlyCount}×`}
                size={17}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
          <PrimaryButton
            pal={pal}
            label={t('businessTools.howToCancel')}
            onPress={() => onCancelGuide(sub)}
            variant="secondary"
            style={{ marginTop: 16 }}
          />
        </View>
      ) : null}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

/**
 * Detected SaaS spend — DESIGN-PROMPT.md board §38.
 *
 * The old screen was three tinted panels deep: a tinted gradient hero with a
 * glow and three glass stat tiles inside it, an amber-tinted "upcoming" card
 * with amber dividers, and a tinted tip card, plus per-tool cards that
 * turned amber when a charge was near. Six section labels were 9–11px
 * uppercase tracked out to 1.2pt.
 *
 * Under that, every figure was `$${n.toFixed(2)}`, "/mo", "/year" and "/yr"
 * were hardcoded English suffixes, `'TOOLS'` and `'RECURRING'` were untranslated
 * stat labels, `tool${n !== 1 ? 's' : ''}` pluralised in English, and
 * `toLocaleDateString('en-US')` printed American dates — on the screen a
 * French or Arabic business owner uses to decide what to cancel.
 */
export default function BusinessToolsScreen() {
  const B = useC();
  const [cancelSub, setCancelSub] = useState<DetectedSubscription | null>(null);

  const { data: allExpenses = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['biz-expenses', undefined],
    queryFn: () => getExpenses(),
  });
  const { data: emailDetected = [], refetch: refetchEmail } = useQuery({
    queryKey: ['email-detected-biz'],
    queryFn: getEmailDetectedForBusiness,
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
      refetchEmail();
    }, [refetch, refetchEmail])
  );

  // Each tool's cost per month, so a yearly charge adds a twelfth of itself
  // to the monthly spend rather than all of it.
  const {
    tools: subscriptions,
    monthlyByKey,
    monthlyTotal,
    upcoming,
  } = toolsOverview(allExpenses, emailDetected);
  const monthlyOf = (sub: DetectedSubscription) => monthlyByKey[sub.key] ?? 0;

  return (
    <Screen pal={B}>
      <CancelGuideSheet
        pal={B}
        sub={cancelSub}
        monthly={cancelSub ? monthlyOf(cancelSub) : 0}
        onClose={() => setCancelSub(null)}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />
        }
      >
        <SubHeader pal={B} title={t('businessTools.title')} onBack={() => router.back()} />

        {/* The screen's one espresso anchor. The gutter sits on a wrapper:
            the card's own outer layer carries the espresso fill, so padding
            there would widen the anchor instead of insetting it. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <BalanceCard
            pal={B}
            label={t('businessTools.monthlySpend')}
            amount={monthlyTotal}
            format={formatCurrency}
            caption={t('businessTools.perYear', { amount: formatCurrency(monthlyTotal * 12) })}
          />
        </View>

        <View
          style={{ flexDirection: 'row', gap: 24, paddingHorizontal: S.screen, marginTop: 16 }}
        >
          <Stat
            pal={B}
            label={t('businessTools.toolsStat')}
            value={String(subscriptions.length)}
            size={20}
          />
          <Stat
            pal={B}
            label={t('businessTools.recurring')}
            value={String(subscriptions.filter((s) => s.isRecurring).length)}
            size={20}
          />
          <Stat
            pal={B}
            label={t('businessTools.dueSoon')}
            value={String(upcoming.length)}
            tone={upcoming.length > 0 ? B.warning : B.ink}
            size={20}
          />
        </View>

        <View style={{ marginTop: S.section }}>
          {/* No accent handed in: both profiles share the one tint now. */}
          <EmailScanCard />
        </View>

        {isLoading ? (
          <View style={{ paddingVertical: 64, alignItems: 'center' }}>
            <ActivityIndicator color={B.accent} />
          </View>
        ) : subscriptions.length === 0 ? (
          <Empty
            pal={B}
            icon={<Wrench size={26} color={B.accent} strokeWidth={S.stroke} />}
            title={t('businessTools.none')}
            body={t('businessTools.emptyHint')}
            style={{ marginTop: S.section }}
          />
        ) : (
          <>
            {upcoming.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader
                  pal={B}
                  title={t('businessTools.upcomingCharges', { count: upcoming.length })}
                />
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {upcoming.map((sub, i) => (
                      <View
                        key={sub.key}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : undefined}
                      >
                        <InfoRow
                          pal={B}
                          title={sub.name}
                          meta={formatNextCharge(sub.nextChargeDate)}
                          amount={sub.amount}
                          format={formatCurrency}
                        />
                      </View>
                    ))}
                  </Card>
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: S.section }}>
              <SectionHeader
                pal={B}
                title={t('businessTools.allTools', { count: subscriptions.length })}
              />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {subscriptions.map((sub, i) => (
                    <View
                      key={sub.key}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : undefined}
                    >
                      <ToolRow
                        pal={B}
                        sub={sub}
                        monthly={monthlyOf(sub)}
                        onCancelGuide={setCancelSub}
                      />
                    </View>
                  ))}
                </Card>
              </View>
            </View>

            <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
              <Type role="cardTitle" color={B.ink}>
                {t('businessTools.cancelTip')}
              </Type>
              <Type role="body" color={B.inkDim} style={{ marginTop: 6 }}>
                {t('businessTools.cancelTipBody')}
              </Type>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
