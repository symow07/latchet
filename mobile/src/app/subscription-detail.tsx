import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AlertTriangle, ExternalLink } from '@/components/icons';

import {
  getSettings,
  getSubscriptionById,
  getSubscriptionOccurrences,
  setSubscriptionDecision,
  type Subscription,
  type SubscriptionDecision,
  type SubscriptionOccurrence,
} from '@/lib/db';
import {
  decideSubscription,
  replanReminders,
  runDetection,
  SUBSCRIPTIONS_QUERY_KEY,
} from '@/lib/subscription-detection';
import {
  buildDetailView,
  decisionDoneText,
  moneyFormatter,
  undoTarget,
  type UndoTarget,
} from '@/lib/subscription-view';
import { cancelGuide, type CancelLink, type CancelPlatform } from '@/lib/cancel-directory';
import { todayISO } from '@/lib/dates';
import { R, S, useC, type Palette } from '@/lib/design';
import {
  Amount,
  Card,
  FormError,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  SubHeader,
  Touchable,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * One subscription, where every reminder lands.
 *
 * While the user has not decided, it opens on the question the reminders ask
 * — "Keep it, or did you forget?" — with what it costs and when it next
 * charges, and four answers: keep it, see how to cancel it, I cancelled it
 * (nothing more to fill in; it records today), or not a subscription (hidden
 * for good and never proposed again; "Delete" is the same). Each answer can
 * be undone on the spot.
 *
 * Below: a charge after cancelling, the price history, the facts (cadence,
 * trial end, next and last charge, who bills it, where Budget found it), the
 * guided cancellation and every charge behind it. The guide (cancel-directory)
 * sends the user to the right place — the App Store, Google Play, PayPal, the
 * service's own page — and never promises to cancel for them; once they have
 * opened it, it offers "I cancelled it".
 */
const PLATFORM: CancelPlatform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

function NumberedSteps({ pal, steps }: { pal: Palette; steps: string[] }) {
  return (
    <View style={{ gap: 12 }}>
      {steps.map((step, i) => (
        <View key={`${i}:${step}`} style={{ flexDirection: 'row', gap: 12 }}>
          <View
            style={{
              width: 24,
              height: 24,
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
          <Type role="body" color={pal.ink} style={{ flex: 1 }}>
            {step}
          </Type>
        </View>
      ))}
    </View>
  );
}

export default function SubscriptionDetailScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideVisited, setGuideVisited] = useState(false);
  const [lastAction, setLastAction] = useState<{ decision: SubscriptionDecision; undo: UndoTarget } | null>(null);
  const [error, setError] = useState('');

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
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const userCurrency = (settings?.currency || 'USD').toUpperCase();
  const today = todayISO();

  const view = useMemo(
    () => (subscription ? buildDetailView(subscription, occurrences, { today, userCurrency }) : null),
    [subscription, occurrences, today, userCurrency],
  );
  const guide = useMemo(
    () =>
      subscription
        ? cancelGuide({
            merchantKey: subscription.merchantNormalized,
            name: subscription.merchantDisplay,
            billedVia: subscription.billedVia ?? null,
            platform: PLATFORM,
          })
        : null,
    [subscription],
  );

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['subscription', id] });
    await qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });
  }

  const decide = useMutation({
    mutationFn: async (decision: SubscriptionDecision) => {
      if (!subscription) return null;
      const before = undoTarget(subscription);
      await decideSubscription(subscription.id, decision);
      return { decision, undo: before };
    },
    onMutate: () => setError(''),
    onSuccess: async (done) => {
      if (!done) return;
      setLastAction(done);
      setGuideOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
    },
    onError: () => setError(t('subsUi.detail.saveFailed')),
  });

  const undo = useMutation({
    mutationFn: async (target: UndoTarget) => {
      if (!subscription) return;
      if (target.decision === 'cancel' && target.canceledAt) {
        // Back to the day it was really cancelled, not today.
        await setSubscriptionDecision(subscription.id, 'cancel', { canceledAt: target.canceledAt });
        await replanReminders({ interactive: true });
      } else {
        await decideSubscription(subscription.id, target.decision);
      }
      // Undecided again: let the engine say what it is (active, trial, ended…).
      if (target.decision === null) await runDetection('manual');
    },
    onMutate: () => setError(''),
    onSuccess: async () => {
      setLastAction(null);
      await refresh();
    },
    onError: () => setError(t('subsUi.detail.saveFailed')),
  });

  async function openLink(link: CancelLink) {
    try {
      await Linking.openURL(link.url);
      setGuideVisited(true);
    } catch {
      setError(t('subsUi.guide.openFailed'));
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

  if (!subscription || !view || !guide) {
    return (
      <Screen pal={C}>
        <SubHeader pal={C} title={t('subsUi.list.title')} onBack={() => router.back()} style={{ marginTop: 8 }} />
        <View style={{ paddingHorizontal: S.screen, marginTop: 64 }}>
          <Type role="section" color={C.ink}>
            {t('subsUi.detail.notFound')}
          </Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
            {t('subsUi.detail.notFoundBody')}
          </Type>
          <PrimaryButton
            pal={C}
            label={t('subsUi.detail.back')}
            onPress={() => router.back()}
            variant="secondary"
            style={{ marginTop: S.wide }}
          />
        </View>
      </Screen>
    );
  }

  const busy = decide.isPending || undo.isPending;
  const choiceLabel: Record<SubscriptionDecision, string> = {
    keep: t('subsUi.detail.keep'),
    cancel: t('subsUi.detail.cancelled'),
    dismiss: t('subsUi.detail.dismiss'),
  };
  const format = moneyFormatter(view.currency);
  // The one espresso button: Keep it, while there is a question; otherwise none is the call.
  const offerCancelled = guideVisited && subscription.decision !== 'cancel';

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + S.section }}
      >
        <SubHeader pal={C} title={view.title} onBack={() => router.back()} />

        <View style={{ paddingHorizontal: S.screen, marginTop: S.wide, alignItems: 'center' }}>
          <Type role="meta" color={C.inkDim}>
            {view.status}
          </Type>
          <Type role="section" color={C.ink} style={{ marginTop: 4, textAlign: 'center' }}>
            {view.price}
          </Type>
        </View>

        {/* Said and undoable right where it was done. */}
        {lastAction ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
            <Card pal={C} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Type role="body" color={C.ink} style={{ flex: 1 }}>
                {decisionDoneText(lastAction.decision)}
              </Type>
              <Touchable
                pal={C}
                bleed={8}
                onPress={busy ? undefined : () => undo.mutate(lastAction.undo)}
                accessibilityLabel={t('subsUi.detail.undo')}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
              >
                <Type role="cardTitle" color={C.accent}>
                  {t('subsUi.detail.undo')}
                </Type>
              </Touchable>
            </Card>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: S.screen }}>
          <FormError pal={C} message={error} />
        </View>

        {view.chargedAfterCancel ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
            <Card pal={C}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <AlertTriangle size={20} color={C.negative} strokeWidth={S.stroke} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Type role="cardTitle" color={C.ink}>
                    {t('subsUi.detail.chargedAfterTitle')}
                  </Type>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
                    {view.chargedAfterCancel}
                  </Type>
                </View>
              </View>
            </Card>
          </View>
        ) : null}

        {view.question ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
            <Card pal={C}>
              <Type role="section" color={C.ink}>
                {view.question.title}
              </Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                {view.question.body}
              </Type>
              <PrimaryButton
                pal={C}
                label={t('subsUi.detail.keep')}
                onPress={() => decide.mutate('keep')}
                disabled={busy}
                style={{ marginTop: S.group + 4 }}
              />
              <PrimaryButton
                pal={C}
                label={t('subsUi.detail.howToCancel')}
                onPress={() => setGuideOpen(true)}
                variant="secondary"
                style={{ marginTop: 12 }}
              />
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <PrimaryButton
                  pal={C}
                  label={t('subsUi.detail.cancelled')}
                  onPress={() => decide.mutate('cancel')}
                  variant="secondary"
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  pal={C}
                  label={t('subsUi.detail.dismiss')}
                  onPress={() => decide.mutate('dismiss')}
                  variant="secondary"
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          </View>
        ) : (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
            {view.decided ? (
              <>
                <Type role="body" color={C.ink} style={{ textAlign: 'center' }}>
                  {view.decided}
                </Type>
                <Type role="meta" color={C.inkDim} style={{ marginTop: S.group, marginBottom: S.tight }}>
                  {t('subsUi.detail.change')}
                </Type>
              </>
            ) : null}
            <View style={{ gap: 12 }}>
              {view.choices
                .filter((d) => d !== 'dismiss')
                .map((d) => (
                  <PrimaryButton
                    key={d}
                    pal={C}
                    label={choiceLabel[d]}
                    onPress={() => decide.mutate(d)}
                    variant="secondary"
                    disabled={busy}
                  />
                ))}
            </View>
          </View>
        )}

        {offerCancelled ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
            <Card pal={C}>
              <Type role="cardTitle" color={C.ink}>
                {t('subsUi.detail.didYouCancel', { name: view.title })}
              </Type>
              <Type role="meta" color={C.inkDim} style={{ marginTop: 4 }}>
                {t('subsUi.guide.afterBody')}
              </Type>
              <PrimaryButton
                pal={C}
                label={t('subsUi.detail.cancelled')}
                onPress={() => decide.mutate('cancel')}
                variant="secondary"
                disabled={busy}
                style={{ marginTop: S.group }}
              />
            </Card>
          </View>
        ) : null}

        {view.showCancelGuide && !view.question ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              <InfoRow
                pal={C}
                title={t('subsUi.detail.howToCancel')}
                meta={guide.link?.label}
                onPress={() => setGuideOpen(true)}
                trailing={<ExternalLink size={18} color={C.inkDim} strokeWidth={S.stroke} />}
              />
            </Card>
          </View>
        ) : null}

        {view.priceHistory ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader pal={C} title={t('subsUi.detail.priceHistory')} />
            <View style={{ paddingHorizontal: S.screen }}>
              <Card pal={C}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Amount value={view.priceHistory.from} format={format} size={20} weight="medium" color={C.inkDim} />
                  <Type role="body" color={C.inkDim}>
                    →
                  </Type>
                  <Amount value={view.priceHistory.to} format={format} size={20} weight="semibold" color={C.ink} />
                </View>
                <Type role="meta" color={C.inkDim} style={{ marginTop: S.tight }}>
                  {view.priceHistory.text}
                </Type>
              </Card>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('subsUi.detail.details')} />
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {view.facts.map((fact, i) => (
                <View
                  key={fact.label}
                  style={[
                    { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 14 },
                    i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : null,
                  ]}
                >
                  <Type role="body" color={C.inkDim}>
                    {fact.label}
                  </Type>
                  <Type role="body" color={C.ink} style={{ flex: 1, textAlign: 'right' }}>
                    {fact.value}
                  </Type>
                </View>
              ))}
            </Card>
          </View>
        </View>

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('subsUi.detail.charges')} />
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {view.occurrences.length === 0 ? (
                <View style={{ paddingVertical: 28, alignItems: 'center' }}>
                  <Type role="body" color={C.inkDim}>
                    {t('subsUi.detail.noCharges')}
                  </Type>
                </View>
              ) : (
                view.occurrences.map((occ, i) => (
                  <View key={occ.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}>
                    <InfoRow pal={C} title={occ.date} amount={occ.amount} format={format} />
                  </View>
                ))
              )}
            </Card>
            <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('subsUi.detail.chargesCount', { count: view.occurrences.length })}
            </Type>
          </View>
        </View>

        {subscription.decision !== 'dismiss' && !view.question ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            <PrimaryButton
              pal={C}
              label={t('subsUi.detail.delete')}
              onPress={() => decide.mutate('dismiss')}
              variant="destructive"
              disabled={busy}
            />
            <Type role="meta" color={C.inkDim} style={{ marginTop: 12, textAlign: 'center' }}>
              {t('subsUi.detail.deleteHint')}
            </Type>
          </View>
        ) : null}
      </ScrollView>

      <Sheet pal={C} visible={guideOpen} onClose={() => setGuideOpen(false)} title={guide.title}>
        <ScrollView
          style={{ maxHeight: 520 }}
          contentContainerStyle={{ paddingHorizontal: S.card, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          <Type role="body" color={C.inkDim} style={{ marginBottom: S.group }}>
            {guide.intro}
          </Type>
          <NumberedSteps pal={C} steps={guide.steps} />

          {guide.link ? (
            <PrimaryButton
              pal={C}
              label={guide.link.label}
              onPress={() => openLink(guide.link!)}
              style={{ marginTop: S.wide }}
            />
          ) : null}

          {guide.more.length > 0 ? (
            <>
              <Type role="meta" color={C.inkDim} style={{ marginTop: S.wide, marginBottom: S.tight }}>
                {t('subsUi.guide.more')}
              </Type>
              <View style={{ gap: 12 }}>
                {guide.more.map((link) => (
                  <PrimaryButton key={link.url} pal={C} label={link.label} onPress={() => openLink(link)} variant="secondary" />
                ))}
              </View>
            </>
          ) : null}

          {guide.notes.map((note) => (
            <Type key={note} role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
              {note}
            </Type>
          ))}

          {subscription.decision !== 'cancel' || view.chargedAfterCancel ? (
            <View style={{ marginTop: S.wide }}>
              <Type role="cardTitle" color={C.ink}>
                {t('subsUi.guide.afterTitle')}
              </Type>
              <Type role="meta" color={C.inkDim} style={{ marginTop: 4 }}>
                {t('subsUi.guide.afterBody')}
              </Type>
              <PrimaryButton
                pal={C}
                label={t('subsUi.detail.cancelled')}
                onPress={() => decide.mutate('cancel')}
                variant="secondary"
                disabled={busy}
                style={{ marginTop: 12 }}
              />
            </View>
          ) : null}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
