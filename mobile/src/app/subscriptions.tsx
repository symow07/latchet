import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, RefreshCw, Repeat } from '@/components/icons';

import { getSettings, getSubscriptions, type Subscription } from '@/lib/db';
import { EmailScanCard } from '@/components/EmailScanCard';
import { runDetection, SUBSCRIPTIONS_QUERY_KEY } from '@/lib/subscription-detection';
import { EMAIL_CONNECTIONS_QUERY_KEY, getEmailConnections, syncEmailNow } from '@/lib/email-connections';
import {
  buildSubscriptionsView,
  formatMoney,
  moneyFormatter,
  type SubscriptionRowView,
} from '@/lib/subscription-view';
import { todayISO } from '@/lib/dates';
import { R, S, useC, type Palette } from '@/lib/design';
import {
  BalanceCard,
  Card,
  CircleAction,
  Empty,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  SubHeader,
  Touchable,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * Subscriptions: what is about to charge you, and what you forgot.
 *
 * The screen leads with the value: the alerts first (charged after you
 * cancelled, a price that went up — old → new), the monthly cost on the
 * anchor (one figure per currency; euros are never added to dollars), the
 * charges coming in the next 30 days with their dates, then what is running,
 * the free trials and the days they have left, what Budget is unsure of ("To
 * review"), and folded away at the end what has ended or been cancelled.
 * Everything is worked out in lib/subscription-view; this file only lays it
 * out.
 *
 * Detection runs by itself (after imports, syncs and email); "Check now" and
 * pulling down run it on demand, and pulling down also checks email first.
 */
function initialTile(pal: Palette, name: string) {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: R.sm,
        borderCurve: 'continuous',
        backgroundColor: pal.groundSunk,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Type role="cardTitle" color={pal.ink}>
        {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
      </Type>
    </View>
  );
}

function RowList({
  pal,
  rows,
  onOpen,
}: {
  pal: Palette;
  rows: { key: string; title: string; meta: string; amount: number; currency: string }[];
  onOpen: (id: string) => void;
}) {
  return (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        {rows.map((row, i) => (
          <View key={row.key} style={i > 0 ? { borderTopWidth: 1, borderTopColor: pal.hairline } : undefined}>
            <InfoRow
              pal={pal}
              title={row.title}
              meta={row.meta}
              amount={row.amount}
              format={moneyFormatter(row.currency)}
              lead={initialTile(pal, row.title)}
              onPress={() => onOpen(row.key)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

const asRows = (rows: SubscriptionRowView[]) =>
  rows.map((r) => ({ key: r.sub.id, title: r.title, meta: r.meta, amount: r.amount, currency: r.currency }));

export default function SubscriptionsScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [showEnded, setShowEnded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: subs = [], isLoading } = useQuery<Subscription[]>({
    queryKey: SUBSCRIPTIONS_QUERY_KEY,
    queryFn: () => getSubscriptions(),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: email } = useQuery({
    queryKey: EMAIL_CONNECTIONS_QUERY_KEY,
    queryFn: getEmailConnections,
    retry: false,
    staleTime: 60_000,
  });

  const userCurrency = (settings?.currency || 'USD').toUpperCase();
  const today = todayISO();
  const view = useMemo(() => buildSubscriptionsView(subs, { today, userCurrency }), [subs, today, userCurrency]);
  const open = (id: string) => router.push({ pathname: '/subscription-detail', params: { id } });

  /** New subscriptions since `before`, counting only what is listed. */
  async function newSince(before: ReadonlySet<string>): Promise<number> {
    const after = await getSubscriptions();
    return after.filter((s) => !before.has(s.id) && s.status !== 'dismissed').length;
  }

  async function refreshLists() {
    await qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: EMAIL_CONNECTIONS_QUERY_KEY });
  }

  const check = useMutation({
    mutationFn: async () => {
      const before = new Set(subs.map((s) => s.id));
      await runDetection('manual');
      return newSince(before);
    },
    onMutate: () => setNotice(null),
    onSuccess: async (found) => {
      setNotice(t('subsUi.list.found', { count: found }));
      await refreshLists();
    },
  });

  /** Pull to refresh: check the inboxes (if any), then detect over everything. */
  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    const before = new Set(subs.map((s) => s.id));
    let emailFailed = false;
    try {
      if ((email?.connections ?? []).length > 0) await syncEmailNow({ watched: true });
    } catch {
      emailFailed = true;
    }
    try {
      await runDetection('manual');
      const found = await newSince(before);
      setNotice(emailFailed ? t('subsUi.list.checkFailed') : t('subsUi.list.found', { count: found }));
      await refreshLists();
    } finally {
      setRefreshing(false);
    }
  }

  const primary = view.totals[0] ?? { currency: userCurrency, monthly: 0 };
  const busy = check.isPending || refreshing;

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + S.section }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <SubHeader
          pal={C}
          title={t('subsUi.list.title')}
          onBack={() => router.back()}
          action={
            <CircleAction pal={C} label={t('subsUi.list.checkNow')} onPress={busy ? undefined : () => check.mutate()}>
              {busy ? (
                <ActivityIndicator size="small" color={C.ink} />
              ) : (
                <RefreshCw size={18} color={C.ink} strokeWidth={S.stroke} />
              )}
            </CircleAction>
          }
        />

        {notice ? (
          <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: S.tight, textAlign: 'center' }}>
            {notice}
          </Type>
        ) : null}

        {isLoading ? (
          <View style={{ paddingTop: 48, alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : view.empty ? (
          <>
            <Empty
              pal={C}
              icon={<Repeat size={26} color={C.accent} strokeWidth={S.stroke} />}
              title={t('subsUi.list.emptyTitle')}
              body={t('subsUi.list.emptyBody')}
              actionLabel={t('subsUi.list.connectEmail')}
              onAction={() => router.push('/email-inbox')}
              // Empty replaces the anchor here, so its action is the screen's one espresso button.
              actionVariant="ink"
              style={{ marginTop: 48 }}
            />
            <PrimaryButton
              pal={C}
              label={t('subsUi.list.importStatement')}
              onPress={() => router.push('/import')}
              variant="secondary"
              style={{ marginTop: S.tight + 4, marginHorizontal: S.screen }}
            />
          </>
        ) : (
          <>
            {/* What needs a look now: money already gone, or a price that rose. */}
            {view.alerts.length > 0 ? (
              <View style={{ paddingHorizontal: S.screen, marginTop: S.group, gap: S.tight + 4 }}>
                {view.alerts.map((a) => (
                  <Card key={`${a.kind}:${a.sub.id}`} pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    <Touchable pal={C} onPress={() => open(a.sub.id)} accessibilityLabel={a.title} style={{ paddingVertical: 14 }}>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <AlertTriangle
                          size={20}
                          color={a.kind === 'charged_after_cancel' ? C.negative : C.warning}
                          strokeWidth={S.stroke}
                          style={{ marginTop: 1 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Type role="cardTitle" color={C.ink}>
                            {a.title}
                          </Type>
                          <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
                            {a.body}
                          </Type>
                        </View>
                      </View>
                    </Touchable>
                  </Card>
                ))}
              </View>
            ) : null}

            {/* The anchor: what running subscriptions cost a month, per currency. */}
            <BalanceCard
              pal={C}
              label={t('subsUi.list.totalLabel')}
              amount={primary.monthly}
              format={moneyFormatter(primary.currency)}
              caption={t('subsUi.list.running', { count: view.runningCount })}
              style={{ paddingHorizontal: S.screen, marginTop: S.wide }}
            >
              {view.totals.slice(1).map((total) => (
                <Type key={total.currency} role="meta" color={C.onEspressoDim} style={{ marginTop: 4 }}>
                  {t('subsUi.list.alsoMonthly', { amount: formatMoney(total.monthly, total.currency) })}
                </Type>
              ))}
            </BalanceCard>

            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('subsUi.list.upcoming')} />
              {view.upcoming.length === 0 ? (
                <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen }}>
                  {t('subsUi.list.upcomingEmpty')}
                </Type>
              ) : (
                <RowList
                  pal={C}
                  onOpen={open}
                  rows={view.upcoming.map((u) => ({
                    key: u.sub.id,
                    title: u.title,
                    meta: [u.when, u.date, u.note].filter(Boolean).join(' · '),
                    amount: u.amount,
                    currency: u.currency,
                  }))}
                />
              )}
            </View>

            {view.active.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('subsUi.list.active')} />
                <RowList pal={C} rows={asRows(view.active)} onOpen={open} />
              </View>
            ) : null}

            {view.trials.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('subsUi.list.trials')} />
                <RowList pal={C} rows={asRows(view.trials)} onOpen={open} />
              </View>
            ) : null}

            {view.review.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('subsUi.list.review')} />
                <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: -4, marginBottom: 12 }}>
                  {t('subsUi.list.reviewHint')}
                </Type>
                <RowList pal={C} rows={asRows(view.review)} onOpen={open} />
              </View>
            ) : null}

            <View style={{ marginTop: S.section }}>
              <EmailScanCard />
            </View>

            {view.ended.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader
                  pal={C}
                  title={t('subsUi.list.ended')}
                  actionLabel={showEnded ? t('subsUi.list.hideEnded') : t('subsUi.list.showEnded', { count: view.ended.length })}
                  onAction={() => setShowEnded((v) => !v)}
                />
                {showEnded ? <RowList pal={C} rows={asRows(view.ended)} onOpen={open} /> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
