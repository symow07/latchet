import {
  View, ScrollView, Pressable, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
  RefreshControl, Alert, Image,
} from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Receipt, Plus, X, Check, XCircle,
  Plane, Laptop, Coffee, Car, Building, Tag,
  ChevronDown, Clock, Camera, ImageIcon,
} from 'lucide-react-native';
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
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground, BubbleButton } from '@/components/ui';
import { t } from '@/lib/i18n/core';
import { expenseCategoryLabel, expenseStatusLabel } from '@/lib/expense-meta';

type CatMeta = { label: ExpenseCategory; icon: React.ComponentType<{ size: number; color: string }>; color: string };

const CATEGORIES: CatMeta[] = [
  { label: 'Travel', icon: Plane, color: '#818cf8' },
  { label: 'Software', icon: Laptop, color: '#14b8a6' },
  { label: 'Meals', icon: Coffee, color: '#f59e0b' },
  { label: 'Transport', icon: Car, color: '#3b82f6' },
  { label: 'Office', icon: Building, color: '#f472b6' },
  { label: 'Other', icon: Tag, color: '#a78bfa' },
];

const STATUS_FILTERS: { value: ExpenseStatus | 'all' }[] = [
  { value: 'all' },
  { value: 'pending' },
  { value: 'approved' },
  { value: 'rejected' },
];

const STATUS_COLOR: Record<ExpenseStatus, string> = { pending: '#f59e0b', approved: '#14b8a6', rejected: '#ef4444' };

function catMeta(cat: string): CatMeta {
  return CATEGORIES.find(c => c.label === cat) ?? CATEGORIES[5];
}

function FieldLabel({ children }: { children: string }) {
  const B = useB();
  return <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>{children}</Txt>;
}

// ─── Submit Modal ──────────────────────────────────────────────────────────────
function SubmitModal({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const B = useB();
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<ExpenseCategory>('Other');
  const [catOpen, setCatOpen] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function pickImage() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.7, base64: false });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  }
  async function takePhoto() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert(t('dialogs.permissionNeeded'), t('dialogs.cameraNeeded')); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7, base64: false });
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
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) throw new Error('Enter a valid amount');
      if (!desc.trim()) throw new Error('Description is required');
      return submitExpense({ amount: num, category: cat, description: desc.trim(), image: base64 });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAmount(''); setDesc(''); setCat('Other'); setImageUri(null); setErr('');
      onDone(); onClose();
    },
    onError: (e: Error) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setErr(e.message); },
  });

  const selCat = CATEGORIES.find(c => c.label === cat)!;
  const CatIcon = selCat.icon;

  function handleClose() { setAmount(''); setDesc(''); setCat('Other'); setImageUri(null); setErr(''); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={handleClose} />
        <View style={{ backgroundColor: B.slate900, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: `${B.accent}26`, padding: 22, paddingBottom: 44, maxHeight: '92%' }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ width: 40, height: 4, backgroundColor: B.slate700, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <Txt weight="bold" size={20} color={B.text}>{t('businessExpenses.new')}</Txt>
              <Pressable onPress={handleClose} hitSlop={10}><X size={22} color={B.textFaint} /></Pressable>
            </View>

            {!!err && (
              <GlassCard padding={12} radius={R.sm} tint={`${B.red}16`} border={`${B.red}33`} style={{ marginBottom: 14 }}>
                <Txt size={13} color={B.red} style={{ textAlign: 'center' }}>{err}</Txt>
              </GlassCard>
            )}

            <FieldLabel>{t('businessExpenses.amount')}</FieldLabel>
            <GlassCard padding={0} radius={R.md} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <Txt weight="bold" size={20} color={B.accent} style={{ marginEnd: 8 }}>$</Txt>
                <TextInput value={amount} onChangeText={t => { setAmount(t); setErr(''); }} placeholder="0.00" placeholderTextColor={B.textFaint} keyboardType="decimal-pad" style={{ flex: 1, color: B.text, fontSize: 24, fontFamily: 'PlusJakartaSans_700Bold', padding: 0 }} selectionColor={B.accent} />
              </View>
            </GlassCard>

            <FieldLabel>{t('businessExpenses.category')}</FieldLabel>
            <Pressable onPress={() => setCatOpen(v => !v)}>
              <GlassCard padding={0} radius={R.md} border={catOpen ? `${B.accent}55` : B.glassBorder} style={{ marginBottom: catOpen ? 0 : 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 }}>
                  <IconBubble color={selCat.color} size={32} radius={10} style={{ marginEnd: 12 }}><CatIcon size={16} color={selCat.color} /></IconBubble>
                  <Txt size={15} color={B.textDim} style={{ flex: 1 }}>{expenseCategoryLabel(cat)}</Txt>
                  <ChevronDown size={16} color={B.textFaint} />
                </View>
              </GlassCard>
            </Pressable>
            {catOpen && (
              <GlassCard padding={0} radius={R.md} tint={B.bgDeep} style={{ marginBottom: 14, overflow: 'hidden' }}>
                {CATEGORIES.map(c => {
                  const Icon = c.icon; const active = cat === c.label;
                  return (
                    <Pressable key={c.label} onPress={() => { setCat(c.label); setCatOpen(false); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: active ? `${B.accent}12` : 'transparent' })}>
                      <IconBubble color={c.color} size={28} radius={8} style={{ marginEnd: 12 }}><Icon size={14} color={c.color} /></IconBubble>
                      <Txt size={14} color={active ? B.accent : B.textDim} style={{ flex: 1 }}>{expenseCategoryLabel(c.label)}</Txt>
                      {active && <Check size={14} color={B.accent} />}
                    </Pressable>
                  );
                })}
              </GlassCard>
            )}

            <FieldLabel>{t('businessExpenses.description')}</FieldLabel>
            <TextInput value={desc} onChangeText={t => { setDesc(t); setErr(''); }} placeholder={t('businessExpenses.descPlaceholder')} placeholderTextColor={B.textFaint} multiline numberOfLines={3} style={{ color: B.text, fontSize: 15, fontFamily: 'PlusJakartaSans_500Medium', backgroundColor: B.glass, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: B.glassBorder, textAlignVertical: 'top', minHeight: 80, marginBottom: 14 }} selectionColor={B.accent} />

            <FieldLabel>{t('businessExpenses.receipt')}</FieldLabel>
            {imageUri ? (
              <View style={{ marginBottom: 14 }}>
                <Image source={{ uri: imageUri }} style={{ width: '100%', height: 140, borderRadius: R.md, marginBottom: 8 }} resizeMode="cover" />
                <Pressable onPress={() => setImageUri(null)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: `${B.red}16`, borderRadius: 12, paddingVertical: 9, borderWidth: 1, borderColor: `${B.red}33` }}>
                  <X size={14} color={B.red} />
                  <Txt weight="semibold" size={13} color={B.red}>{t('businessExpenses.removeImage')}</Txt>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <Pressable onPress={takePhoto} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: `${B.accent}0e`, borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: `${B.accent}2a` })}>
                  <Camera size={16} color={B.accent} />
                  <Txt weight="semibold" size={13} color={B.accent}>{t('businessExpenses.camera')}</Txt>
                </Pressable>
                <Pressable onPress={pickImage} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: `${B.accent}0e`, borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: `${B.accent}2a` })}>
                  <ImageIcon size={16} color={B.accent} />
                  <Txt weight="semibold" size={13} color={B.accent}>{t('businessExpenses.gallery')}</Txt>
                </Pressable>
              </View>
            )}

            <View style={{ marginTop: 4 }}>
              <BubbleButton
                label={mutation.isPending ? t('businessExpenses.submitting') : t('businessExpenses.submitExpense')}
                onPress={() => mutation.mutate()}
                disabled={mutation.isPending}
                radius={R.md}
                colors={[B.accentDeep, B.accent]}
                glowColor={B.accent}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Expense Card ────────────────────────────────────────────────────────────────
