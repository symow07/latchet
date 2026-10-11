import { useReducer, useState, type Dispatch } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Play, Plus, RefreshCw } from '@/components/icons';
import * as Haptics from 'expo-haptics';

import { NetworkError, TimeoutError, api } from '@/lib/api/api';
import { requestPull, syncNow } from '@/lib/cloud-sync';
import {
  addRecurring,
  deleteRecurring,
  getAccounts,
  getLocalSyncState,
  getRecurring,
  getSettings,
  setRecurringActive,
  type Account,
  type RecurringSeries,
} from '@/lib/db';
import { todayISO } from '@/lib/dates';
import { daysUntil } from '@/lib/offline/bills';
import {
  EMPTY_RECURRING_FORM,
  RECURRING_CATEGORIES,
  RECURRING_FREQUENCIES,
  bookingAccountFor,
  createRecurringFromForm,
  recurringFormReducer,
  runNowMessage,
  runRecurringNow,
  type RecurringForm,
  type RecurringFormAction,
  type RecurringFrequency,
  type RecurringType,
} from '@/lib/offline/recurring';
import { formatCurrency } from '@/lib/calculations';
import { categoryLabel } from '@/lib/category-meta';
import { txTypeLabel } from '@/lib/tx-display';
import { R, S, useC, type Palette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  CircleAction,
  Empty,
  Field,
  FilterChip,
  FormError,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Stat,
  SubHeader,
  SwipeRow,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

// ─── Types ────────────────────────────────────────────────────────────────────

/** POST /api/v1/recurring/:id/run — 201 when it booked today's occurrence, 200 when it already was. */
interface RunNowResponse {
  transactionId: string;
  nextDate: string;
}

/** How many times a frequency runs in an average month. */
const PER_MONTH: Record<RecurringFrequency, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  yearly: 1 / 12,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Whole days to the next run, against the local calendar date. */
function daysUntilNext(nextDate: string): number {
  return daysUntil(nextDate, todayISO());
}

/**
 * When the next run lands, in the words the app already has.
 *
 * These used to be four hardcoded English strings — `'Overdue'`, `'Due
 * today'`, `'Tomorrow'`, `` `In ${days}d` `` — inside a translated app. They
 * are the same keys subscriptions and bills use, so the same fact is worded
 * the same way wherever it appears.
 */
function nextRunLabel(nextDate: string): string {
  const days = daysUntilNext(nextDate);
  if (days < 0) return t('subStatus.overdue');
  if (days === 0) return t('subStatus.today');
  if (days === 1) return t('subStatus.tomorrow');
  return t('subStatus.inDays', { count: days });
}

/** The dot beside a run. One redundant cue, not a four-step colour scale
 *  repeated on a spine, an icon well and a pill. */
function urgencyDot(pal: Palette, nextDate: string, isActive: boolean): string {
  if (!isActive) return pal.groundSunk;
  const days = daysUntilNext(nextDate);
  if (days < 0) return pal.negative;
  if (days <= 3) return pal.warning;
  return pal.accentMark;
}

function monthlyTotal(items: RecurringSeries[], type: RecurringType): number {
  return items
    .filter((item) => item.isActive && item.type === type)
    .reduce((sum, item) => sum + item.amount * (PER_MONTH[item.frequency] ?? 1), 0);
}

/** Run-now's request never reached the server. */
function isConnectionError(e: unknown): boolean {
  return e instanceof NetworkError || e instanceof TimeoutError;
}

// ─── Add sheet ───────────────────────────────────────────────────────────────

/**
 * The new-series form. Controlled: the screen holds what it says, so it can
 * empty it once a series is saved — it used to keep its own state, and the
 * next "New Recurring" opened on the last one's values.
 */
function AddRecurringSheet({
  pal,
  visible,
  form,
  dispatch,
  accounts,
  onClose,
  onSubmit,
  isLoading,
  symbol,
}: {
  pal: Palette;
  visible: boolean;
  form: RecurringForm;
  dispatch: Dispatch<RecurringFormAction>;
  accounts: Account[];
  onClose: () => void;
  onSubmit: () => void;
  isLoading: boolean;
  symbol: string;
}) {
  const edit = (patch: Extract<RecurringFormAction, { type: 'edit' }>['patch']) => dispatch({ type: 'edit', patch });
  // The pick while it still exists, else the default account: what saving uses.
  const bookingAccount = bookingAccountFor(form.accountId, accounts);

  const close = () => {
    dispatch({ type: 'reset' });
    onClose();
  };

  return (
    <Sheet pal={pal} visible={visible} onClose={close} title={t('recurring.newTitle')}>
      <View style={{ paddingHorizontal: S.card }}>
        <Segmented
          pal={pal}
          options={[
            { key: 'Expense' as const, label: txTypeLabel('Expense') },
            { key: 'Income' as const, label: txTypeLabel('Income') },
          ]}
          value={form.type}
          onChange={(type) => edit({ type })}
        />

        <Field
          pal={pal}
          label={t('recurring.name')}
          value={form.name}
          onChangeText={(name) => edit({ name })}
          placeholder={t('fields.recurringPlaceholder')}
          maxLength={100}
          style={{ marginTop: 16 }}
        />

        <Field
          pal={pal}
          label={t('recurring.amount')}
          value={form.amount}
          onChangeText={(amount) => edit({ amount })}
          placeholder="0"
          keyboardType="decimal-pad"
          icon={
            <Type role="cardTitle" color={pal.inkDim}>
              {symbol}
            </Type>
          }
          style={{ marginTop: 16 }}
        />

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
          {t('recurring.category')}
        </Type>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RECURRING_CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              pal={pal}
              label={categoryLabel(c)}
              active={form.category === c}
              onPress={() => edit({ category: c })}
            />
          ))}
        </View>

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
          {t('recurring.frequency')}
        </Type>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RECURRING_FREQUENCIES.map((f) => (
            <FilterChip
              key={f}
              pal={pal}
              label={t(`frequency.${f}`)}
              active={form.frequency === f}
              onPress={() => edit({ frequency: f })}
            />
          ))}
        </View>

        {/* Where each run is booked (decision 5). It starts on the default
            account; the server books there too when no account is named. */}
        {accounts.length > 0 ? (
          <>
            <Type role="meta" color={pal.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
              {t('recurring.account')}
            </Type>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {accounts.map((a) => (
                <FilterChip
                  key={a.id}
                  pal={pal}
                  label={a.name}
                  active={bookingAccount?.id === a.id}
                  onPress={() => edit({ accountId: a.id })}
                />
              ))}
            </View>
          </>
        ) : null}

        <FormError pal={pal} message={form.error ? t(form.error) : ''} />

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16 }}>
          {t('recurring.autoRuns')}
        </Type>

        <PrimaryButton
          pal={pal}
          label={t('recurring.createButton')}
          onPress={onSubmit}
          disabled={isLoading}
          style={{ marginTop: 12 }}
        />
        {isLoading ? <ActivityIndicator color={pal.accent} style={{ marginTop: 12 }} /> : null}
      </View>
    </Sheet>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

