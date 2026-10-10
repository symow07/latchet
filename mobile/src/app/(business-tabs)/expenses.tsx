import {
  View, ScrollView, ActivityIndicator, RefreshControl, Alert, Image, Pressable,
} from 'react-native';
import { useState } from 'react';
import { format } from 'date-fns';
import {
  Receipt, Plus, Check, XCircle, Clock, Camera, ImageIcon,
} from '@/components/icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { receiptSource } from '@/lib/receipt-image';
import { hasLoadableReceipt, isLegacyLocalReceipt } from '@/lib/receipt-path';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getExpenses, submitExpense, approveExpense, rejectExpense,
  type Expense, type ExpenseStatus, type ExpenseCategory,
} from '@/lib/expenseApi';
import { getBusiness } from '@/lib/businessApi';
import { roleOf } from '@/lib/group-members';
import { useSession } from '@/lib/auth/use-session';
import { formatCurrency } from '@/lib/calculations';
import { BAR, R, S, useB, type BizPalette } from '@/lib/design';
import {
  Amount, Card, CircleAction, Empty, Field, FilterChip, FormError,
  Header, PrimaryButton, Screen, Sheet, Stat, Touchable, Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { expenseCategoryLabel, expenseStatusLabel } from '@/lib/expense-meta';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CATEGORIES: ExpenseCategory[] = ['Travel', 'Software', 'Meals', 'Transport', 'Office', 'Other'];

const STATUS_FILTERS: (ExpenseStatus | 'all')[] = ['all', 'pending', 'approved', 'rejected'];

/**
 * A category's mark, from the palette's own ramp.
 *
 * These used to be six hardcoded hexes — indigo, teal, amber, blue, pink and,
 * on the *business* screen, the personal profile's violet. §2.5 supplies a
 * muted eight-step ramp that clears 3:1 on each ground and is verified in both
 * schemes, and it exists precisely so screens stop inventing colours.
 */
function catColor(pal: BizPalette, category: string): string {
  const index = CATEGORIES.indexOf(category as ExpenseCategory);
  return pal.cat[(index < 0 ? CATEGORIES.length - 1 : index) % pal.cat.length]!;
}

function statusTone(pal: BizPalette, status: ExpenseStatus): string {
  return status === 'approved' ? pal.positive : status === 'rejected' ? pal.negative : pal.warning;
}

// ── Submit ───────────────────────────────────────────────────────────────────

function SubmitSheet({
  visible, onClose, onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const B = useB();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Other');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [error, setError] = useState('');

  function reset() {
    setAmount('');
    setDescription('');
    setCategory('Other');
    setImageUri(null);
    setError('');
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, quality: 0.7, base64: false,
    });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('dialogs.permissionNeeded'), t('dialogs.cameraNeeded'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true, quality: 0.7, base64: false,
    });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Read at submit time rather than at pick time: the picker's base64
      // option holds the whole image in memory from the moment it is chosen,
      // and most picks are re-picked or abandoned.
      const base64 = imageUri
        ? await FileSystem.readAsStringAsync(imageUri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        : null;
      const value = parseFloat(amount);
      if (isNaN(value) || value <= 0) throw new Error(t('businessExpenses.amount'));
      if (!description.trim()) throw new Error(t('businessExpenses.description'));
      return submitExpense({
        amount: value, category, description: description.trim(), image: base64,
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onDone();
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
      title={t('businessExpenses.new')}
      onClose={() => { reset(); onClose(); }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: S.card, paddingBottom: 8 }}
      >
        <Field
          pal={B}
          label={t('businessExpenses.amount')}
          value={amount}
          onChangeText={(v) => { setAmount(v); setError(''); }}
          placeholder="0"
          keyboardType="decimal-pad"
        />

        <Field
          pal={B}
          label={t('businessExpenses.description')}
          value={description}
          onChangeText={(v) => { setDescription(v); setError(''); }}
          placeholder={t('businessExpenses.descPlaceholder')}
          style={{ marginTop: 16 }}
        />

        <Type role="meta" color={B.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
          {t('businessExpenses.category')}
        </Type>
        {/* Shown, not hidden behind a dropdown. Six options is a list, and a
            closed select is one more state to misread. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              pal={B}
              label={expenseCategoryLabel(c)}
              mark={catColor(B, c)}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>

        <Type role="meta" color={B.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
          {t('businessExpenses.receipt')}
        </Type>
        {imageUri ? (
          <View>
            <Image
              source={{ uri: imageUri }}
              style={{ width: '100%', height: 150, borderRadius: R.md }}
              resizeMode="cover"
            />
            <Touchable
              pal={B}
              bleed={0}
              onPress={() => setImageUri(null)}
              accessibilityLabel={t('businessExpenses.removeImage')}
              style={{ alignItems: 'center', paddingVertical: 14 }}
            >
              <Type role="meta" color={B.negative}>{t('businessExpenses.removeImage')}</Type>
            </Touchable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([
              { label: t('businessExpenses.camera'), icon: Camera, onPress: takePhoto },
              { label: t('businessExpenses.gallery'), icon: ImageIcon, onPress: pickImage },
            ]).map(({ label, icon: Icon, onPress }) => (
              <Touchable
                key={label}
                pal={B}
                bleed={0}
                onPress={onPress}
                accessibilityLabel={label}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 8, minHeight: 52, borderRadius: R.pill, backgroundColor: B.groundSunk,
                }}
              >
                <Icon size={17} color={B.ink} strokeWidth={S.stroke} />
                <Type role="meta" color={B.ink}>{label}</Type>
              </Touchable>
            ))}
          </View>
        )}

        <FormError pal={B} message={error} />

        <PrimaryButton
          pal={B}
          label={mutation.isPending
            ? t('businessExpenses.submitting')
            : t('businessExpenses.submitExpense')}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{ marginTop: 24 }}
        />
      </ScrollView>
    </Sheet>
  );
}

// ── One expense ──────────────────────────────────────────────────────────────

function ExpenseCard({
  pal, expense, canReview, onApprove, onReject,
}: {
  pal: BizPalette;
  expense: Expense;
  canReview: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [showImage, setShowImage] = useState(false);
  const date = format(new Date(expense.submittedAt), 'd MMM', { locale: getDateFnsLocale() });

  return (
    <Card pal={pal}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: catColor(pal, expense.category),
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Type role="cardTitle" color={pal.groundAlt}>
            {expenseCategoryLabel(expense.category).charAt(0).toUpperCase()}
          </Type>
        </View>
        <View style={{ flex: 1 }}>
          <Type role="cardTitle" color={pal.ink} numberOfLines={2}>{expense.description}</Type>
          <Type role="meta" color={pal.inkDim} numberOfLines={1}>
            {expense.submitter.name} · {date}
          </Type>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Amount
            value={expense.amount}
            format={formatCurrency}
            size={17}
            weight="semibold"
            color={pal.ink}
          />
          {/* Sentence case, not `status.toUpperCase()`. The status also has a
              word, so it never depends on telling two tints apart. */}
          <Type role="meta" color={statusTone(pal, expense.status)}>
            {expenseStatusLabel(expense.status)}
          </Type>
        </View>
      </View>

      {isLegacyLocalReceipt(expense.imageUrl) ? (
        // Submitted before receipts were uploaded: the bytes only ever existed
        // on the submitter's phone, so say so instead of showing a broken box.
        <Type role="meta" color={pal.inkDim} style={{ marginTop: 12 }}>
          {t('businessExpenses.receiptUnavailable')}
        </Type>
      ) : null}

      {hasLoadableReceipt(expense.imageUrl) ? (
        <Pressable onPress={() => setShowImage((v) => !v)} style={{ marginTop: 12 }}>
          {showImage ? (
            <Image
              source={receiptSource(expense.imageUrl)!}
              style={{ width: '100%', height: 170, borderRadius: R.sm }}
              resizeMode="cover"
            />
          ) : (
            <Type role="meta" color={pal.accent}>{t('businessExpenses.viewReceipt')}</Type>
          )}
        </Pressable>
      ) : null}

      {expense.reviewer ? (
        <Type role="meta" color={pal.inkDim} style={{ marginTop: 12 }}>
          {t(
            expense.status === 'approved'
              ? 'businessExpenses.approvedBy'
              : 'businessExpenses.rejectedBy',
            { name: expense.reviewer.name }
          )}
        </Type>
      ) : null}

      {/* §6.18 — a filled positive pill and an outlined negative one. Approve
          is the expected outcome and carries the weight; reject is available
          without being equally inviting. */}
      {canReview && expense.status === 'pending' ? (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Touchable
            pal={pal}
            bleed={0}
            onPress={() => onApprove(expense.id)}
            accessibilityLabel={t('businessExpenses.approve')}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 7, minHeight: 46, borderRadius: R.pill, backgroundColor: pal.positive,
            }}
          >
            <Check size={16} color={pal.groundAlt} strokeWidth={2.4} />
            <Type role="meta" color={pal.groundAlt}>{t('businessExpenses.approve')}</Type>
          </Touchable>
          <Touchable
            pal={pal}
            bleed={0}
            onPress={() => onReject(expense.id)}
            accessibilityLabel={t('businessExpenses.reject')}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 7, minHeight: 46, borderRadius: R.pill,
              borderWidth: 1, borderColor: pal.negative,
            }}
          >
            <XCircle size={16} color={pal.negative} strokeWidth={S.stroke} />
            <Type role="meta" color={pal.negative}>{t('businessExpenses.reject')}</Type>
          </Touchable>
        </View>
      ) : null}
    </Card>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

