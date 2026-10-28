import {
  View, ScrollView, ActivityIndicator, RefreshControl, Alert, Image, Pressable,
} from 'react-native';
import { useState } from 'react';
import { format } from 'date-fns';
import {
  Receipt, Plus, Check, XCircle, Clock, Camera, ImageIcon,
} from '@/components/icons';
import { categoryIcon } from '@/components/category-icon';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { receiptSource } from '@/lib/receipt-image';
import { hasLoadableReceipt, isLegacyLocalReceipt } from '@/lib/receipt-path';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getExpenses, submitExpense, approveExpense, rejectExpense,
  type Expense, type ExpenseStatus, type ExpenseCategory,
} from '@/lib/expenseApi';
import { getBusiness } from '@/lib/businessApi';
import { roleOf } from '@/lib/group-members';
import { canReviewExpense, reviewNote } from '@/lib/expense-review';
import { useSession } from '@/lib/auth/use-session';
import { formatCurrency } from '@/lib/calculations';
import { BAR, R, S, useC, type Palette } from '@/lib/design';
import {
  Amount, BalanceCard, Card, CircleAction, Empty, Field, FilterChip, FormError,
  Header, IconTile, PrimaryButton, Screen, Sheet, Stat, Touchable, Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { expenseCategoryLabel, expenseStatusLabel } from '@/lib/expense-meta';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CATEGORIES: ExpenseCategory[] = ['Travel', 'Software', 'Meals', 'Transport', 'Office', 'Other'];

const STATUS_FILTERS: (ExpenseStatus | 'all')[] = ['all', 'pending', 'approved', 'rejected'];

/**
 * A review state's tone. It always travels with its word (approved, rejected,
 * pending), so the state never rests on telling two tints apart.
 *
 * Categories have no colour at all any more: the identity marks a category by
 * its glyph on a sunk tile, never by a swatch (DESIGN-IDENTITY.md, "No category
 * rainbow").
 */
function statusTone(pal: Palette, status: ExpenseStatus): string {
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
  const B = useC();
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
      if (isNaN(value) || value <= 0) throw new Error(t('businessExpenses.errAmount'));
      if (!description.trim()) throw new Error(t('businessExpenses.errDescription'));
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
                  gap: 8, minHeight: 52, borderRadius: R.pill, borderCurve: 'continuous',
                  overflow: 'hidden', backgroundColor: B.groundSunk,
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
  pal, expense, viewerId, role, onApprove, onReject,
}: {
  pal: Palette;
  expense: Expense;
  /** The signed-in user and their role in the business, which decide whether review is offered. */
  viewerId: string | undefined;
  role: string | undefined;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [showImage, setShowImage] = useState(false);
  const date = format(new Date(expense.submittedAt), 'd MMM', { locale: getDateFnsLocale() });
  const note = reviewNote(expense, viewerId, role);
  const Glyph = categoryIcon(expense.category);

  return (
    <Card pal={pal}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* The category's glyph on a sunk tile, as every transaction row
            draws it. */}
        <IconTile pal={pal} size={40} style={{ backgroundColor: pal.groundSunk }}>
          <Glyph size={22} color={pal.ink} />
        </IconTile>
        <View style={{ flex: 1 }}>
          <Type role="cardTitle" color={pal.ink} numberOfLines={2}>{expense.description}</Type>
          <Type role="meta" color={pal.inkDim} numberOfLines={1}>
            {expense.submitter.name} · {date}
          </Type>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {/* Money out: red, and signed, so the direction never rests on
              colour alone. */}
          <Amount
            value={-expense.amount}
            format={formatCurrency}
            size={17}
            weight="semibold"
            color={pal.negative}
            signed
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

      {/* §6.18 — approve is the expected outcome and carries the weight: the
          tint on its own wash, as a selected chip is drawn. Reject is
          available without being equally inviting: red words on a quiet sunk
          pill. Neither is espresso, which belongs to the summary above — a
          screen of pending expenses would otherwise be a stack of anchors.
          Offered only where the server would accept it: never on your own
          expense, which used to end in "Something went wrong". */}
      {canReviewExpense(expense, viewerId, role) ? (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Touchable
            pal={pal}
            bleed={0}
            onPress={() => onApprove(expense.id)}
            accessibilityLabel={t('businessExpenses.approve')}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 7, minHeight: 46, borderRadius: R.pill, borderCurve: 'continuous',
              overflow: 'hidden', backgroundColor: pal.accentSoft,
            }}
          >
            <Check size={16} color={pal.accent} strokeWidth={S.stroke} />
            <Type role="meta" color={pal.accent}>{t('businessExpenses.approve')}</Type>
          </Touchable>
          <Touchable
            pal={pal}
            bleed={0}
            onPress={() => onReject(expense.id)}
            accessibilityLabel={t('businessExpenses.reject')}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 7, minHeight: 46, borderRadius: R.pill, borderCurve: 'continuous',
              overflow: 'hidden', backgroundColor: pal.groundSunk,
            }}
          >
            <XCircle size={16} color={pal.negative} strokeWidth={S.stroke} />
            <Type role="meta" color={pal.negative}>{t('businessExpenses.reject')}</Type>
          </Touchable>
        </View>
      ) : note ? (
        // Pending, but not yours to review: say who it is waiting for rather
        // than leaving a pending expense with no way forward on screen.
        <Type role="meta" color={pal.inkDim} style={{ marginTop: 12 }}>
          {t(note === 'waitingForOther'
            ? 'businessExpenses.waitingForOther'
            : 'businessExpenses.waitingForApprover')}
        </Type>
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
 * caps. The identity allows one espresso anchor per screen and separates
 * surfaces with shadow, so the pair became a single anchor with two figures on
 * it — which is also the only honest reading, since one is a subset of the
 * other.
 */
export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const B = useC();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const [filter, setFilter] = useState<ExpenseStatus | 'all'>('all');
  const [showSubmit, setShowSubmit] = useState(false);

  const { data: expenses = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['biz-expenses', filter],
    queryFn: () => getExpenses(filter === 'all' ? undefined : filter),
  });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });

  const viewerId = session?.user?.id;
  const myRole = roleOf(business, viewerId);
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

        {/* The screen's one espresso anchor. Totals are neutral figures, so
            they are set in the anchor's own off-white rather than red. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <BalanceCard
            pal={B}
            label={t('businessExpenses.total')}
            amount={total}
            format={formatCurrency}
            caption={t('businessExpenses.expenseCount', { count: expenses.length })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
              <Stat
                pal={B}
                label={t('businessExpenses.approved')}
                value={approved}
                format={formatCurrency}
                size={17}
                tone={B.onEspresso}
                labelTone={B.onEspressoDim}
              />
              <Stat
                pal={B}
                label={pendingCount > 0
                  ? t('businessExpenses.pendingReview', { count: pendingCount })
                  : t('businessExpenses.nonePending')}
                value={total - approved}
                format={formatCurrency}
                size={17}
                tone={B.onEspresso}
                labelTone={B.onEspressoDim}
                align="flex-end"
              />
            </View>
          </BalanceCard>
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
          <>
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
              onAction={() => setShowSubmit(true)}
              // The summary above is already the screen's espresso anchor.
              actionVariant="secondary"
              style={{ marginTop: 64 }}
            />
          </>
        ) : (
          <View style={{ paddingHorizontal: S.screen, gap: 12, marginTop: S.section }}>
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                pal={B}
                expense={expense}
                viewerId={viewerId}
                role={myRole}
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
