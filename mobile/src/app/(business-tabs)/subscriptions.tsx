import {
  View, ScrollView, Switch, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useState, useCallback } from 'react';
import { Briefcase, Plus, Trash2 } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/lib/auth/use-session';
import {
  getPayroll, setSalary, deleteSalary, markPaid, markUnpaid,
  type SalaryRecord,
} from '@/lib/salaryApi';
import { type GroupMember } from '@/lib/businessApi';
import { roleOf } from '@/lib/group-members';
import { formatCurrency } from '@/lib/calculations';
import { BAR, R, S, useC, type Palette } from '@/lib/design';
import {
  Amount, BalanceCard, Card, ChoiceRow, CircleAction, Empty, Field, FormError, PrimaryButton,
  Screen, SectionHeader, Sheet, Stat, Stepper, Touchable, Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The month name in the user's own language, not a baked-in English table. */
function monthName(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(getDateFnsLocale()?.code ?? undefined, {
    month: 'long',
  });
}

/**
 * A person's initials on a sunk squircle: the same tile a category glyph sits
 * on, so a list of people and a list of expenses share one shape.
 */
function initialsTile(pal: Palette, name: string | null | undefined) {
  return (
    <View
      style={{
        width: 40, height: 40, borderRadius: R.sm, borderCurve: 'continuous',
        backgroundColor: pal.groundSunk,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Type role="meta" color={pal.ink}>{initialsOf(name)}</Type>
    </View>
  );
}

function initialsOf(name: string | null | undefined): string {
  return (name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ── Add salary ───────────────────────────────────────────────────────────────

/**
 * The add form, as a sheet rather than a full-screen modal with its own
 * dropdown inside it.
 *
 * The old version nested a custom select inside a modal inside a keyboard
 * avoider — three layers of chrome around three fields. The eligible members
 * are a short list, so they are simply *shown*: picking one is one tap instead
 * of two, and there is no closed state to misread.
 */
function AddSalarySheet({
  visible, onClose, members, existingUserIds,
}: {
  visible: boolean;
  onClose: () => void;
  members: GroupMember[];
  existingUserIds: Set<string>;
}) {
  const B = useC();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const eligible = members.filter((m) => m.role !== 'owner' && !existingUserIds.has(m.userId));

  function reset() {
    setUserId('');
    setAmount('');
    setTitle('');
    setError('');
  }

  const save = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error(t('businessPayroll.selectMember'));
      const value = parseFloat(amount);
      if (isNaN(value) || value <= 0) throw new Error(t('businessPayroll.monthlySalary'));
      return setSalary({ userId, amount: value, title: title.trim() || null });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['payroll'] });
      reset();
      onClose();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e.message);
    },
  });

  return (
    <Sheet
      pal={B}
      visible={visible}
      title={t('businessPayroll.addSalary')}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: S.card, paddingBottom: 8 }}
      >
        {eligible.length === 0 ? (
          <Type role="body" color={B.inkDim} style={{ paddingVertical: 12 }}>
            {t('businessPayroll.allHaveSalaries')}
          </Type>
        ) : (
          <View style={{ gap: 8, marginBottom: 16 }}>
            {eligible.map((m) => (
              <ChoiceRow
                key={m.userId}
                pal={B}
                title={m.user?.name ?? m.userId}
                body={m.user?.email}
                selected={userId === m.userId}
                onPress={() => {
                  setUserId(m.userId);
                  setError('');
                }}
                icon={initialsTile(B, m.user?.name)}
              />
            ))}
          </View>
        )}

        <Field
          pal={B}
          label={t('businessPayroll.jobTitle')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('fields.rolePlaceholder')}
          style={{ marginBottom: 16 }}
        />
        <Field
          pal={B}
          label={t('businessPayroll.monthlySalary')}
          value={amount}
          onChangeText={(v) => {
            setAmount(v);
            setError('');
          }}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        <FormError pal={B} message={error} />

        <PrimaryButton
          pal={B}
          label={save.isPending ? t('businessPayroll.adding') : t('businessPayroll.addToPayroll')}
          onPress={() => save.mutate()}
          disabled={save.isPending || eligible.length === 0}
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </Sheet>
  );
}

// ── Employee ─────────────────────────────────────────────────────────────────

