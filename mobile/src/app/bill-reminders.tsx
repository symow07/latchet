import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Bell, Plus, Tick } from '@/components/icons';
import * as Haptics from 'expo-haptics';

import { api } from '@/lib/api/api';
import { getSettings } from '@/lib/db';
import { formatCurrency } from '@/lib/calculations';
import { categoryLabel } from '@/lib/category-meta';
import { R, S, useC, type Palette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  BalanceCard,
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
  Sheet,
  SubHeader,
  SwipeRow,
  SwitchRow,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = 'Food' | 'Gym' | 'Transport' | 'Shopping' | 'Subscriptions' | 'Other';

interface BillReminder {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: Category;
  isRecurring: boolean;
  isPaid: boolean;
  nextDueDate: string;
  createdAt?: string;
}

interface CreateBillBody {
  name: string;
  amount: number;
  dueDay: number;
  category: Category;
  isRecurring: boolean;
  nextDueDate: string;
}

const CATEGORIES: readonly Category[] = [
  'Food',
  'Gym',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Other',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeNextDueDate(dueDay: number): string {
  const today = new Date();
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), dueDay);
  const target = thisMonth >= today ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
  // Built from local Y/M/D parts, so it is not shifted a day by the timezone.
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
    target.getDate()
  ).padStart(2, '0')}`;
}

function daysUntilDue(nextDueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseISO(`${nextDueDate}T00:00:00`);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyLabel(days: number): string {
  if (days < 0) return t('billReminders.daysOverdue', { count: Math.abs(days) });
  if (days === 0) return t('billReminders.dueToday');
  if (days === 1) return t('billReminders.dueTomorrow');
  return t('billReminders.daysLeft', { count: days });
}

/**
 * The dot beside a bill.
 *
 * The old row said "how urgent" four times — a four-step colour scale on a
 * full-height accent bar, a tinted icon well, a tinted pill and the label
 * inside it. This is one 8px dot — red when due or overdue, amber when due
 * within three days — and it is a redundant cue: `urgencyLabel` already says
 * "3d left" or "2d overdue" in words, which is what a reader who cannot
 * separate amber from red is left with otherwise.
 */
function urgencyDot(pal: Palette, days: number, isPaid: boolean): string {
  if (isPaid) return pal.groundSunk;
  if (days <= 0) return pal.negative;
  if (days <= 3) return pal.warning;
  return pal.accentMark;
}

function longDate(iso: string): string {
  return format(parseISO(`${iso}T00:00:00`), 'd MMM', { locale: getDateFnsLocale() });
}

function sortBills(bills: BillReminder[]): BillReminder[] {
  return [...bills].sort((a, b) => {
    if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
    return a.nextDueDate.localeCompare(b.nextDueDate);
  });
}

function advanceByOneMonth(isoDate: string): string {
  const d = parseISO(`${isoDate}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// ─── Paid toggle ─────────────────────────────────────────────────────────────

/**
 * Filled in the tint with a check when paid (a selected control, so the
 * accent and its own foreground), an empty ring when not.
 */
function PaidToggle({
  pal,
  isPaid,
  onPress,
  label,
}: {
  pal: Palette;
  isPaid: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="light"
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isPaid }}
      accessibilityLabel={label}
      hitSlop={10}
      style={{
        width: 28,
        height: 28,
        borderRadius: R.pill,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isPaid ? pal.accent : 'transparent',
        borderWidth: isPaid ? 0 : 1.5,
        borderColor: pal.inkDim,
      }}
    >
      {isPaid ? <Tick size={16} color={pal.onAccent} strokeWidth={S.stroke} /> : null}
    </PressableScale>
  );
}

// ─── Add sheet ───────────────────────────────────────────────────────────────