/**
 * Recurring income and expenses — DESIGN-PROMPT.md §28.
 *
 * The old screen opened on a deep-green gradient — a hue belonging to the
 * *business* profile, on a personal screen — with two black-glass stat tiles
 * on top of it and a green gradient FAB with a green glow underneath. Each row
 * then coded its type three ways: a coloured spine, a tinted icon well and a
 * tinted frequency badge, all in `#ef4444` or `#22c55e`.
 *
 * Two real bugs came with it. Every amount was `$` and `en-US`, and every new
 * recurring item was written with `currency: 'USD'` regardless of what the
 * user had chosen — so a euro subscription was stored as dollars. The four
 * "next run" strings and both section headings were hardcoded English in a
 * four-language app.
 *
 * Now the sign of the amount says the type — green and `+` in, red and `−`
 * out, as in every list of money moving — `Run now` and `Delete` come off
 * every row (delete moves behind the same swipe Activity uses), and the two
 * monthly totals are plain stats on the screen's one espresso anchor rather
 * than tiles floating on a gradient.
 *
 * Since Phase 4 the series live in this phone's database and sync like the
 * ledger: the list, creating, pausing and deleting all work offline. A new
 * series names the account its runs are booked onto, starting on the default
 * account. Run now is the one action that needs the server (see
 * lib/offline/recurring.ts).
 */