/**
 * One employee. Avatar, name, salary, and a switch that means "paid".
 *
 * The paid state used to be carried by a tinted card, a tinted avatar, a
 * tinted border and a custom toggle — four ways of saying one boolean. It is
 * now the switch, plus a line of prose under the name saying when they were
 * paid. A switch is a familiar control that already means exactly this, so it
 * needs no colour vocabulary of its own.
 *
 * A salary is money going out, so it is red and carries its minus, as every
 * outgoing amount in the app does. Someone who cannot edit sees the state as
 * a word instead: Paid in green, Due in the warning tone.
 */
function EmployeeRow({
  pal, record, month, year, canEdit, onToggle, onDelete,
}: {
  pal: Palette;
  record: SalaryRecord;
  month: number;
  year: number;
  canEdit: boolean;
  onToggle: (id: string, paid: boolean) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const paid = record.payment.status === 'paid';
  const when = paid && record.payment.paidAt
    ? t('businessPayroll.paidPill')
    : t('businessPayroll.pendingFor', { month: monthName(month, year) });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: 12 }}>
      {initialsTile(pal, record.user.name)}

      <View style={{ flex: 1 }}>
        <Type role="cardTitle" color={pal.ink} numberOfLines={1}>{record.user.name}</Type>
        <Type role="meta" color={pal.inkDim} numberOfLines={1}>
          {record.title || when}
        </Type>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Amount
          value={-record.amount}
          format={formatCurrency}
          size={17}
          weight="semibold"
          color={pal.negative}
          signed
        />
        {canEdit ? (
          <Switch
            value={paid}
            onValueChange={() => onToggle(record.id, paid)}
            accessibilityLabel={t('businessPayroll.paidPill')}
            trackColor={{ false: pal.groundSunk, true: pal.accent }}
            thumbColor={pal.groundAlt}
            ios_backgroundColor={pal.groundSunk}
            style={{ transform: [{ scale: 0.85 }] }}
          />
        ) : (
          <Type role="meta" color={paid ? pal.positive : pal.warning}>
            {paid ? t('businessPayroll.paidPill') : t('businessPayroll.duePill')}
          </Type>
        )}
      </View>

      {canEdit ? (
        <Touchable
          pal={pal}
          bleed={6}
          onPress={() => onDelete(record.id, record.user.name)}
          accessibilityLabel={t('dialogs.remove')}
          style={{ padding: 8 }}
        >
          <Trash2 size={16} color={pal.inkFaint} strokeWidth={S.stroke} />
        </Touchable>
      ) : null}
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

/**
 * Payroll. Also rendered inside the Money tab, which supplies the ground, the
 * heading and the segmented control; `embedded` drops this screen's own
 * chrome so the two do not stack.
 */
