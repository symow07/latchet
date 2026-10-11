import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { RefreshCw } from '@/components/icons';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';

import { getSubscriptions, type Subscription } from '@/lib/db';
import { EmailScanCard } from '@/components/EmailScanCard';
import {
  monthlySubscriptionTotal,
  scanAndSaveSubscriptions,
} from '@/lib/subscription-detection';
import { formatCurrency } from '@/lib/calculations';
import { R, S, useC } from '@/lib/design';
import {
  BalanceCard,
  Card,
  CircleAction,
  Empty,
  InfoRow,
  Meter,
  Screen,
  Segmented,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

type SegmentKey = 'confirmed' | 'possible' | 'canceled';

/**
 * Subscriptions — DESIGN-PROMPT.md §22: monthly total, then confirmed /
 * possible / cancelled.
 *
 * The old screen said the status four times over. Every row carried a status
 * icon, a status-tinted icon well, a violet cadence badge and — in the
 * "possible" segment — a confidence bar that changed between green, amber and
 * red at 60% and 40%. All of that sat under a segmented control that had
 * *already* filtered the list to one status, so every row in view was the
 * same status as every other. The colour was carrying no information at all.
 *
 * It now says it once: the segment. Rows are a merchant (its initial on a
 * neutral sunk tile — a merchant is not a category, and a colour per merchant
 * would be a rainbow), a cadence, when the next charge lands, and a price. Confidence keeps its bar because it is the
 * one number that varies inside a segment, and the bar is `accentMark` like
 * every other meter in the app rather than a traffic light.
 *
 * There is also one scan control instead of three. The header refresh always
 * works; the empty state offers the same action in words.
 */
function segments(): readonly { key: SegmentKey; label: string }[] {
  return [
    { key: 'confirmed', label: t('subStatus.confirmed') },
    { key: 'possible', label: t('subStatus.possible') },
    { key: 'canceled', label: t('subStatus.canceled') },
  ];
}

/** When the next charge lands, in the words the app already has for it. */
function nextChargeLabel(nextExpectedAt: string | null): string | null {
  if (!nextExpectedAt) return null;
  const next = parseISO(nextExpectedAt);
  const days = differenceInCalendarDays(next, new Date());
  const on = format(next, 'd MMM', { locale: getDateFnsLocale() });

  if (days < 0) return `${t('subStatus.overdue')} · ${on}`;
  if (days === 0) return t('subStatus.today');
  if (days === 1) return t('subStatus.tomorrow');
  return `${t('subStatus.inDays', { count: days })} · ${on}`;
}

export default function SubscriptionsScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<SegmentKey>('confirmed');
  const [isScanning, setIsScanning] = useState(false);

  const { data: all = [], isLoading } = useQuery<Subscription[]>({
    queryKey: ['subscriptions'],
    queryFn: () => getSubscriptions(),
  });

  const filtered = all.filter((s) => s.status === segment);
  const monthlyTotal = monthlySubscriptionTotal(all);
  const activeCount = all.filter((s) => s.status !== 'canceled').length;

  async function handleScan() {
    if (isScanning) return;
    setIsScanning(true);
    try {
      await scanAndSaveSubscriptions();
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    } catch (e) {
      console.error('[Subscriptions] scan error:', e);
    } finally {
      setIsScanning(false);
    }
  }

  const emptyCopy: Record<SegmentKey, { title: string; body: string }> = {
    confirmed: { title: t('subStatus.noConfirmed'), body: t('subStatus.noConfirmedBody') },
    possible: { title: t('subStatus.noPossible'), body: t('subStatus.noPossibleBody') },
    canceled: { title: t('subStatus.noCanceled'), body: t('misc2.noCanceledBody') },
  };

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
      >
        <SubHeader
          pal={C}
          title={t('subscriptionsScreen.title')}
          onBack={() => router.back()}
          action={
            <CircleAction
              pal={C}
              label={t('subscriptionsScreen.rescan')}
              onPress={isScanning ? undefined : handleScan}
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={C.ink} />
              ) : (
                <RefreshCw size={18} color={C.ink} strokeWidth={S.stroke} />
              )}
            </CircleAction>
          }
        />

        <BalanceCard
          pal={C}
          label={t('subscriptionsScreen.monthlyTotal')}
          amount={monthlyTotal}
          format={formatCurrency}
          caption={t('subscriptionsScreen.activeCaption', { count: activeCount })}
          style={{ paddingHorizontal: S.screen, marginTop: 24 }}
        />

        <Segmented
          pal={C}
          options={segments()}
          value={segment}
          onChange={setSegment}
          style={{ marginTop: 24, marginHorizontal: S.screen }}
        />

        <View style={{ marginTop: S.section }}>
          <EmailScanCard accent={C.accent} />
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 48, alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : filtered.length === 0 ? (
          <Empty
            pal={C}
            icon={<RefreshCw size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={emptyCopy[segment].title}
            body={emptyCopy[segment].body}
            // Only where scanning would actually change what is on screen —
            // an offer to re-scan under an empty "cancelled" list is noise.
            actionLabel={
              segment !== 'canceled'
                ? isScanning
                  ? t('subscriptionsScreen.scanning')
                  : t('subscriptionsScreen.scanFor')
                : undefined
            }
            onAction={segment !== 'canceled' ? handleScan : undefined}
            style={{ marginTop: 40 }}
          />
        ) : (
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {filtered.map((sub, i) => {
                const next = sub.status === 'canceled' ? null : nextChargeLabel(sub.nextExpectedAt);
                const meta = [t(`frequency.${sub.cadence}`), next].filter(Boolean).join(' · ');
                return (
                  <View
                    key={sub.id}
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                  >
                    <InfoRow
                      pal={C}
                      title={sub.merchantDisplay}
                      meta={meta}
                      amount={sub.typicalAmount}
                      format={formatCurrency}
                      onPress={() => router.push(`/subscription-detail?id=${sub.id}`)}
                      lead={
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: R.sm,
                            borderCurve: 'continuous',
                            backgroundColor: C.groundSunk,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Type role="cardTitle" color={C.ink}>
                            {sub.merchantDisplay.trim().charAt(0).toUpperCase() || '?'}
                          </Type>
                        </View>
                      }
                      // Confidence is the only figure that varies within the
                      // "possible" segment, so it is the only one that earns
                      // a meter — and it is one colour, not a traffic light.
                      footer={
                        segment === 'possible' ? (
                          <View style={{ marginTop: 12, gap: 6 }}>
                            <Type role="meta" color={C.inkDim}>
                              {`${t('subscriptionsScreen.confidence')} ${Math.round(sub.confidenceScore)}%`}
                            </Type>
                            <Meter
                              pal={C}
                              ratio={sub.confidenceScore / 100}
                              label={t('subscriptionsScreen.confidence')}
                            />
                          </View>
                        ) : null
                      }
                    />
                  </View>
                );
              })}
            </Card>

            <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('subscriptionsScreen.analyzesHint')}
            </Type>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
