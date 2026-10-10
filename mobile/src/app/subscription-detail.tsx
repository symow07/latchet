import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ExternalLink } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { format, isAfter, parseISO } from 'date-fns';

import {
  getSubscriptionById,
  getSubscriptionOccurrences,
  updateSubscriptionCancelInfo,
  updateSubscriptionStatus,
  type Subscription,
  type SubscriptionOccurrence,
} from '@/lib/db';
import { findCancelEntry, getCancelLink } from '@/lib/cancel-directory';
import { formatCurrency } from '@/lib/calculations';
import { S, useC } from '@/lib/design';
import {
  Card,
  Field,
  InfoRow,
  Meter,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  Stat,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

/**
 * One subscription — DESIGN-PROMPT.md §23: merchant, cycle, price history,
 * cancel steps.
 *
 * The old screen stacked four action buttons in four different tints — a
 * solid `#ef4444`, a green translucent one, a red translucent one and a violet
 * translucent one — under a violet gradient header carrying three glass stat
 * tiles. There is one thing you come here to do, so there is now one dark
 * button, and everything else is secondary or a row.
 *
 * Two of those buttons had a real bug behind the styling: their labels were
 * `style={{ color: C.text }}`, which after the retheme is near-black ink — so
 * the red "Cancel now" button and the violet "Save notes" button both printed
 * dark text on a saturated fill. And `cadenceLabel` returned hardcoded
 * `'Weekly'`/`'Monthly'`/`'Yearly'`/`'Unknown'` in a four-language app, while
 * the history header pluralised "occurrence" with an English `s`.
 */
export default function SubscriptionDetailScreen() {
  const C = useC();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelNotes, setCancelNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const { data: subscription, isLoading } = useQuery<Subscription | null>({
    queryKey: ['subscription', id],
    queryFn: () => getSubscriptionById(id ?? ''),
    enabled: !!id,
  });

  const { data: occurrences = [] } = useQuery<SubscriptionOccurrence[]>({
    queryKey: ['subscription-occurrences', id],
    queryFn: () => getSubscriptionOccurrences(id ?? ''),
    enabled: !!id,
  });

  // Pre-fill notes once the subscription loads.
  if (subscription?.cancelNotes && cancelNotes === '') {
    setCancelNotes(subscription.cancelNotes);
  }

  const cancelEntry = subscription ? findCancelEntry(subscription.merchantNormalized) : null;
  const cancelLink = cancelEntry ? getCancelLink(cancelEntry) : null;

  const hasPostCancelCharge =
    subscription?.status === 'canceled' &&
    subscription.updatedAt &&
    occurrences.some((o) => isAfter(parseISO(o.chargedAt), parseISO(subscription.updatedAt)));

  async function handleStatusChange(newStatus: Subscription['status']) {
    if (!subscription || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      await updateSubscriptionStatus(subscription.id, newStatus);
      await queryClient.invalidateQueries({ queryKey: ['subscription', id] });
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error('[SubscriptionDetail] status update error:', e);
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function handleSaveNotes() {
    if (!subscription || isSavingNotes) return;
    setIsSavingNotes(true);
    try {
      await updateSubscriptionCancelInfo(
        subscription.id,
        cancelEntry?.cancelUrl ?? null,
        cancelNotes
      );
      await queryClient.invalidateQueries({ queryKey: ['subscription', id] });
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error('[SubscriptionDetail] save notes error:', e);
    } finally {
      setIsSavingNotes(false);
    }
  }

  // One-tap cancel: jump straight to the exact place the subscription can be
  // canceled (native iOS/Google subscriptions screen, or the merchant's web
  // cancel page). Falls back to the how-to sheet when we don't know the service.
  async function handleCancelNow() {
    if (!subscription) return;
    if (!cancelEntry) {
      setSheetOpen(true);
      return;
    }
    const { url } = getCancelLink(cancelEntry);
    try {
      const supported = await Linking.canOpenURL(url);
      await Linking.openURL(supported ? url : cancelEntry.cancelUrl);
    } catch {
      try {
        await Linking.openURL(cancelEntry.cancelUrl);
      } catch {
        setSheetOpen(true);
      }
    }
  }

  if (isLoading) {
    return (
      <Screen pal={C}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </Screen>
    );
  }

  if (!subscription) {
    return (
      <Screen pal={C}>
        <SubHeader
          pal={C}
          title={t('subscriptionDetail.title')}
          onBack={() => router.back()}
          style={{ marginTop: 8 }}
        />
        <View style={{ paddingHorizontal: S.screen, marginTop: 64 }}>
          <Type role="section" color={C.ink}>
            {t('subscriptionDetail.notFound')}
          </Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
            {t('subscriptionDetail.notFoundBody')}
          </Type>
          <PrimaryButton
            pal={C}
            label={t('subscriptionDetail.goBack')}
            onPress={() => router.back()}
            variant="secondary"
            style={{ marginTop: 24 }}
          />
        </View>
      </Screen>
    );
  }

  const statusLabel = t(`subStatus.${subscription.status}`);
  const nextCharge =
    subscription.status === 'canceled'
      ? statusLabel
      : subscription.nextExpectedAt
        ? format(parseISO(subscription.nextExpectedAt), 'd MMM', { locale: getDateFnsLocale() })
        : '—';

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
      >
        <SubHeader
          pal={C}
          title={subscription.merchantDisplay}
          onBack={() => router.back()}
        />

        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card pal={C}>
            <Type role="meta" color={C.inkDim}>
              {statusLabel}
            </Type>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Stat
                pal={C}
                label={t('subscriptionDetail.amountLabel')}
                value={subscription.typicalAmount}
                format={formatCurrency}
                size={20}
                style={{ flex: 1 }}
              />
              <Stat
                pal={C}
                label={t('subDetail.cadence')}
                value={t(`frequency.${subscription.cadence}`)}
                size={20}
                style={{ flex: 1 }}
              />
              <Stat
                pal={C}
                label={t('subDetail.nextCharge')}
                value={nextCharge}
                size={20}
                style={{ flex: 1 }}
              />
            </View>
          </Card>

          {hasPostCancelCharge ? (
            <View style={{ marginTop: 16 }}>
              <Type role="cardTitle" color={C.negative}>
                {t('subscriptionDetail.chargeAfterTitle')}
              </Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
                {t('subscriptionDetail.chargeAfterBody')}
              </Type>
            </View>
          ) : null}

          {/* One dark object, and it is the thing you came here to do. */}
          {subscription.status !== 'canceled' ? (
            <>
              <PrimaryButton
                pal={C}
                label={cancelLink ? cancelLink.label : t('subStatus.cancelAction')}
                onPress={handleCancelNow}
                style={{ marginTop: S.section }}
              />
              {cancelEntry ? (
                <Type role="meta" color={C.inkDim} style={{ marginTop: 12, textAlign: 'center' }}>
                  {cancelEntry.native === 'apple'
                    ? t('subscriptionDetail.opensApple')
                    : t('subscriptionDetail.opensPage', { name: cancelEntry.displayName })}
                </Type>
              ) : null}
            </>
          ) : null}

          {subscription.status === 'possible' ? (
            <PrimaryButton
              pal={C}
              label={t('subscriptionDetail.confirmSub')}
              onPress={() => handleStatusChange('confirmed')}
              variant="secondary"
              disabled={isUpdatingStatus}
              style={{ marginTop: 12 }}
            />
          ) : null}

          {subscription.status !== 'canceled' ? (
            <PrimaryButton
              pal={C}
              label={t('subscriptionDetail.markCanceled')}
              onPress={() => handleStatusChange('canceled')}
              variant="secondary"
              disabled={isUpdatingStatus}
              style={{ marginTop: 12 }}
            />
          ) : null}

          <View style={{ marginTop: 12 }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              <InfoRow
                pal={C}
                title={t('subscriptionDetail.howToCancel')}
                onPress={() => setSheetOpen(true)}
                trailing={<ExternalLink size={17} color={C.inkFaint} strokeWidth={S.stroke} />}
              />
            </Card>
          </View>
        </View>

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('subscriptionDetail.history')} />
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {occurrences.length === 0 ? (
                <View style={{ paddingVertical: 28, alignItems: 'center' }}>
                  <Type role="body" color={C.inkDim}>
                    {t('subscriptionDetail.noOccurrences')}
                  </Type>
                </View>
              ) : (
                occurrences.map((occ, i) => (
                  <View
                    key={occ.id}
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                  >
                    <InfoRow
                      pal={C}
                      title={format(parseISO(occ.chargedAt), 'd MMM yyyy', {
                        locale: getDateFnsLocale(),
                      })}
                      amount={occ.amount}
                      format={formatCurrency}
                    />
                  </View>
                ))
              )}
            </Card>
            <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('subscriptionDetail.occurrenceCount', { count: occurrences.length })}
            </Type>
          </View>
        </View>

        {subscription.status === 'possible' ? (
          <View style={{ marginTop: S.section, paddingHorizontal: S.screen }}>
            <Card pal={C}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}
              >
                <Type role="cardTitle" color={C.ink}>
                  {t('subscriptionDetail.confidence')}
                </Type>
                <Type role="cardTitle" color={C.ink}>
                  {`${Math.round(subscription.confidenceScore)}%`}
                </Type>
              </View>
              <Meter
                pal={C}
                ratio={subscription.confidenceScore / 100}
                label={t('subscriptionDetail.confidence')}
              />
              <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                {t(
                  occurrences.length === 1
                    ? 'subscriptionDetail.basedOnOne'
                    : 'subscriptionDetail.basedOn',
                  { count: occurrences.length }
                )}
              </Type>
            </Card>
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        pal={C}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('subscriptionDetail.howToCancel')}
      >
        <ScrollView
          style={{ maxHeight: 460 }}
          contentContainerStyle={{ paddingHorizontal: S.card, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {cancelEntry ? (
            <>
              <Type role="cardTitle" color={C.ink} style={{ marginBottom: 12 }}>
                {t('subscriptionDetail.stepsTo', { name: cancelEntry.displayName })}
              </Type>
              <View style={{ gap: 12 }}>
                {cancelEntry.steps.map((step, i) => (
                  <View key={step} style={{ flexDirection: 'row', gap: 12 }}>
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: C.groundSunk,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 2,
                      }}
                    >
                      <Type role="meta" color={C.inkDim}>
                        {i + 1}
                      </Type>
                    </View>
                    <Type role="body" color={C.ink} style={{ flex: 1 }}>
                      {step}
                    </Type>
                  </View>
                ))}
              </View>

              <PrimaryButton
                pal={C}
                label={t('subscriptionDetail.openCancelPage')}
                onPress={() => Linking.openURL(cancelEntry.cancelUrl)}
                variant="secondary"
                style={{ marginTop: 16 }}
              />
            </>
          ) : (
            <>
              <Type role="cardTitle" color={C.ink}>
                {t('subscriptionDetail.notInDirectory')}
              </Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                {t('subscriptionDetail.noSteps', { name: subscription.merchantDisplay })}
              </Type>

              <PrimaryButton
                pal={C}
                label={t('subscriptionDetail.searchHow', { name: subscription.merchantDisplay })}
                onPress={() => {
                  const query = encodeURIComponent(
                    t('subscriptionDetail.searchQuery', { name: subscription.merchantDisplay })
                  );
                  Linking.openURL(`https://www.google.com/search?q=${query}`);
                }}
                variant="secondary"
                style={{ marginTop: 16 }}
              />
              <PrimaryButton
                pal={C}
                label={t('subscriptionDetail.draftEmail')}
                onPress={() => {
                  const subj = encodeURIComponent(
                    t('subscriptionDetail.emailSubject', { name: subscription.merchantDisplay })
                  );
                  const body = encodeURIComponent(
                    t('subscriptionDetail.emailBody', { name: subscription.merchantDisplay })
                  );
                  Linking.openURL(`mailto:?subject=${subj}&body=${body}`);
                }}
                variant="secondary"
                style={{ marginTop: 12 }}
              />
            </>
          )}

          <Field
            pal={C}
            label={t('subscriptionDetail.yourNotes')}
            value={cancelNotes}
            onChangeText={setCancelNotes}
            placeholder={t('subDetail.notesHint')}
            multiline
            style={{ marginTop: 24 }}
          />
          <PrimaryButton
            pal={C}
            label={t('subscriptionDetail.saveNotes')}
            onPress={handleSaveNotes}
            disabled={isSavingNotes}
            style={{ marginTop: 16 }}
          />
          {isSavingNotes ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 12 }} />
          ) : null}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
