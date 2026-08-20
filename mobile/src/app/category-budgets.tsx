import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  Trash2,
  DollarSign,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getTransactions } from '@/lib/db';
import { api } from '@/lib/api/api';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/categories';

// --- Types ---

interface CategoryBudget {
  id: string;
  category: string;
  amount: number;
  period: string;
}

interface CategoryConfig {
  name: string;
  emoji: string;
  color: string;
  bg: string;
  barColor: string;
}

// --- Category configuration ---

const CATEGORIES: CategoryConfig[] = [
  { name: 'Food', emoji: '🍔', color: '#f97316', bg: 'rgba(249,115,22,0.15)', barColor: '#f97316' },
  { name: 'Gym', emoji: '💪', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', barColor: '#a855f7' },
  { name: 'Transport', emoji: '🚗', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', barColor: '#3b82f6' },
  { name: 'Shopping', emoji: '🛍️', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', barColor: '#ec4899' },
  { name: 'Subscriptions', emoji: '📱', color: '#22c55e', bg: 'rgba(34,197,94,0.15)', barColor: '#22c55e' },
  { name: 'Other', emoji: '📦', color: '#6b7280', bg: 'rgba(107,114,128,0.15)', barColor: '#6b7280' },
];

// --- API helpers ---

async function fetchCategoryBudgets(): Promise<CategoryBudget[]> {
  try {
    const result = await api.get<CategoryBudget[]>('/api/category-budgets');
    return result ?? [];
  } catch {
    return [];
  }
}

async function saveCategoryBudget(category: string, amount: number): Promise<void> {
  await api.post('/api/category-budgets', { category, amount, period: 'monthly' });
}

async function removeCategoryBudget(id: string): Promise<void> {
  await api.delete(`/api/category-budgets/${id}`);
}

// --- Get current month spending per category from local SQLite ---

function getCurrentMonthSpending(
  transactions: { category: string; type: string; amount: number; dateISO: string }[]
): Record<string, number> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const spending: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.type === 'Expense' && tx.dateISO.startsWith(yearMonth)) {
      spending[tx.category] = (spending[tx.category] ?? 0) + tx.amount;
    }
  }
  return spending;
}

// --- Progress bar component ---

function ProgressBar({
  progress,
  color,
  overBudget,
}: {
  progress: number;
  color: string;
  overBudget: boolean;
}) {
  const clamped = Math.min(progress, 1);
  const barColor = overBudget ? '#ef4444' : color;

  return (
    <View
      style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}
    >
      <View
        style={{
          height: '100%',
          width: `${Math.round(clamped * 100)}%`,
          borderRadius: 3,
          backgroundColor: barColor,
        }}
      />
    </View>
  );
}

// --- Edit modal ---

interface EditModalProps {
  visible: boolean;
  category: CategoryConfig | null;
  currentAmount: string;
  onChangeAmount: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}