export default function RecurringScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [form, dispatch] = useReducer(recurringFormReducer, EMPTY_RECURRING_FORM);

  // Read from this phone's database, so the screen works offline; a pull
  // that changes it refreshes every query (cloud-sync's onRemoteChange).
  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['recurring'],
    queryFn: getRecurring,
  });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const currency = settings?.currency || 'USD';

  const createMutation = useMutation({
    // The user's currency, not a literal 'USD': stored on the series because
    // the server replays it into every occurrence, long after this screen is
    // gone. Today is the local calendar date.
    mutationFn: (current: RecurringForm) =>
      createRecurringFromForm(current, { today: todayISO(), currency, accounts }, addRecurring),
    onSuccess: ({ form: next, createdId }) => {
      dispatch({ type: 'replace', form: next });
      if (!createdId) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setAdding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (item: RecurringSeries) => setRecurringActive(item.id, !item.isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRecurring(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  // The server books today's occurrence, under the same id its recurring job
  // uses, and moves nextDate past today — so the job cannot book it a second
  // time, and pressing again books nothing new. Pending changes go first, so
  // a series made offline exists there before it is run; offline, nothing is
  // booked and the screen says it needs a connection. The booking reaches
  // this phone's ledger through the pull that follows, which refreshes the
  // screens that show it.
  const runNowMutation = useMutation({
    mutationFn: (item: RecurringSeries) =>
      runRecurringNow(item.id, {
        flush: syncNow,
        syncState: (id) => getLocalSyncState('recurring', id),
        run: (id) => api.post<RunNowResponse>(`/api/v1/recurring/${encodeURIComponent(id)}/run`, {}),
        pull: requestPull,
        isConnectionError,
      }),
    onSuccess: (outcome) => {
      setRunningId(null);
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      const message = runNowMessage(outcome);
      if (message) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t('recurring.runNow'), t(message));
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      setRunningId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('recurring.runNow'), t('recurring.runNowFailed'));
    },
  });

  const handleRunNow = (item: RecurringSeries) => {
    setRunningId(item.id);
    runNowMutation.mutate(item);
  };

  const confirmDelete = (item: RecurringSeries) => {
    Alert.alert(item.name, t('dialogs.areYouSure'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dialogs.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(item.id),
      },
    ]);
  };

  const active = items.filter((i) => i.isActive);
  const paused = items.filter((i) => !i.isActive);

  const renderGroup = (group: RecurringSeries[]) => (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: 0 }}>
        {group.map((item, i) => {
          const isExpense = item.type === 'Expense';
          const running = runningId === item.id;
          // With more than one account, which one it books onto: its own,
          // or — none, or one since deleted — the default account.
          const bookingAccount = accounts.length > 1 ? bookingAccountFor(item.accountId, accounts) : null;
          const meta = [
            categoryLabel(item.category),
            t(`frequency.${item.frequency}`),
            item.isActive ? nextRunLabel(item.nextDate) : t('recurring.paused'),
            format(parseISO(`${item.nextDate}T00:00:00`), 'd MMM', { locale: getDateFnsLocale() }),
            bookingAccount?.name ?? null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <View
              key={item.id}
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
            >
              <SwipeRow
                pal={C}
                onDelete={() => confirmDelete(item)}
                actionLabel={t('dialogs.delete')}
              >
                <View style={{ paddingHorizontal: S.card, opacity: item.isActive ? 1 : 0.55 }}>
                  <InfoRow
                    pal={C}
                    title={item.name}
                    meta={meta}
                    // Signed, which is the whole distinction the row used to
                    // encode in a coloured spine and two tinted chips. A run
                    // is money moving, so it is signed and coloured both ways.
                    amount={isExpense ? -item.amount : item.amount}
                    format={formatCurrency}
                    signed
                    onPress={() => toggleActiveMutation.mutate(item)}
                    lead={
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: R.pill,
                          borderCurve: 'continuous',
                          backgroundColor: urgencyDot(C, item.nextDate, item.isActive),
                        }}
                      />
                    }
                    footer={
                      item.isActive ? (
                        <PressableScale
                          onPress={running ? undefined : () => handleRunNow(item)}
                          haptic="light"
                          accessibilityRole="button"
                          accessibilityLabel={t('recurring.runNow')}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            alignSelf: 'flex-start',
                            gap: 6,
                            minHeight: 36,
                            paddingHorizontal: 14,
                            borderRadius: R.pill,
                            borderCurve: 'continuous',
                            marginTop: 8,
                            backgroundColor: C.groundSunk,
                          }}
                        >
                          {running ? (
                            <ActivityIndicator size="small" color={C.inkDim} />
                          ) : (
                            <Play size={13} color={C.inkDim} strokeWidth={S.stroke} />
                          )}
                          <Type role="meta" color={C.inkDim}>
                            {t('recurring.runNow')}
                          </Type>
                        </PressableScale>
                      ) : null
                    }
                  />
                </View>
              </SwipeRow>
            </View>
          );
        })}
      </Card>
    </View>
  );

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
      >
        <SubHeader
          pal={C}
          title={t('recurring.headerTitle')}
          onBack={() => router.back()}
          action={
            <CircleAction pal={C} label={t('recurring.createButton')} onPress={() => setAdding(true)}>
              <Plus size={20} color={C.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        {/* The one espresso anchor: the two monthly totals. Totals are
            figures, not movements, so they stay neutral on it. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card pal={C} anchor>
            <Type role="meta" color={C.onEspressoDim}>
              {t('recurring.caption', { count: active.length })}
            </Type>
            <View style={{ flexDirection: 'row', gap: 32, marginTop: 12 }}>
              <Stat
                pal={C}
                label={t('recurring.monthlySpend')}
                value={monthlyTotal(items, 'Expense')}
                format={formatCurrency}
                size={22}
                tone={C.onEspresso}
                labelTone={C.onEspressoDim}
              />
              <Stat
                pal={C}
                label={t('recurring.monthlyIncome')}
                value={monthlyTotal(items, 'Income')}
                format={formatCurrency}
                size={22}
                tone={C.onEspresso}
                labelTone={C.onEspressoDim}
              />
            </View>
          </Card>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 56, alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : isError ? (
          <Type
            role="body"
            color={C.negative}
            style={{ paddingHorizontal: S.screen, marginTop: S.section }}
          >
            {t('recurring.loadFailed')}
          </Type>
        ) : items.length === 0 ? (
          <Empty
            pal={C}
            // The anchor above is already this screen's espresso block.
            actionVariant="secondary"
            icon={<RefreshCw size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('recurring.emptyTitle')}
            body={t('recurring.emptyBody')}
            actionLabel={t('recurring.createButton')}
            onAction={() => setAdding(true)}
            style={{ marginTop: 56 }}
          />
        ) : (
          <>
            {active.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('recurring.active')} />
                {renderGroup(active)}
              </View>
            ) : null}

            {paused.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('recurring.paused')} />
                {renderGroup(paused)}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <AddRecurringSheet
        pal={C}
        visible={adding}
        form={form}
        dispatch={dispatch}
        accounts={accounts}
        onClose={() => setAdding(false)}
        onSubmit={() => createMutation.mutate(form)}
        isLoading={createMutation.isPending}
        symbol={settings?.currencySymbol || '$'}
      />
    </Screen>
  );
}