function AddBillSheet({
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
  onSubmit: (data: CreateBillBody) => void;
  isLoading: boolean;
  symbol: string;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [category, setCategory] = useState<Category>('Other');
  const [isRecurring, setIsRecurring] = useState(true);
  const [error, setError] = useState('');

  const close = () => {
    setName('');
    setAmount('');
    setDueDay('1');
    setCategory('Other');
    setIsRecurring(true);
    setError('');
    onClose();
  };

  const submit = () => {
    if (!name.trim()) return setError(t('billReminders.errName'));
    const amt = parseFloat(amount);
    if (Number.isNaN(amt) || amt <= 0) return setError(t('billReminders.errAmount'));
    const day = parseInt(dueDay, 10);
    if (Number.isNaN(day) || day < 1 || day > 31) return setError(t('billReminders.errDueDay'));

    setError('');
    onSubmit({
      name: name.trim(),
      amount: amt,
      dueDay: day,
      category,
      isRecurring,
      nextDueDate: computeNextDueDate(day),
    });
  };

  return (
    <Sheet pal={pal} visible={visible} onClose={close} title={t('billReminders.newTitle')}>
      <View style={{ paddingHorizontal: S.card }}>
        <Field
          pal={pal}
          label={t('billReminders.nameLabel')}
          value={name}
          onChangeText={setName}
          placeholder={t('fields.billPlaceholder')}
        />

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Field
            pal={pal}
            label={t('billReminders.amountLabel')}
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            keyboardType="decimal-pad"
            icon={
              <Type role="cardTitle" color={pal.inkDim}>
                {symbol}
              </Type>
            }
            style={{ flex: 1 }}
          />
          <Field
            pal={pal}
            label={t('billReminders.dueDayLabel')}
            value={dueDay}
            onChangeText={setDueDay}
            placeholder="1–31"
            keyboardType="number-pad"
            style={{ flex: 1 }}
          />
        </View>

        <Type role="meta" color={pal.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
          {t('billReminders.categoryLabel')}
        </Type>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              pal={pal}
              // The picker used to print the raw stored name — "Subscriptions"
              // in every language, because the stored value is canonical
              // English and is not meant to be read.
              label={categoryLabel(c)}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>

        <SwitchRow
          pal={pal}
          title={t('billReminders.recurringMonthly')}
          body={t('billReminders.autoReset')}
          value={isRecurring}
          onValueChange={setIsRecurring}
          style={{ marginTop: 12 }}
        />

        <FormError pal={pal} message={error} />

        <PrimaryButton
          pal={pal}
          label={t('billReminders.addButton')}
          onPress={submit}
          disabled={isLoading}
          style={{ marginTop: 16 }}
        />
        {isLoading ? <ActivityIndicator color={pal.accent} style={{ marginTop: 12 }} /> : null}
      </View>
    </Sheet>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

/**
 * Bill reminders — DESIGN-PROMPT.md §27: monthly total, due grouping, paid
 * checkmarks.
 *
 * The old screen opened on a violet gradient carrying three translucent stat
 * tiles, and closed with a violet gradient FAB throwing a violet glow. Between
 * them, each bill was a card with a four-step urgency colour said four ways.
 * Now the monthly total is the one espresso anchor, each amount is a figure in
 * ink (a bill is owed, not yet money moved), and urgency is said in words.
 *
 * Under that were four separate English strings a translated app cannot use:
 * `"UPCOMING"`, `"N upcoming · N total"`, `"overdue"`, `"paid"` — plus
 * `getDaySuffix`, which appended `st`/`nd`/`rd`/`th` to a day number in every
 * language, and `toLocaleDateString('en-US')`, and a `$` hardcoded into every
 * amount. The three validation errors were hardcoded English too.
 *
 * Deleting a bill was a trash icon sitting on every row, one tap, no
 * confirmation. It is now the same sideways swipe Activity uses, with the same
 * dialog behind it — a destructive control parked beside the amount you are
 * reading is both noise and a hazard.
 */
export default function BillRemindersScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data: bills = [], isLoading, isError } = useQuery<BillReminder[]>({
    queryKey: ['bill-reminders'],
    queryFn: () => api.get<BillReminder[]>('/api/bill-reminders'),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const createMutation = useMutation({
    mutationFn: (body: CreateBillBody) => api.post<BillReminder>('/api/bill-reminders', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-reminders'] });
      setAdding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: (bill: BillReminder) =>
      api.put<BillReminder>(`/api/bill-reminders/${bill.id}`, {
        ...bill,
        isPaid: !bill.isPaid,
        // Marking a recurring bill paid rolls it forward to the next cycle.
        nextDueDate:
          !bill.isPaid && bill.isRecurring
            ? advanceByOneMonth(bill.nextDueDate)
            : bill.nextDueDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-reminders'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/bill-reminders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-reminders'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const confirmDelete = (bill: BillReminder) => {
    Alert.alert(bill.name, t('dialogs.areYouSure'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dialogs.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(bill.id),
      },
    ]);
  };

  const sorted = sortBills(bills);
  const upcoming = sorted.filter((b) => !b.isPaid);
  const paid = sorted.filter((b) => b.isPaid);
  const totalMonthly = bills.reduce((sum, b) => sum + (b.isRecurring ? b.amount : 0), 0);
  const overdueCount = upcoming.filter((b) => daysUntilDue(b.nextDueDate) <= 0).length;

  const renderGroup = (group: BillReminder[]) => (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: 0 }}>
        {group.map((bill, i) => {
          const days = daysUntilDue(bill.nextDueDate);
          const meta = [
            categoryLabel(bill.category),
            longDate(bill.nextDueDate),
            bill.isPaid ? t('billReminders.paid') : urgencyLabel(days),
            bill.isRecurring ? t('billReminders.recurring') : null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <View
              key={bill.id}
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
            >
              <SwipeRow
                pal={C}
                onDelete={() => confirmDelete(bill)}
                actionLabel={t('dialogs.delete')}
              >
                <View style={{ paddingHorizontal: S.card, opacity: bill.isPaid ? 0.55 : 1 }}>
                  <InfoRow
                    pal={C}
                    title={bill.name}
                    meta={meta}
                    amount={bill.amount}
                    format={formatCurrency}
                    lead={
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: R.pill,
                          borderCurve: 'continuous',
                          backgroundColor: urgencyDot(C, days, bill.isPaid),
                        }}
                      />
                    }
                    trailing={
                      <PaidToggle
                        pal={C}
                        isPaid={bill.isPaid}
                        label={t('billReminders.paid')}
                        onPress={() => markPaidMutation.mutate(bill)}
                      />
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
          title={t('billReminders.title')}
          onBack={() => router.back()}
          action={
            <CircleAction pal={C} label={t('billReminders.addButton')} onPress={() => setAdding(true)}>
              <Plus size={20} color={C.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        <BalanceCard
          pal={C}
          label={t('billReminders.monthlyTotal')}
          amount={totalMonthly}
          format={formatCurrency}
          caption={`${t('billReminders.caption', { count: upcoming.length })} · ${t(
            'billReminders.overdueNote',
            { count: overdueCount }
          )}`}
          style={{ paddingHorizontal: S.screen, marginTop: 24 }}
        />

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
            {t('billReminders.loadFailed')}
          </Type>
        ) : sorted.length === 0 ? (
          <Empty
            pal={C}
            icon={<Bell size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('billReminders.emptyTitle')}
            body={t('billReminders.emptyBody')}
            actionLabel={t('billReminders.addButton')}
            onAction={() => setAdding(true)}
            style={{ marginTop: 56 }}
          />
        ) : (
          <>
            {upcoming.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('billReminders.upcoming')} />
                {renderGroup(upcoming)}
              </View>
            ) : null}

            {paid.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('billReminders.paidThisCycle')} />
                {renderGroup(paid)}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <AddBillSheet
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