function EditModal({
  visible,
  category,
  currentAmount,
  onChangeAmount,
  onSave,
  onCancel,
  isSaving,
}: EditModalProps) {
  if (!category) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 }}
          onPress={onCancel}
        >
          <Pressable onPress={() => {}} style={{ borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ backgroundColor: '#1a1a2e', borderRadius: 20, padding: 24 }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                    backgroundColor: category.bg,
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{category.emoji}</Text>
                </View>
                <View>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
                    {t('categoryBudgets.titleFor', {
                      category: categoryLabel(category.name),
                    })}
                  </Text>
                  <Text style={{ color: '#9ca3af', fontSize: 13, marginTop: 2 }}>
                    {t('categoryBudgets.monthlyLimit')}
                  </Text>
                </View>
              </View>

              {/* Input */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderRadius: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 20,
                  borderWidth: 1,
                  borderColor: category.color + '44',
                }}
              >
                <DollarSign size={20} color={category.color} style={{ marginRight: 8 }} />
                <TextInput
                  value={currentAmount}
                  onChangeText={onChangeAmount}
                  placeholder="Enter amount"
                  placeholderTextColor="#555"
                  keyboardType="decimal-pad"
                  autoFocus
                  selectionColor={category.color}
                  style={{
                    flex: 1,
                    color: '#fff',
                    fontSize: 24,
                    fontWeight: '700',
                  }}
                />
              </View>

              {/* Actions */}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  onPress={onCancel}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: 'center',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                  }}
                >
                  <Text style={{ color: '#9ca3af', fontWeight: '600', fontSize: 15 }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={onSave}
                  disabled={isSaving || !currentAmount}
                  style={{ flex: 2, borderRadius: 12, overflow: 'hidden' }}
                >
                  <LinearGradient
                    colors={isSaving ? ['#374151', '#374151'] : ['#7c3aed', '#a855f7']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{
                      paddingVertical: 14,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                    }}
                  >
                    <Check size={16} color="white" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                      {isSaving ? 'Saving...' : 'Set Budget'}
                    </Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Main screen ---

export default function CategoryBudgetsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [editingCategory, setEditingCategory] = useState<CategoryConfig | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');

  // Refetch on focus
  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);
    }, [])
  );

  const { data: budgets = [] } = useQuery<CategoryBudget[]>({
    queryKey: ['category-budgets', refreshKey],
    queryFn: fetchCategoryBudgets,
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', refreshKey],
    queryFn: getTransactions,
  });

  const spending = getCurrentMonthSpending(transactions);

  const saveMutation = useMutation({
    mutationFn: async ({ category, amount }: { category: string; amount: number }) => {
      await saveCategoryBudget(category, amount);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['category-budgets'] });
      setRefreshKey((k) => k + 1);
      setEditingCategory(null);
      setEditAmount('');
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await removeCategoryBudget(id);
    },
    onSuccess: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      queryClient.invalidateQueries({ queryKey: ['category-budgets'] });
      setRefreshKey((k) => k + 1);
    },
  });

  function getBudgetForCategory(category: string): CategoryBudget | undefined {
    return budgets.find((b) => b.category === category);
  }

  function openEdit(cat: CategoryConfig) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const existing = getBudgetForCategory(cat.name);
    setEditAmount(existing ? existing.amount.toString() : '');
    setEditingCategory(cat);
  }

  function handleSave() {
    if (!editingCategory || !editAmount) return;
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) return;
    saveMutation.mutate({ category: editingCategory.name, amount });
  }

  function handleDelete(cat: CategoryConfig) {
    const budget = getBudgetForCategory(cat.name);
    if (!budget) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteMutation.mutate(budget.id);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0c0716' }}>
      {/* Header */}
      <LinearGradient
        colors={['#4c1d95', '#7c3aed', '#a855f7', '#1e1b2e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: 28,
          paddingHorizontal: 20,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
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
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <ArrowLeft size={20} color="#fff" />
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 4 }}>
          Category Budgets
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14 }}>
          Set monthly limits per category
        </Text>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 100 }}
      >
        {/* Current month label */}
        <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '600', marginBottom: 14, marginLeft: 2 }}>
          {new Date().toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}
        </Text>

        <View style={{ gap: 12 }}>
          {CATEGORIES.map((cat) => {
            const budget = getBudgetForCategory(cat.name);
            const spent = spending[cat.name] ?? 0;
            const hasLimit = budget !== undefined;
            const progress = hasLimit && budget.amount > 0 ? spent / budget.amount : 0;
            const overBudget = hasLimit && spent > budget.amount;
            const remaining = hasLimit ? budget.amount - spent : 0;

            return (
              <View
                key={cat.name}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: 20,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: overBudget ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.04)',
                }}
              >
                {/* Top row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  {/* Emoji */}
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      backgroundColor: cat.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>{cat.emoji}</Text>
                  </View>

                  {/* Name + budget */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{categoryLabel(cat.name)}</Text>
                    {hasLimit ? (
                      <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
                        ${spent.toFixed(0)} spent
                        {overBudget
                          ? ` · `
                          : ` · $${remaining.toFixed(0)} left`}
                        {overBudget && (
                          <Text style={{ color: '#ef4444' }}>
                            ${(spent - budget.amount).toFixed(0)} over
                          </Text>
                        )}
                      </Text>
                    ) : (
                      <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                        No limit set · ${spent.toFixed(0)} spent
                      </Text>
                    )}
                  </View>

                  {/* Budget amount + edit */}
                  <View style={{ alignItems: 'flex-end' }}>
                    {hasLimit ? (
                      <Text style={{ color: cat.color, fontSize: 16, fontWeight: '800' }}>
                        ${budget.amount.toFixed(0)}
                      </Text>
                    ) : (
                      <Text style={{ color: '#4b5563', fontSize: 13 }}>{t('common.noLimit')}</Text>
                    )}
                    <Pressable
                      onPress={() => openEdit(cat)}
                      style={{
                        marginTop: 4,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: 'rgba(168,85,247,0.15)',
                      }}
                    >
                      <Text style={{ color: '#a855f7', fontSize: 11, fontWeight: '600' }}>
                        {hasLimit ? 'Edit' : 'Set limit'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Progress bar */}
                {hasLimit && (
                  <View style={{ marginBottom: 10 }}>
                    <ProgressBar
                      progress={progress}
                      color={cat.barColor}
                      overBudget={overBudget}
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
                      <Text style={{ color: '#6b7280', fontSize: 10 }}>
                        {Math.round(Math.min(progress, 1) * 100)}% used
                      </Text>
                      <Text style={{ color: '#6b7280', fontSize: 10 }}>
                        ${budget.amount.toFixed(0)} limit
                      </Text>
                    </View>
                  </View>
                )}

                {/* Delete button (only if budget set) */}
                {hasLimit && (
                  <Pressable
                    onPress={() => handleDelete(cat)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      alignSelf: 'flex-start',
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 8,
                      backgroundColor: 'rgba(239,68,68,0.1)',
                    }}
                  >
                    <Trash2 size={12} color="#ef4444" style={{ marginRight: 4 }} />
                    <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '600' }}>
                      Remove limit
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        {/* Info note */}
        <View
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: 16,
            backgroundColor: 'rgba(168,85,247,0.08)',
            borderWidth: 1,
            borderColor: 'rgba(168,85,247,0.18)',
          }}
        >
          <Text style={{ color: '#c084fc', fontSize: 13, lineHeight: 20 }}>
            Budgets are monthly. Progress bars reset at the start of each month. Over-budget categories show in red.
          </Text>
        </View>
      </ScrollView>

      {/* Edit Modal */}
      <EditModal
        visible={editingCategory !== null}
        category={editingCategory}
        currentAmount={editAmount}
        onChangeAmount={setEditAmount}
        onSave={handleSave}
        onCancel={() => {
          setEditingCategory(null);
          setEditAmount('');
        }}
        isSaving={saveMutation.isPending}
      />
    </View>
  );
}