function ExpenseCard({ expense, canReview, onApprove, onReject }: { expense: Expense; canReview: boolean; onApprove: (id: string) => void; onReject: (id: string) => void }) {
  const B = useB();
  const [showImage, setShowImage] = useState(false);
  const meta = catMeta(expense.category);
  const CatIcon = meta.icon;
  const date = new Date(expense.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <GlassCard padding={16} radius={R.lg}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
        <IconBubble color={meta.color} size={44} radius={14} style={{ marginEnd: 12 }}><CatIcon size={20} color={meta.color} /></IconBubble>
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={15} color={B.text} numberOfLines={2}>{expense.description}</Txt>
          <Txt size={12} color={B.textFaint} style={{ marginTop: 2 }}>{expense.submitter.name} · {date}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <Txt weight="bold" size={17} color={B.text}>${expense.amount.toFixed(2)}</Txt>
          <Pill label={expense.status.toUpperCase()} color={STATUS_COLOR[expense.status]} />
        </View>
      </View>

      {isLegacyLocalReceipt(expense.imageUrl) && (
        // Submitted before receipts were uploaded: the bytes only ever existed
        // on the submitter's phone, so say so instead of showing a broken box.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <ImageIcon size={12} color={B.textFaint} />
          <Txt size={11} color={B.textFaint}>{t('businessExpenses.receiptUnavailable')}</Txt>
        </View>
      )}

      {hasLoadableReceipt(expense.imageUrl) && (
        <Pressable onPress={() => setShowImage(v => !v)} style={{ marginBottom: 8 }}>
          {showImage ? (
            <Image source={receiptSource(expense.imageUrl)!} style={{ width: '100%', height: 160, borderRadius: 12 }} resizeMode="cover" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${B.accent}10`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: `${B.accent}22` }}>
              <ImageIcon size={12} color={B.accent} />
              <Txt weight="semibold" size={11} color={B.accent}>{t('businessExpenses.viewReceipt')}</Txt>
            </View>
          )}
        </Pressable>
      )}

      {expense.reviewer && (
        <Txt size={12} color={B.textFaint} style={{ marginBottom: 6 }}>
          {t(expense.status === 'approved' ? 'businessExpenses.approvedBy' : 'businessExpenses.rejectedBy', { name: expense.reviewer.name })}
        </Txt>
      )}

      {canReview && expense.status === 'pending' && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Pressable onPress={() => onApprove(expense.id)} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: `${B.teal}16`, borderRadius: 12, paddingVertical: 11, gap: 5, borderWidth: 1, borderColor: `${B.teal}33` })}>
            <Check size={14} color={B.teal} strokeWidth={3} />
            <Txt weight="bold" size={13} color={B.teal}>{t('businessExpenses.approve')}</Txt>
          </Pressable>
          <Pressable onPress={() => onReject(expense.id)} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: `${B.red}16`, borderRadius: 12, paddingVertical: 11, gap: 5, borderWidth: 1, borderColor: `${B.red}33` })}>
            <XCircle size={14} color={B.red} />
            <Txt weight="bold" size={13} color={B.red}>{t('businessExpenses.reject')}</Txt>
          </Pressable>
        </View>
      )}
    </GlassCard>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────────
export default function ExpensesScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
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

  const approveMut = useMutation({ mutationFn: approveExpense, onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); invalidate(); }, onError: (e: Error) => Alert.alert(t('common.error'), e.message) });
  const rejectMut = useMutation({ mutationFn: rejectExpense, onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); invalidate(); }, onError: (e: Error) => Alert.alert(t('common.error'), e.message) });

  const totalAll = expenses.reduce((s, e) => s + e.amount, 0);
  const totalApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
  const pendingCount = expenses.filter(e => e.status === 'pending').length;

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <SubmitModal visible={showSubmit} onClose={() => setShowSubmit(false)} onDone={invalidate} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
          <View>
            <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>{t('business.label')}</Txt>
            <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>{t('businessExpenses.title')}</Txt>
          </View>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowSubmit(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: `${B.accent}22`, borderWidth: 1.5, borderColor: `${B.accent}44` })}>
            <Plus size={16} color={B.accent} />
            <Txt weight="bold" size={13} color={B.accent}>{t('businessExpenses.add')}</Txt>
          </Pressable>
        </View>

        {/* Summary */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 18 }}>
          <GlassCard style={{ flex: 1 }} padding={16} radius={R.md} tint={`${B.red}10`} border={`${B.red}26`}>
            <Txt weight="semibold" size={11} color={B.textFaint} style={{ marginBottom: 4 }}>{t('businessExpenses.total')}</Txt>
            <Txt weight="bold" size={22} color={B.text}>${totalAll.toFixed(2)}</Txt>
            <Txt size={11} color={B.textFaint} style={{ marginTop: 2 }}>{t('businessExpenses.expenseCount', { count: expenses.length })}</Txt>
          </GlassCard>
          <GlassCard style={{ flex: 1 }} padding={16} radius={R.md} tint={`${B.teal}10`} border={`${B.teal}26`}>
            <Txt weight="semibold" size={11} color={B.textFaint} style={{ marginBottom: 4 }}>{t('businessExpenses.approved')}</Txt>
            <Txt weight="bold" size={22} color={B.teal}>${totalApproved.toFixed(2)}</Txt>
            <Txt size={11} color={B.textFaint} style={{ marginTop: 2 }}>{pendingCount > 0 ? `${pendingCount} pending review` : 'none pending'}</Txt>
          </GlassCard>
        </View>

        {/* Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 18 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          {STATUS_FILTERS.map(f => {
            const active = filter === f.value;
            return (
              <Pressable key={f.value} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilter(f.value as ExpenseStatus | 'all'); }} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, paddingHorizontal: 16, paddingVertical: 8, borderRadius: R.pill, backgroundColor: active ? `${B.accent}1f` : B.glass, borderWidth: 1.5, borderColor: active ? `${B.accent}55` : 'transparent' })}>
                <Txt weight="bold" size={13} color={active ? B.accent : B.textFaint}>{expenseStatusLabel(f.value)}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* List */}
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 56 }}><ActivityIndicator color={B.accent} size="large" /></View>
          ) : expenses.length === 0 ? (
            <GlassCard padding={40} radius={R.lg} style={{ alignItems: 'center' }}>
              {filter === 'pending' ? <Clock size={32} color={B.slate700} /> : <Receipt size={32} color={B.slate700} />}
              <Txt weight="semibold" size={14} color={B.textDim} style={{ marginTop: 12, marginBottom: 4 }}>{filter === 'pending' ? t('businessExpenses.noPending') : t('businessExpenses.noneYet')}</Txt>
              <Txt size={12} color={B.textFaint}>{filter === 'pending' ? t('businessExpenses.allCaughtUp') : t('businessExpenses.tapAddFirst')}</Txt>
            </GlassCard>
          ) : (
            expenses.map(expense => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                canReview={canReview}
                onApprove={id => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); approveMut.mutate(id); }}
                onReject={id => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); rejectMut.mutate(id); }}
              />
            ))
          )}
        </View>
      </ScrollView>
    </BizBackground>
  );
}