/**
 * Expenses — DESIGN-PROMPT.md §33.
 *
 * The two summary boxes at the top used to be a pink-tinted card beside a
 * green-tinted one, each outlined in its own hue and captioned in tracked-out
 * caps. §1.1 allows one dark object per screen and §1.5 separates surfaces
 * with shadow, so the pair became a single ink card with two figures on it —
 * which is also the only honest reading, since one is a subset of the other.
 */
export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const B = useB();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const [filter, setFilter] = useState<ExpenseStatus | 'all'>('all');
  const [showSubmit, setShowSubmit] = useState(false);

  const { data: expenses = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['biz-expenses', filter],
    queryFn: () => getExpenses(filter === 'all' ? undefined : filter),
  });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });

  const myRole = roleOf(business, session?.user?.id);
  const canReview = myRole === 'owner' || myRole === 'manager';
  const invalidate = () => qc.invalidateQueries({ queryKey: ['biz-expenses'] });

  const approveMut = useMutation({
    mutationFn: approveExpense,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); invalidate(); },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });
  const rejectMut = useMutation({
    mutationFn: rejectExpense,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); invalidate(); },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const approved = expenses.filter((e) => e.status === 'approved').reduce((sum, e) => sum + e.amount, 0);
  const pendingCount = expenses.filter((e) => e.status === 'pending').length;

  return (
    <Screen pal={B}>
      <SubmitSheet visible={showSubmit} onClose={() => setShowSubmit(false)} onDone={invalidate} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />
        }
      >
        <Header
          pal={B}
          title={t('businessExpenses.title')}
          actions={
            <CircleAction pal={B} label={t('businessExpenses.add')} onPress={() => setShowSubmit(true)}>
              <Plus size={19} color={B.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card pal={B} radius={24} padding={S.card + 2} contentStyle={{ backgroundColor: B.inkSoft }}>
            <Type role="meta" color={B.onInk} style={{ opacity: 0.7 }}>
              {t('businessExpenses.total')}
            </Type>
            <Amount
              value={total}
              format={formatCurrency}
              size={40}
              color={B.onInk}
              style={{ marginTop: 6 }}
            />
            <Type role="meta" color={B.onInk} style={{ opacity: 0.7, marginTop: 6 }}>
              {t('businessExpenses.expenseCount', { count: expenses.length })}
            </Type>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
              <Stat
                pal={B}
                label={t('businessExpenses.approved')}
                value={approved}
                format={formatCurrency}
                size={17}
                tone={B.onInk}
                labelTone={B.onInk}
              />
              <Stat
                pal={B}
                label={pendingCount > 0
                  ? t('businessExpenses.pendingReview', { count: pendingCount })
                  : t('businessExpenses.nonePending')}
                value={total - approved}
                format={formatCurrency}
                size={17}
                tone={B.onInk}
                labelTone={B.onInk}
                align="flex-end"
              />
            </View>
          </Card>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: S.section }}
          contentContainerStyle={{ paddingHorizontal: S.screen, gap: 8 }}
        >
          {STATUS_FILTERS.map((value) => (
            <FilterChip
              key={value}
              pal={B}
              label={expenseStatusLabel(value)}
              active={filter === value}
              onPress={() => setFilter(value)}
            />
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 64 }}>
            <ActivityIndicator color={B.accent} />
          </View>
        ) : expenses.length === 0 ? (
          <Empty
            pal={B}
            icon={
              filter === 'pending'
                ? <Clock size={26} color={B.accent} strokeWidth={S.stroke} />
                : <Receipt size={26} color={B.accent} strokeWidth={S.stroke} />
            }
            title={filter === 'pending'
              ? t('businessExpenses.noPending')
              : t('businessExpenses.noneYet')}
            body={filter === 'pending'
              ? t('businessExpenses.allCaughtUp')
              : t('businessExpenses.tapAddFirst')}
            actionLabel={filter === 'pending' ? undefined : t('businessExpenses.add')}
            onAction={filter === 'pending' ? undefined : () => setShowSubmit(true)}
            style={{ marginTop: 64 }}
          />
        ) : (
          <View style={{ paddingHorizontal: S.screen, gap: 12, marginTop: S.section }}>
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                pal={B}
                expense={expense}
                canReview={canReview}
                onApprove={(id) => approveMut.mutate(id)}
                onReject={(id) => rejectMut.mutate(id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
