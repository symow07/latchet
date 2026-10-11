import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Play, Plus, RefreshCw } from '@/components/icons';
import * as Haptics from 'expo-haptics';

import { api } from '@/lib/api/api';
import { getSettings } from '@/lib/db';
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

type Category = 'Food' | 'Gym' | 'Transport' | 'Shopping' | 'Subscriptions' | 'Other';
type TxType = 'Expense' | 'Income';
type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

interface RecurringTransaction {
  id: string;
  name: string;
  amount: number;
  category: Category;
  type: TxType;
  isImpulse: boolean;
  frequency: Frequency;
  startDate: string;
  nextDate: string;
  isActive: boolean;
  currency: string;
  createdAt?: string;
}

interface CreateRecurringBody {
  name: string;
  amount: number;
  category: Category;
  type: TxType;
  isImpulse: boolean;
  frequency: Frequency;
  startDate: string;
  nextDate: string;
  currency: string;
}

interface CreateTransactionBody {
  name: string;
  amount: number;
  category: Category;
  type: TxType;
  isImpulse: boolean;
  note: string;
  dateISO: string;
  currency: string;
}

const CATEGORIES: readonly Category[] = [
  'Food',
  'Gym',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Other',
];

const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

/** How many times a frequency runs in an average month. */
const PER_MONTH: Record<Frequency, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  yearly: 1 / 12,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function daysUntilNext(nextDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = parseISO(`${nextDate}T00:00:00`);
  next.setHours(0, 0, 0, 0);
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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

function monthlyTotal(items: RecurringTransaction[], type: TxType): number {
  return items
    .filter((item) => item.isActive && item.type === type)
    .reduce((sum, item) => sum + item.amount * PER_MONTH[item.frequency], 0);
}

// ─── Add sheet ───────────────────────────────────────────────────────────────

function AddRecurringSheet({
  pal,
  visible,
  onClose,
  onSubmit,
  isLoading,
  symbol,
}: {
  pal: Palette;
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<CreateRecurringBody, 'currency'>) => void;
  isLoading: boolean;
  symbol: string;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('Subscriptions');
  const [txType, setTxType] = useState<TxType>('Expense');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [error, setError] = useState('');

  const close = () => {
    setName('');
    setAmount('');
    setCategory('Subscriptions');
    setTxType('Expense');
    setFrequency('monthly');
    setError('');
    onClose();
  };

  const submit = () => {
    if (!name.trim()) return setError(t('recurring.errName'));
    const amt = parseFloat(amount);
    if (Number.isNaN(amt) || amt <= 0) return setError(t('recurring.errAmount'));

    setError('');
    const today = todayISO();
    onSubmit({
      name: name.trim(),
      amount: amt,
      category,
      type: txType,
      isImpulse: false,
      frequency,
      startDate: today,
      nextDate: today,
    });
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
          value={txType}
          onChange={setTxType}
        />

        <Field
          pal={pal}
          label={t('recurring.name')}
          value={name}
          onChangeText={setName}
          placeholder={t('fields.recurringPlaceholder')}
          style={{ marginTop: 16 }}
        />

        <Field
          pal={pal}
          label={t('recurring.amount')}
          value={amount}
          onChangeText={setAmount}
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
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              pal={pal}
              label={categoryLabel(c)}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
          {t('recurring.frequency')}
        </Type>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FREQUENCIES.map((f) => (
            <FilterChip
              key={f}
              pal={pal}
              label={t(`frequency.${f}`)}
              active={frequency === f}
              onPress={() => setFrequency(f)}
            />
          ))}
        </View>

        <FormError pal={pal} message={error} />

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16 }}>
          {t('recurring.autoRuns')}
        </Type>

        <PrimaryButton
          pal={pal}
          label={t('recurring.createButton')}
          onPress={submit}
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
 */
export default function RecurringScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const { data: items = [], isLoading, isError } = useQuery<RecurringTransaction[]>({
    queryKey: ['recurring'],
    queryFn: () => api.get<RecurringTransaction[]>('/api/recurring'),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const currency = settings?.currency || 'USD';

  const createMutation = useMutation({
    mutationFn: (body: Omit<CreateRecurringBody, 'currency'>) =>
      // The user's currency, not a literal 'USD'. Stored on the item because
      // the server replays it into a transaction later, long after this screen
      // is gone.
      api.post<RecurringTransaction>('/api/recurring', { ...body, currency }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setAdding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (item: RecurringTransaction) =>
      api.put<RecurringTransaction>(`/api/recurring/${item.id}`, {
        ...item,
        isActive: !item.isActive,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/recurring/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async (item: RecurringTransaction) => {
      const today = todayISO();
      const txBody: CreateTransactionBody = {
        name: item.name,
        amount: item.amount,
        category: item.category,
        type: item.type,
        isImpulse: false,
        note: t('recurring.noteRuns', { frequency: t(`frequency.${item.frequency}`) }),
        dateISO: today,
        currency: item.currency ?? currency,
      };
      await api.post('/api/transactions', txBody);
      await api.put(`/api/recurring/${item.id}`, { ...item, nextDate: today });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setRunningId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      setRunningId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleRunNow = (item: RecurringTransaction) => {
    setRunningId(item.id);
    runNowMutation.mutate(item);
  };

  const confirmDelete = (item: RecurringTransaction) => {
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

  const renderGroup = (group: RecurringTransaction[]) => (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: 0 }}>
        {group.map((item, i) => {
          const isExpense = item.type === 'Expense';
          const running = runningId === item.id;
          const meta = [
            categoryLabel(item.category),
            t(`frequency.${item.frequency}`),
            item.isActive ? nextRunLabel(item.nextDate) : t('recurring.paused'),
            format(parseISO(`${item.nextDate}T00:00:00`), 'd MMM', { locale: getDateFnsLocale() }),
          ].join(' · ');

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
        onClose={() => setAdding(false)}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
        symbol={settings?.currencySymbol || '$'}
      />
    </Screen>
  );
}