export default function PayrollScreen({ embedded }: { embedded?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const B = useC();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['payroll', month, year],
    queryFn: () => getPayroll(month, year),
  });
  const { data: business } = useQuery({
    queryKey: ['my-business'],
    queryFn: () => import('@/lib/businessApi').then((m) => m.getBusiness()),
  });
  const { data: members = [] } = useQuery({
    queryKey: ['biz-members'],
    queryFn: () => import('@/lib/businessApi').then((m) => m.getMembers()),
  });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['payroll'] }); }, [qc]));

  const myRole = roleOf(business, session?.user?.id);
  const canEdit = myRole === 'owner' || myRole === 'manager';
  const invalidate = () => qc.invalidateQueries({ queryKey: ['payroll'] });

  const toggleMut = useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) =>
      paid ? markUnpaid(id, month, year) : markPaid(id, month, year),
    onMutate: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); invalidate(); },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteSalary,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); invalidate(); },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });

  function handleDelete(id: string, name: string) {
    Alert.alert(t('dialogs.removePayroll'), t('dialogs.removePayrollBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dialogs.remove'), style: 'destructive', onPress: () => deleteMut.mutate(id) },
    ]);
  }

  function step(delta: number) {
    Haptics.selectionAsync();
    const next = month + delta;
    if (next < 1) { setMonth(12); setYear((y) => y - 1); }
    else if (next > 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth(next);
  }

  const salaries = data?.salaries ?? [];
  const summary = data?.summary;
  const paid = salaries.filter((s) => s.payment.status === 'paid');
  const unpaid = salaries.filter((s) => s.payment.status === 'unpaid');
  const paidRatio = salaries.length > 0 ? paid.length / salaries.length : 0;
  const existingIds = new Set(salaries.map((s) => s.userId));
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const body = (
    <>
      <AddSalarySheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        members={members}
        existingUserIds={existingIds}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: BAR.clearance(insets.bottom) }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={B.accent} />
        }
      >
        {embedded ? null : (
          <SectionHeader pal={B} title={t('businessPayroll.title')} style={{ marginTop: 8 }} />
        )}

        <Stepper
          pal={B}
          label={`${monthName(month, year)} ${year}`}
          caption={isCurrentMonth ? t('businessPayroll.currentMonth') : undefined}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          style={{ marginTop: embedded ? 24 : 16 }}
        />

        {isLoading ? (
          <View style={{ paddingVertical: 80, alignItems: 'center' }}>
            <ActivityIndicator color={B.accent} />
          </View>
        ) : (
          <>
            {/* The screen's one espresso anchor. The old version was a navy
                gradient carrying a glow, a bordered icon chip and three
                differently-coloured figures. Now: off-white figures, and a
                silver line for how much of the month is paid. The totals are
                neutral figures, not movements, so they carry no red. */}
            <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
              <BalanceCard
                pal={B}
                label={t('businessPayroll.total')}
                amount={summary?.totalPayroll ?? 0}
                format={formatCurrency}
              >
                {salaries.length > 0 ? (
                  <View
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: Math.round(paidRatio * 100) }}
                    style={{
                      height: 6, borderRadius: 3, marginTop: 16,
                      backgroundColor: B.glassStrong,
                      overflow: 'hidden', flexDirection: 'row',
                    }}
                  >
                    <View
                      style={{
                        width: `${paidRatio * 100}%`,
                        borderRadius: 3,
                        backgroundColor: B.silver,
                      }}
                    />
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
                  <Stat
                    pal={B}
                    label={t('businessPayroll.paidCount', { count: paid.length })}
                    value={summary?.paidTotal ?? 0}
                    format={formatCurrency}
                    size={17}
                    tone={B.onEspresso}
                    labelTone={B.onEspressoDim}
                  />
                  <Stat
                    pal={B}
                    label={t('businessPayroll.duePill')}
                    value={summary?.unpaidTotal ?? 0}
                    format={formatCurrency}
                    size={17}
                    tone={B.onEspresso}
                    labelTone={B.onEspressoDim}
                    align="flex-end"
                  />
                </View>
              </BalanceCard>
            </View>

            {salaries.length === 0 ? (
              <>
                <Empty
                  pal={B}
                  icon={<Briefcase size={26} color={B.accent} strokeWidth={S.stroke} />}
                  title={t('businessPayroll.none')}
                  body={canEdit ? t('businessPayroll.tapAdd') : t('businessPayroll.notConfigured')}
                  actionLabel={canEdit ? t('businessPayroll.addButton') : undefined}
                  onAction={() => setShowAdd(true)}
                  // The payroll total above is already the screen's espresso anchor.
                  actionVariant="secondary"
                  style={{ marginTop: 64 }}
                />
              </>
            ) : (
              <View style={{ marginTop: S.section }}>
                <SectionHeader
                  pal={B}
                  title={t('businessPayroll.title')}
                  actionLabel={canEdit ? t('businessPayroll.addButton') : undefined}
                  onAction={canEdit ? () => setShowAdd(true) : undefined}
                />
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {[...unpaid, ...paid].map((record, i) => (
                      <View
                        key={record.id}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : undefined}
                      >
                        <EmployeeRow
                          pal={B}
                          record={record}
                          month={month}
                          year={year}
                          canEdit={canEdit}
                          onToggle={(id, isPaid) => toggleMut.mutate({ id, paid: isPaid })}
                          onDelete={handleDelete}
                        />
                      </View>
                    ))}
                  </Card>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );

  if (embedded) return <View style={{ flex: 1 }}>{body}</View>;
  return (
    <Screen pal={B}>
      <View style={{ alignItems: 'flex-end', paddingHorizontal: S.screen, paddingTop: 8 }}>
        {canEdit ? (
          <CircleAction pal={B} label={t('businessPayroll.addButton')} onPress={() => setShowAdd(true)}>
            <Plus size={19} color={B.ink} strokeWidth={S.stroke} />
          </CircleAction>
        ) : null}
      </View>
      {body}
    </Screen>
  );
}
