import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState } from 'react';
import { useC } from '@/lib/design';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Check,
  Bell,
  Calendar,
  DollarSign,
  X,
  ChevronDown,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInUp,
  FadeInDown,
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';

import { api } from '@/lib/api/api';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/category-meta';

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

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES: { label: Category; emoji: string }[] = [
  { label: 'Food', emoji: '' },
  { label: 'Gym', emoji: '' },
  { label: 'Transport', emoji: '' },
  { label: 'Shopping', emoji: '' },
  { label: 'Subscriptions', emoji: '' },
  { label: 'Other', emoji: '' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCategoryEmoji(category: Category): string {
  return CATEGORIES.find((c) => c.label === category)?.emoji ?? '';
}

function computeNextDueDate(dueDay: number): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  // Try this month first
  const thisMonth = new Date(year, month, dueDay);
  if (thisMonth >= today) {
    return thisMonth.toISOString().split('T')[0];
  }

  // Otherwise next month
  const nextMonth = new Date(year, month + 1, dueDay);
  return nextMonth.toISOString().split('T')[0];
}

function daysUntilDue(nextDueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDueDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyColor(days: number): string {
  if (days <= 0) return '#ef4444'; // red — overdue
  if (days <= 3) return '#f97316'; // orange — very soon
  if (days <= 7) return '#eab308'; // yellow — soon
  return '#22c55e'; // green — fine
}

function urgencyLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days}d left`;
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sortBills(bills: BillReminder[]): BillReminder[] {
  return [...bills].sort((a, b) => {
    // Unpaid before paid
    if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
    return new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime();
  });
}

// ─── Animated Check Button ───────────────────────────────────────────────────

function PaidButton({
  isPaid,
  onPress,
}: {
  isPaid: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withSpring(1.35, { damping: 4 }),
      withSpring(1, { damping: 10 }),
    );
    onPress();
  };

  return (
    <Pressable onPress={handlePress} hitSlop={8}>
      <Animated.View
        style={[
          animStyle,
          {
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isPaid ? '#22c55e' : 'transparent',
            borderWidth: isPaid ? 0 : 2,
            borderColor: '#4b5563',
          },
        ]}
      >
        {isPaid && <Check size={16} color="white" strokeWidth={3} />}
      </Animated.View>
    </Pressable>
  );
}

// ─── Bill Card ───────────────────────────────────────────────────────────────

function BillCard({
  bill,
  index,
  onMarkPaid,
  onDelete,
}: {
  bill: BillReminder;
  index: number;
  onMarkPaid: (bill: BillReminder) => void;
  onDelete: (id: string) => void;
}) {
  const C = useC();
  const days = daysUntilDue(bill.nextDueDate);
  const color = bill.isPaid ? '#4b5563' : urgencyColor(days);
  const label = urgencyLabel(days);
  const emoji = getCategoryEmoji(bill.category);

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(350)}>
      <View
        style={{
          backgroundColor: C.bgRaise,
          borderRadius: 16,
          marginBottom: 10,
          overflow: 'hidden',
          flexDirection: 'row',
          opacity: bill.isPaid ? 0.6 : 1,
        }}
      >
        {/* Left accent bar */}
        <View style={{ width: 4, backgroundColor: color }} />

        <View style={{ flex: 1, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: emoji + name + category */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  backgroundColor: `${color}18`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Text style={{ fontSize: 20 }}>{emoji}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: bill.isPaid ? '#6b7280' : '#f3f4f6',
                    fontSize: 15,
                    fontWeight: '600',
                    textDecorationLine: bill.isPaid ? 'line-through' : 'none',
                  }}
                  numberOfLines={1}
                >
                  {bill.name}
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 1 }}>
                  {categoryLabel(bill.category)} · Due {bill.dueDay}{getDaySuffix(bill.dueDay)} of month
                </Text>
              </View>
            </View>

            {/* Right: amount + badge */}
            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
              <Text style={{ color: '#f3f4f6', fontSize: 16, fontWeight: '700' }}>
                {formatAmount(bill.amount)}
              </Text>
              {!bill.isPaid && (
                <View
                  style={{
                    marginTop: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 99,
                    backgroundColor: `${color}22`,
                  }}
                >
                  <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
                </View>
              )}
              {bill.isPaid && (
                <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                  Paid
                </Text>
              )}
            </View>
          </View>

          {/* Bottom row: actions */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Calendar size={12} color="#6b7280" />
              <Text style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>
                {formatDate(bill.nextDueDate)}
              </Text>
              {bill.isRecurring && (
                <View
                  style={{
                    marginLeft: 8,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: 4,
                    backgroundColor: `${C.p500}20`,
                  }}
                >
                  <Text style={{ color: C.p500, fontSize: 10, fontWeight: '600' }}>{t('billReminders.recurring')}</Text>
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onDelete(bill.id);
                }}
                hitSlop={8}
              >
                <Trash2 size={16} color="#6b7280" />
              </Pressable>
              <PaidButton
                isPaid={bill.isPaid}
                onPress={() => onMarkPaid(bill)}
              />
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function getDaySuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Add Bill Modal ───────────────────────────────────────────────────────────

function AddBillModal({
  visible,
  onClose,
  onSubmit,
  isLoading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: CreateBillBody) => void;
  isLoading: boolean;
}) {
  const C = useC();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [category, setCategory] = useState<Category>('Other');
  const [isRecurring, setIsRecurring] = useState(true);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName('');
    setAmount('');
    setDueDay('1');
    setCategory('Other');
    setIsRecurring(true);
    setShowCategoryPicker(false);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) { setError('Name is required'); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount'); return; }
    const day = parseInt(dueDay, 10);
    if (isNaN(day) || day < 1 || day > 31) { setError('Due day must be between 1 and 31'); return; }

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
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' }}
          onPress={handleClose}
        >
          <Pressable onPress={() => {}} style={{ width: '100%' }}>
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={{
                backgroundColor: C.bgRaise,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                padding: 24,
                paddingBottom: 40,
              }}
            >
              {/* Handle */}
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: '#374151',
                  alignSelf: 'center',
                  marginBottom: 20,
                }}
              />

              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <Text style={{ color: '#f3f4f6', fontSize: 20, fontWeight: '700' }}>
                  New Bill Reminder
                </Text>
                <Pressable onPress={handleClose} hitSlop={8}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: '#1f2937',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={16} color="#9ca3af" />
                  </View>
                </Pressable>
              </View>

              {error ? (
                <View
                  style={{
                    backgroundColor: '#7f1d1d30',
                    borderWidth: 1,
                    borderColor: '#ef444440',
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ color: '#fca5a5', fontSize: 13 }}>{error}</Text>
                </View>
              ) : null}

              {/* Name */}
              <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
                BILL NAME
              </Text>
              <View
                style={{
                  backgroundColor: '#1f2937',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  marginBottom: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Bell size={16} color="#6b7280" />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Netflix, Rent, Gym…"
                  placeholderTextColor="#4b5563"
                  style={{ flex: 1, color: '#f3f4f6', fontSize: 15, marginLeft: 10 }}
                />
              </View>

              {/* Amount + Due Day row */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
                    AMOUNT
                  </Text>
                  <View
                    style={{
                      backgroundColor: '#1f2937',
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <DollarSign size={16} color="#6b7280" />
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      placeholder="0.00"
                      placeholderTextColor="#4b5563"
                      keyboardType="decimal-pad"
                      style={{ flex: 1, color: '#f3f4f6', fontSize: 15, marginLeft: 6 }}
                    />
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
                    DUE DAY
                  </Text>
                  <View
                    style={{
                      backgroundColor: '#1f2937',
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Calendar size={16} color="#6b7280" />
                    <TextInput
                      value={dueDay}
                      onChangeText={setDueDay}
                      placeholder="1–31"
                      placeholderTextColor="#4b5563"
                      keyboardType="number-pad"
                      style={{ flex: 1, color: '#f3f4f6', fontSize: 15, marginLeft: 6 }}
                    />
                  </View>
                </View>
              </View>

              {/* Category */}
              <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
                CATEGORY
              </Text>
              <Pressable
                onPress={() => setShowCategoryPicker((p) => !p)}
                style={{
                  backgroundColor: '#1f2937',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  marginBottom: showCategoryPicker ? 0 : 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, marginRight: 10 }}>
                    {getCategoryEmoji(category)}
                  </Text>
                  <Text style={{ color: '#f3f4f6', fontSize: 15 }}>{category}</Text>
                </View>
                <ChevronDown
                  size={18}
                  color="#6b7280"
                  style={{ transform: [{ rotate: showCategoryPicker ? '180deg' : '0deg' }] }}
                />
              </Pressable>

              {showCategoryPicker && (
                <View
                  style={{
                    backgroundColor: C.bgRaise,
                    borderRadius: 12,
                    marginBottom: 16,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: '#27272a',
                  }}
                >
                  {CATEGORIES.map((cat, idx) => (
                    <Pressable
                      key={cat.label}
                      onPress={() => {
                        setCategory(cat.label);
                        setShowCategoryPicker(false);
                        Haptics.selectionAsync();
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 12,
                        paddingHorizontal: 14,
                        backgroundColor: category === cat.label ? `${C.p500}18` : 'transparent',
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderColor: '#27272a',
                      }}
                    >
                      <Text style={{ fontSize: 18, marginRight: 12 }}>{cat.emoji}</Text>
                      <Text
                        style={{
                          color: category === cat.label ? C.p500 : '#d1d5db',
                          fontSize: 15,
                          fontWeight: category === cat.label ? '600' : '400',
                        }}
                      >
                        {cat.label}
                      </Text>
                      {category === cat.label && (
                        <Check size={16} color={C.p500} style={{ marginLeft: 'auto' }} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Recurring toggle */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#1f2937',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  marginBottom: 24,
                }}
              >
                <View>
                  <Text style={{ color: '#f3f4f6', fontSize: 15, fontWeight: '500' }}>
                    Recurring monthly
                  </Text>
                  <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 1 }}>
                    Auto-reset on the next cycle
                  </Text>
                </View>
                <Switch
                  value={isRecurring}
                  onValueChange={setIsRecurring}
                  trackColor={{ false: '#374151', true: C.p600 }}
                  thumbColor={isRecurring ? C.p500 : '#9ca3af'}
                />
              </View>

              {/* Submit */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  handleSubmit();
                }}
                disabled={isLoading}
                style={{ borderRadius: 14, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={isLoading ? ['#4b5563', '#374151'] : [C.p600, C.p500]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    paddingVertical: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 8,
                  }}
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <>
                      <Plus size={20} color="white" />
                      <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                        Add Bill Reminder
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </Animated.View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function BillRemindersScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────

  const {
    data: bills = [],
    isLoading,
    isError,
  } = useQuery<BillReminder[]>({
    queryKey: ['bill-reminders'],
    queryFn: () => api.get<BillReminder[]>('/api/bill-reminders'),
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: CreateBillBody) =>
      api.post<BillReminder>('/api/bill-reminders', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-reminders'] });
      setShowAddModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: (bill: BillReminder) =>
      api.put<BillReminder>(`/api/bill-reminders/${bill.id}`, {
        ...bill,
        isPaid: !bill.isPaid,
        // If marking paid on a recurring bill, advance the next due date by 1 month
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
  });

  // ── Derived data ─────────────────────────────────────────────────────────

  const sorted = sortBills(bills);
  const totalMonthly = bills.reduce((sum, b) => sum + (b.isRecurring ? b.amount : 0), 0);
  const unpaidCount = bills.filter((b) => !b.isPaid).length;
  const overdueCount = bills.filter((b) => !b.isPaid && daysUntilDue(b.nextDueDate) <= 0).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header gradient ── */}
      <LinearGradient
        colors={[C.p800, C.p600, C.p500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 36,
          paddingHorizontal: 16,
        }}
      >
        {/* Nav row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>

          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>{t('billReminders.title')}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>
              {unpaidCount} upcoming · {bills.length} total
            </Text>
          </View>

          <View style={{ width: 40 }} />
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(255,255,255,0.15)',
              borderRadius: 14,
              padding: 14,
            }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' }}>
              MONTHLY TOTAL
            </Text>
            <Text style={{ color: 'white', fontSize: 22, fontWeight: '800', marginTop: 4 }}>
              {formatAmount(totalMonthly)}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 }}>
              recurring bills
            </Text>
          </View>

          <View style={{ gap: 10, flex: 0.8 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: overdueCount > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.15)',
                borderRadius: 14,
                padding: 10,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>{overdueCount}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>overdue</Text>
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: 'rgba(255,255,255,0.15)',
                borderRadius: 14,
                padding: 10,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>
                {bills.length - unpaidCount}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>paid</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <View style={{ flex: 1, marginTop: -20 }}>
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.p500} size="large" />
          </View>
        ) : isError ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Text style={{ color: '#9ca3af', textAlign: 'center', fontSize: 15 }}>
              Could not load bill reminders. Check your connection.
            </Text>
          </View>
        ) : sorted.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: `${C.p500}15`,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Bell size={32} color={C.p500} />
            </View>
            <Text style={{ color: '#f3f4f6', fontSize: 18, fontWeight: '700', marginBottom: 6 }}>
              No Bill Reminders
            </Text>
            <Text style={{ color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
              Tap the + button to add your first bill reminder and never miss a due date.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 24,
              paddingBottom: 120,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* Section: Upcoming */}
            {sorted.filter((b) => !b.isPaid).length > 0 && (
              <>
                <Text
                  style={{
                    color: '#6b7280',
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginLeft: 2,
                  }}
                >
                  UPCOMING
                </Text>
                {sorted
                  .filter((b) => !b.isPaid)
                  .map((bill, idx) => (
                    <BillCard
                      key={bill.id}
                      bill={bill}
                      index={idx}
                      onMarkPaid={(b) => markPaidMutation.mutate(b)}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  ))}
              </>
            )}

            {/* Section: Paid */}
            {sorted.filter((b) => b.isPaid).length > 0 && (
              <>
                <Text
                  style={{
                    color: '#6b7280',
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginLeft: 2,
                    marginTop: sorted.filter((b) => !b.isPaid).length > 0 ? 16 : 0,
                  }}
                >
                  PAID THIS CYCLE
                </Text>
                {sorted
                  .filter((b) => b.isPaid)
                  .map((bill, idx) => (
                    <BillCard
                      key={bill.id}
                      bill={bill}
                      index={idx}
                      onMarkPaid={(b) => markPaidMutation.mutate(b)}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  ))}
              </>
            )}
          </ScrollView>
        )}
      </View>

      {/* ── FAB ── */}
      <Animated.View
        entering={ZoomIn.delay(200).duration(300)}
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          right: 20,
        }}
      >
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowAddModal(true);
          }}
          style={{ borderRadius: 30, overflow: 'hidden', elevation: 8 }}
        >
          <LinearGradient
            colors={[C.p600, C.p500]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: C.p500,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5,
              shadowRadius: 12,
            }}
          >
            <Plus size={28} color="white" strokeWidth={2.5} />
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {/* ── Add Modal ── */}
      <AddBillModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />
    </View>
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function advanceByOneMonth(isoDate: string): string {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}
