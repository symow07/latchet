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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  X,
  DollarSign,
  Tag,
  Calendar,
  Repeat,
  Check,
  Play,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInUp,
  FadeInDown,
  ZoomIn,
} from 'react-native-reanimated';
import { api } from '@/lib/api/api';

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

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { label: Category; emoji: string }[] = [
  { label: 'Food', emoji: '🍔' },
  { label: 'Gym', emoji: '💪' },
  { label: 'Transport', emoji: '🚗' },
  { label: 'Shopping', emoji: '🛍️' },
  { label: 'Subscriptions', emoji: '📱' },
  { label: 'Other', emoji: '📦' },
];

const FREQUENCIES: { value: Frequency; label: string; shortLabel: string }[] = [
  { value: 'daily', label: 'Daily', shortLabel: 'Daily' },
  { value: 'weekly', label: 'Weekly', shortLabel: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly', shortLabel: 'Bi-wk' },
  { value: 'monthly', label: 'Monthly', shortLabel: 'Monthly' },
  { value: 'yearly', label: 'Yearly', shortLabel: 'Yearly' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryEmoji(category: Category): string {
  return CATEGORIES.find((c) => c.label === category)?.emoji ?? '📦';
}

function getFrequencyLabel(frequency: Frequency): string {
  return FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency;
}

function getFrequencyShort(frequency: Frequency): string {
  return FREQUENCIES.find((f) => f.value === frequency)?.shortLabel ?? frequency;
}

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function daysUntilNext(nextDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(nextDate);
  next.setHours(0, 0, 0, 0);
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function nextDateLabel(nextDate: string): string {
  const days = daysUntilNext(nextDate);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Tomorrow';
  return `In ${days}d`;
}

function nextDateColor(nextDate: string, isActive: boolean): string {
  if (!isActive) return '#4b5563';
  const days = daysUntilNext(nextDate);
  if (days < 0) return '#ef4444';
  if (days <= 3) return '#f97316';
  if (days <= 7) return '#eab308';
  return '#22c55e';
}

/**
 * Compute the total monthly equivalent cost for active expense items.
 * Inactive and income items are excluded.
 */
function monthlyEquivalent(items: RecurringTransaction[]): number {
  return items
    .filter((item) => item.isActive && item.type === 'Expense')
    .reduce((sum, item) => {
      let monthly = 0;
      switch (item.frequency) {
        case 'daily': monthly = item.amount * 30; break;
        case 'weekly': monthly = item.amount * 4.33; break;
        case 'biweekly': monthly = item.amount * 2.17; break;
        case 'monthly': monthly = item.amount; break;
        case 'yearly': monthly = item.amount / 12; break;
      }
      return sum + monthly;
    }, 0);
}

function monthlyIncomeEquivalent(items: RecurringTransaction[]): number {
  return items
    .filter((item) => item.isActive && item.type === 'Income')
    .reduce((sum, item) => {
      let monthly = 0;
      switch (item.frequency) {
        case 'daily': monthly = item.amount * 30; break;
        case 'weekly': monthly = item.amount * 4.33; break;
        case 'biweekly': monthly = item.amount * 2.17; break;
        case 'monthly': monthly = item.amount; break;
        case 'yearly': monthly = item.amount / 12; break;
      }
      return sum + monthly;
    }, 0);
}

// ─── Recurring Card ───────────────────────────────────────────────────────────

function RecurringCard({
  item,
  index,
  onToggleActive,
  onDelete,
  onRunNow,
  isRunning,
}: {
  item: RecurringTransaction;
  index: number;
  onToggleActive: (item: RecurringTransaction) => void;
  onDelete: (id: string) => void;
  onRunNow: (item: RecurringTransaction) => void;
  isRunning: boolean;
}) {
  const isExpense = item.type === 'Expense';
  const accentColor = !item.isActive
    ? '#4b5563'
    : isExpense
    ? '#ef4444'
    : '#22c55e';

  const nextLabel = nextDateLabel(item.nextDate);
  const nextColor = nextDateColor(item.nextDate, item.isActive);
  const emoji = getCategoryEmoji(item.category);
  const freqLabel = getFrequencyShort(item.frequency);

  return (
    <Animated.View entering={FadeInUp.delay(index * 55).duration(340)}>
      <View
        style={{
          backgroundColor: '#18181b',
          borderRadius: 18,
          marginBottom: 10,
          overflow: 'hidden',
          flexDirection: 'row',
          opacity: item.isActive ? 1 : 0.55,
        }}
      >
        {/* Left accent bar */}
        <View style={{ width: 4, backgroundColor: accentColor }} />

        <View style={{ flex: 1, padding: 14 }}>
          {/* Top row */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Emoji icon */}
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 13,
                backgroundColor: `${accentColor}18`,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </View>

            {/* Name + meta */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text
                  style={{
                    color: item.isActive ? '#f3f4f6' : '#6b7280',
                    fontSize: 15,
                    fontWeight: '700',
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                {/* Frequency badge */}
                <View
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                    borderRadius: 6,
                    backgroundColor: `${accentColor}20`,
                  }}
                >
                  <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700' }}>
                    {freqLabel}
                  </Text>
                </View>
              </View>
              <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                {item.category} · {item.type}
              </Text>
            </View>

            {/* Amount */}
            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
              <Text
                style={{
                  color: isExpense ? '#ef4444' : '#22c55e',
                  fontSize: 16,
                  fontWeight: '800',
                }}
              >
                {isExpense ? '-' : '+'}{formatAmount(item.amount)}
              </Text>
              {/* Next date badge */}
              <View
                style={{
                  marginTop: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 99,
                  backgroundColor: `${nextColor}18`,
                }}
              >
                <Text style={{ color: nextColor, fontSize: 11, fontWeight: '600' }}>
                  {nextLabel}
                </Text>
              </View>
            </View>
          </View>

          {/* Bottom row: date + actions */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Calendar size={12} color="#6b7280" />
              <Text style={{ color: '#6b7280', fontSize: 12, marginLeft: 5 }}>
                Next: {formatDateShort(item.nextDate)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* Run now */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onRunNow(item);
                }}
                disabled={isRunning || !item.isActive}
                hitSlop={8}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                  backgroundColor: item.isActive ? '#22c55e18' : '#27272a',
                }}
              >
                {isRunning ? (
                  <ActivityIndicator size={12} color="#22c55e" />
                ) : (
                  <Play size={12} color={item.isActive ? '#22c55e' : '#4b5563'} />
                )}
                <Text
                  style={{
                    color: item.isActive ? '#22c55e' : '#4b5563',
                    fontSize: 11,
                    fontWeight: '600',
                  }}
                >
                  Run now
                </Text>
              </Pressable>

              {/* Delete */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onDelete(item.id);
                }}
                hitSlop={8}
              >
                <Trash2 size={16} color="#6b7280" />
              </Pressable>

              {/* Active toggle */}
              <Switch
                value={item.isActive}
                onValueChange={() => {
                  Haptics.selectionAsync();
                  onToggleActive(item);
                }}
                trackColor={{ false: '#374151', true: '#16653a' }}
                thumbColor={item.isActive ? '#22c55e' : '#9ca3af'}
                style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
              />
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Add Recurring Modal ──────────────────────────────────────────────────────

function AddRecurringModal({
  visible,
  onClose,
  onSubmit,
  isLoading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: CreateRecurringBody) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('Subscriptions');
  const [txType, setTxType] = useState<TxType>('Expense');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showFrequencyPicker, setShowFrequencyPicker] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName('');
    setAmount('');
    setCategory('Subscriptions');
    setTxType('Expense');
    setFrequency('monthly');
    setShowCategoryPicker(false);
    setShowFrequencyPicker(false);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) { setError('Name is required'); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount greater than 0'); return; }

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
      currency: 'USD',
    });
  };

  const inputStyle = {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  };

  const labelStyle = {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    marginBottom: 6,
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.75)' }}
          onPress={handleClose}
        >
          <Pressable onPress={() => {}} style={{ width: '100%' }}>
            <Animated.View
              entering={FadeInDown.duration(280)}
              style={{
                backgroundColor: '#111113',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 24,
                paddingBottom: 40,
              }}
            >
              {/* Handle bar */}
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

              {/* Modal header */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 22,
                }}
              >
                <View>
                  <Text style={{ color: '#f3f4f6', fontSize: 20, fontWeight: '700' }}>
                    New Recurring
                  </Text>
                  <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>
                    Auto-runs on a schedule
                  </Text>
                </View>
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

              {/* Error */}
              {error ? (
                <View
                  style={{
                    backgroundColor: '#7f1d1d30',
                    borderWidth: 1,
                    borderColor: '#ef444440',
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 14,
                  }}
                >
                  <Text style={{ color: '#fca5a5', fontSize: 13 }}>{error}</Text>
                </View>
              ) : null}

              {/* Type toggle: Expense / Income */}
              <Text style={labelStyle}>TYPE</Text>
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: '#1f2937',
                  borderRadius: 12,
                  padding: 4,
                  marginBottom: 14,
                }}
              >
                {(['Expense', 'Income'] as TxType[]).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setTxType(t);
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor:
                        txType === t
                          ? t === 'Expense'
                            ? '#ef4444'
                            : '#22c55e'
                          : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        color: txType === t ? 'white' : '#9ca3af',
                        fontWeight: '700',
                        fontSize: 14,
                      }}
                    >
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Name */}
              <Text style={labelStyle}>NAME</Text>
              <View style={inputStyle}>
                <Tag size={16} color="#6b7280" />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Netflix, Salary, Gym…"
                  placeholderTextColor="#4b5563"
                  style={{ flex: 1, color: '#f3f4f6', fontSize: 15, marginLeft: 10 }}
                />
              </View>

              {/* Amount */}
              <Text style={labelStyle}>AMOUNT</Text>
              <View style={inputStyle}>
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

              {/* Category */}
              <Text style={labelStyle}>CATEGORY</Text>
              <Pressable
                onPress={() => {
                  setShowFrequencyPicker(false);
                  setShowCategoryPicker((p) => !p);
                }}
                style={{
                  ...inputStyle,
                  marginBottom: showCategoryPicker ? 0 : 14,
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
                    backgroundColor: '#1a1a1e',
                    borderRadius: 12,
                    marginBottom: 14,
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
                        backgroundColor: category === cat.label ? '#22c55e15' : 'transparent',
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderColor: '#27272a',
                      }}
                    >
                      <Text style={{ fontSize: 18, marginRight: 12 }}>{cat.emoji}</Text>
                      <Text
                        style={{
                          color: category === cat.label ? '#22c55e' : '#d1d5db',
                          fontSize: 15,
                          fontWeight: category === cat.label ? '600' : '400',
                        }}
                      >
                        {cat.label}
                      </Text>
                      {category === cat.label && (
                        <Check size={16} color="#22c55e" style={{ marginLeft: 'auto' }} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Frequency */}
              <Text style={labelStyle}>FREQUENCY</Text>
              <Pressable
                onPress={() => {
                  setShowCategoryPicker(false);
                  setShowFrequencyPicker((p) => !p);
                }}
                style={{
                  ...inputStyle,
                  marginBottom: showFrequencyPicker ? 0 : 22,
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Repeat size={16} color="#6b7280" style={{ marginRight: 10 }} />
                  <Text style={{ color: '#f3f4f6', fontSize: 15 }}>
                    {getFrequencyLabel(frequency)}
                  </Text>
                </View>
                <ChevronDown
                  size={18}
                  color="#6b7280"
                  style={{ transform: [{ rotate: showFrequencyPicker ? '180deg' : '0deg' }] }}
                />
              </Pressable>

              {showFrequencyPicker && (
                <View
                  style={{
                    backgroundColor: '#1a1a1e',
                    borderRadius: 12,
                    marginBottom: 22,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: '#27272a',
                  }}
                >
                  {FREQUENCIES.map((freq, idx) => (
                    <Pressable
                      key={freq.value}
                      onPress={() => {
                        setFrequency(freq.value);
                        setShowFrequencyPicker(false);
                        Haptics.selectionAsync();
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 12,
                        paddingHorizontal: 14,
                        backgroundColor: frequency === freq.value ? '#22c55e15' : 'transparent',
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderColor: '#27272a',
                      }}
                    >
                      <Text
                        style={{
                          color: frequency === freq.value ? '#22c55e' : '#d1d5db',
                          fontSize: 15,
                          fontWeight: frequency === freq.value ? '600' : '400',
                          flex: 1,
                        }}
                      >
                        {freq.label}
                      </Text>
                      {frequency === freq.value && (
                        <Check size={16} color="#22c55e" />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

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
                  colors={isLoading ? ['#4b5563', '#374151'] : ['#16a34a', '#22c55e']}
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
                        Create Recurring
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RecurringScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: items = [],
    isLoading,
    isError,
  } = useQuery<RecurringTransaction[]>({
    queryKey: ['recurring'],
    queryFn: () => api.get<RecurringTransaction[]>('/api/recurring'),
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: CreateRecurringBody) =>
      api.post<RecurringTransaction>('/api/recurring', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setShowAddModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (item: RecurringTransaction) =>
      api.put<RecurringTransaction>(`/api/recurring/${item.id}`, {
        ...item,
        isActive: !item.isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/recurring/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async (item: RecurringTransaction) => {
      // 1. Post as a real transaction
      const today = todayISO();
      const txBody: CreateTransactionBody = {
        name: item.name,
        amount: item.amount,
        category: item.category,
        type: item.type,
        isImpulse: false,
        note: `Recurring: ${getFrequencyLabel(item.frequency)}`,
        dateISO: today,
        currency: item.currency ?? 'USD',
      };
      await api.post('/api/transactions', txBody);

      // 2. Update nextDate on the recurring item
      await api.put(`/api/recurring/${item.id}`, {
        ...item,
        nextDate: today,
      });
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

  // ── Derived data ─────────────────────────────────────────────────────────

  const activeItems = items.filter((i) => i.isActive);
  const inactiveItems = items.filter((i) => !i.isActive);
  const totalMonthlyExpense = monthlyEquivalent(items);
  const totalMonthlyIncome = monthlyIncomeEquivalent(items);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#0d0d0f' }}>
      {/* ── Gradient Header ── */}
      <LinearGradient
        colors={['#052e16', '#14532d', '#16a34a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 36,
          paddingHorizontal: 16,
        }}
      >
        {/* Nav row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 22,
          }}
        >
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
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>
              Recurring
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>
              {activeItems.length} active · {items.length} total
            </Text>
          </View>

          <View style={{ width: 40 }} />
        </View>

        {/* Stats cards */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {/* Monthly expense */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.25)',
              borderRadius: 16,
              padding: 14,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <RefreshCw size={12} color="rgba(255,255,255,0.6)" />
              <Text
                style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 10,
                  fontWeight: '700',
                  marginLeft: 5,
                  letterSpacing: 0.6,
                }}
              >
                MONTHLY SPEND
              </Text>
            </View>
            <Text style={{ color: '#fca5a5', fontSize: 22, fontWeight: '800' }}>
              {formatAmount(totalMonthlyExpense)}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 }}>
              active expenses
            </Text>
          </View>

          {/* Monthly income */}
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.25)',
              borderRadius: 16,
              padding: 14,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <RefreshCw size={12} color="rgba(255,255,255,0.6)" />
              <Text
                style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 10,
                  fontWeight: '700',
                  marginLeft: 5,
                  letterSpacing: 0.6,
                }}
              >
                MONTHLY INCOME
              </Text>
            </View>
            <Text style={{ color: '#86efac', fontSize: 22, fontWeight: '800' }}>
              {formatAmount(totalMonthlyIncome)}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 }}>
              active income
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <View style={{ flex: 1, marginTop: -20 }}>
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#22c55e" size="large" />
          </View>
        ) : isError ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 32,
            }}
          >
            <Text style={{ color: '#9ca3af', textAlign: 'center', fontSize: 15 }}>
              Could not load recurring transactions. Check your connection.
            </Text>
          </View>
        ) : items.length === 0 ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 32,
            }}
          >
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: '#22c55e18',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <RefreshCw size={32} color="#22c55e" />
            </View>
            <Text
              style={{
                color: '#f3f4f6',
                fontSize: 18,
                fontWeight: '700',
                marginBottom: 6,
                textAlign: 'center',
              }}
            >
              No Recurring Transactions
            </Text>
            <Text style={{ color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
              Tap the + button to add subscriptions, bills, or regular income that repeat on a schedule.
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
            {/* Active section */}
            {activeItems.length > 0 && (
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
                  ACTIVE
                </Text>
                {activeItems.map((item, idx) => (
                  <RecurringCard
                    key={item.id}
                    item={item}
                    index={idx}
                    onToggleActive={(i) => toggleActiveMutation.mutate(i)}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onRunNow={handleRunNow}
                    isRunning={runningId === item.id}
                  />
                ))}
              </>
            )}

            {/* Inactive section */}
            {inactiveItems.length > 0 && (
              <>
                <Text
                  style={{
                    color: '#6b7280',
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 1,
                    marginBottom: 10,
                    marginLeft: 2,
                    marginTop: activeItems.length > 0 ? 18 : 0,
                  }}
                >
                  PAUSED
                </Text>
                {inactiveItems.map((item, idx) => (
                  <RecurringCard
                    key={item.id}
                    item={item}
                    index={idx}
                    onToggleActive={(i) => toggleActiveMutation.mutate(i)}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onRunNow={handleRunNow}
                    isRunning={runningId === item.id}
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
            colors={['#16a34a', '#22c55e']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#22c55e',
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
      <AddRecurringModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />
    </View>
  );
}
