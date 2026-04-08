import {
  View, Text, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay,
  Easing,
} from 'react-native-reanimated';
import {
  Plane, Laptop, Coffee, Car, Building, Tag,
  SlidersHorizontal, X, AlertTriangle, TrendingUp,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBudget, setBudget, type BudgetCategory, type BudgetData } from '@/lib/budgetApi';
import { getBusiness } from '@/lib/businessApi';
import { useSession } from '@/lib/auth/use-session';
import { useFocusEffect } from 'expo-router';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: {
  key: BudgetCategory;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  color: string;
}[] = [
  { key: 'Travel',    label: 'Travel',    icon: Plane,    color: '#818cf8' },
  { key: 'Software',  label: 'Software',  icon: Laptop,   color: '#34d399' },
  { key: 'Meals',     label: 'Meals',     icon: Coffee,   color: '#fbbf24' },
  { key: 'Transport', label: 'Transport', icon: Car,       color: '#60a5fa' },
  { key: 'Office',    label: 'Office',    icon: Building, color: '#f472b6' },
  { key: 'Other',     label: 'Other',     icon: Tag,       color: '#a78bfa' },
];

function pct(spent: number, budget: number) {
  if (budget <= 0) return 0;
  return Math.min((spent / budget) * 100, 100);
}

function barColor(p: number) {
  if (p >= 100) return '#ef4444';
  if (p >= 80)  return '#f97316';
  return '#22c55e';
}

// ─── Animated Progress Bar ────────────────────────────────────────────────────

function ProgressBar({
  pct: targetPct, color, delay = 0,
}: {
  pct: number;
  color: string;
  delay?: number;
}) {
  const width = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      width.value = withDelay(delay, withTiming(targetPct, { duration: 700, easing: Easing.out(Easing.cubic) }));
    }, [targetPct, delay, width])
  );

  const barStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
  }));

  return (
    <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', borderRadius: 4, backgroundColor: color }, barStyle]} />
    </View>
  );
}

// ─── Edit Budget Modal ────────────────────────────────────────────────────────

function EditBudgetModal({
  visible, onClose, currentData,
}: {
  visible: boolean;
  onClose: () => void;
  currentData: BudgetData | null | undefined;
}) {
  const qc = useQueryClient();
  const [total,   setTotal]   = useState('');
  const [catVals, setCatVals] = useState<Partial<Record<BudgetCategory, string>>>({});

  // Populate form when modal opens
  const handleOpen = useCallback(() => {
    setTotal(currentData?.budget.totalMonthly ? String(currentData.budget.totalMonthly) : '');
    const init: Partial<Record<BudgetCategory, string>> = {};
    ALL_CATEGORIES.forEach(c => {
      const v = currentData?.budget.categories[c.key];
      init[c.key] = v ? String(v) : '';
    });
    setCatVals(init);
  }, [currentData]);

  const saveMut = useMutation({
    mutationFn: () => {
      const totalNum = parseFloat(total);
      if (isNaN(totalNum) || totalNum < 0) throw new Error('Enter a valid total budget');
      const cats: Partial<Record<BudgetCategory, number>> = {};
      ALL_CATEGORIES.forEach(c => {
        const v = parseFloat(catVals[c.key] ?? '');
        if (!isNaN(v) && v > 0) cats[c.key] = v;
      });
      return setBudget({ totalMonthly: totalNum, categories: cats });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['biz-budget'] });
      onClose();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', e.message);
    },
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onShow={handleOpen}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{
          backgroundColor: '#0d1828',
          borderTopLeftRadius: 32, borderTopRightRadius: 32,
          borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)',
          paddingBottom: 48, maxHeight: '90%',
        }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24 }}
          >
            {/* Handle */}
            <View style={{ width: 40, height: 4, backgroundColor: '#1e3a5f', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>Set Monthly Budget</Text>
              <Pressable onPress={onClose} hitSlop={10}><X size={22} color="#4b5563" /></Pressable>
            </View>

            {/* Total */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>TOTAL MONTHLY BUDGET</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', marginBottom: 24 }}>
              <Text style={{ color: '#60a5fa', fontSize: 20, fontWeight: '700', marginRight: 8 }}>$</Text>
              <TextInput
                value={total}
                onChangeText={setTotal}
                placeholder="0"
                placeholderTextColor="#1f3a5f"
                keyboardType="decimal-pad"
                style={{ flex: 1, color: '#fff', fontSize: 24, fontWeight: '700' }}
                selectionColor="#60a5fa"
              />
            </View>

            {/* Category budgets */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 }}>CATEGORY BUDGETS (OPTIONAL)</Text>
            {ALL_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              return (
                <View key={cat.key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: `${cat.color}18`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Icon size={16} color={cat.color} />
                  </View>
                  <Text style={{ flex: 1, color: '#d1d5db', fontSize: 14, fontWeight: '500' }}>{cat.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', minWidth: 90 }}>
                    <Text style={{ color: '#4b5563', fontSize: 14, marginRight: 4 }}>$</Text>
                    <TextInput
                      value={catVals[cat.key] ?? ''}
                      onChangeText={v => setCatVals(prev => ({ ...prev, [cat.key]: v }))}
                      placeholder="—"
                      placeholderTextColor="#1f2937"
                      keyboardType="decimal-pad"
                      style={{ color: '#fff', fontSize: 15, fontWeight: '600', minWidth: 55 }}
                      selectionColor={cat.color}
                    />
                  </View>
                </View>
              );
            })}

            {/* Save */}
            <Pressable
              onPress={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 12 })}
            >
              <LinearGradient
                colors={saveMut.isPending ? ['#1e3a5f', '#1e3a5f'] : ['#1d4ed8', '#3b82f6']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ borderRadius: 18, paddingVertical: 18, alignItems: 'center' }}
              >
                {saveMut.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Save Budget</Text>
                }
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Category Budget Row ──────────────────────────────────────────────────────

function CategoryRow({
  cat, spent, budget, index,
}: {
  cat: typeof ALL_CATEGORIES[number];
  spent: number;
  budget: number;
  index: number;
}) {
  const Icon = cat.icon;
  const p = pct(spent, budget);
  const color = barColor(p);
  const overBudget = budget > 0 && spent > budget;
  const warning    = budget > 0 && p >= 80 && !overBudget;

  return (
    <View style={{
      backgroundColor: overBudget ? 'rgba(239,68,68,0.06)' : warning ? 'rgba(249,115,22,0.05)' : 'rgba(255,255,255,0.04)',
      borderRadius: 18, padding: 16, marginBottom: 10,
      borderWidth: 1,
      borderColor: overBudget ? 'rgba(239,68,68,0.2)' : warning ? 'rgba(249,115,22,0.18)' : 'rgba(255,255,255,0.06)',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: `${cat.color}18`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Icon size={18} color={cat.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600' }}>{cat.label}</Text>
          {budget > 0 ? (
            <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 1 }}>
              ${spent.toFixed(0)} of ${budget.toFixed(0)} · {p.toFixed(0)}%
            </Text>
          ) : (
            <Text style={{ color: '#1f3a5f', fontSize: 11, marginTop: 1 }}>
              ${spent.toFixed(0)} spent · no limit set
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={{ color: overBudget ? '#ef4444' : '#fff', fontWeight: '700', fontSize: 15 }}>
            ${spent.toFixed(0)}
          </Text>
          {(overBudget || warning) && (
            <AlertTriangle size={13} color={overBudget ? '#ef4444' : '#f97316'} />
          )}
        </View>
      </View>

      {budget > 0 && (
        <ProgressBar pct={p} color={color} delay={index * 80} />
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BudgetScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [showEdit, setShowEdit] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['biz-budget'],
    queryFn: getBudget,
  });

  const { data: business } = useQuery({
    queryKey: ['my-business'],
    queryFn: getBusiness,
  });

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['biz-budget'] });
    }, [qc])
  );

  const myRole = business?.teamMembers.find(m => m.userId === session?.user?.id)?.role;
  const canEdit = myRole === 'owner' || myRole === 'manager';

  const totalBudget  = data?.budget.totalMonthly ?? 0;
  const totalSpent   = data?.spending.total ?? 0;
  const totalPct     = pct(totalSpent, totalBudget);
  const totalColor   = barColor(totalPct);
  const overallWarn  = totalBudget > 0 && totalPct >= 80;
  const overBudget   = totalBudget > 0 && totalSpent > totalBudget;
  const remaining    = Math.max(totalBudget - totalSpent, 0);

  // Build per-category rows — include all cats with spending OR budget set
  const catRows = ALL_CATEGORIES.map(cat => ({
    cat,
    spent:  data?.spending.byCategory[cat.key]?.spent  ?? 0,
    budget: data?.budget.categories[cat.key]           ?? 0,
  })).filter(r => r.spent > 0 || r.budget > 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#060d18', paddingTop: insets.top }}>
      <EditBudgetModal
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        currentData={data}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 36 }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
          <View>
            <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>BUSINESS</Text>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 }}>Budget</Text>
          </View>
          {canEdit && (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowEdit(true); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.3)' })}
            >
              <SlidersHorizontal size={15} color="#60a5fa" />
              <Text style={{ color: '#60a5fa', fontWeight: '700', fontSize: 13 }}>Edit</Text>
            </Pressable>
          )}
        </View>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <ActivityIndicator color="#60a5fa" size="large" />
          </View>
        ) : (
          <>
            {/* Month label */}
            <Text style={{ color: '#1f3a5f', fontSize: 12, fontWeight: '600', textAlign: 'center', marginBottom: 16 }}>
              {data?.month.label ?? ''}
            </Text>

            {/* Total budget card */}
            <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
              <LinearGradient
                colors={overBudget ? ['#1e0606', '#2d0808'] : overallWarn ? ['#1a0d00', '#2d1800'] : ['#061820', '#0a2438']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 24, padding: 22, borderWidth: 1, borderColor: overBudget ? 'rgba(239,68,68,0.3)' : overallWarn ? 'rgba(249,115,22,0.3)' : 'rgba(96,165,250,0.2)' }}
              >
                {/* Warning banner */}
                {(overBudget || overallWarn) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: overBudget ? 'rgba(239,68,68,0.12)' : 'rgba(249,115,22,0.12)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14, borderWidth: 1, borderColor: overBudget ? 'rgba(239,68,68,0.25)' : 'rgba(249,115,22,0.25)' }}>
                    <AlertTriangle size={14} color={overBudget ? '#ef4444' : '#f97316'} />
                    <Text style={{ color: overBudget ? '#ef4444' : '#f97316', fontSize: 12, fontWeight: '700' }}>
                      {overBudget ? `Over budget by $${(totalSpent - totalBudget).toFixed(2)}` : `${totalPct.toFixed(0)}% of budget used — watch spending`}
                    </Text>
                  </View>
                )}

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
                  <View>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 4 }}>MONTHLY SPEND</Text>
                    <Text style={{ color: overBudget ? '#ef4444' : '#fff', fontSize: 38, fontWeight: '800', lineHeight: 42 }}>
                      ${totalSpent.toFixed(0)}
                    </Text>
                    {totalBudget > 0 && (
                      <Text style={{ color: '#4b5563', fontSize: 13, marginTop: 2 }}>
                        of ${totalBudget.toFixed(0)} budget
                      </Text>
                    )}
                  </View>
                  {totalBudget > 0 && (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: totalColor, fontSize: 28, fontWeight: '800' }}>{totalPct.toFixed(0)}%</Text>
                      {!overBudget && (
                        <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '600' }}>${remaining.toFixed(0)} left</Text>
                      )}
                    </View>
                  )}
                </View>

                {totalBudget > 0 && (
                  <ProgressBar pct={totalPct} color={totalColor} delay={0} />
                )}

                {totalBudget === 0 && canEdit && (
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowEdit(true); }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: 'rgba(96,165,250,0.1)', borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' })}
                  >
                    <TrendingUp size={14} color="#60a5fa" />
                    <Text style={{ color: '#60a5fa', fontWeight: '700', fontSize: 13 }}>Set a monthly budget</Text>
                  </Pressable>
                )}
              </LinearGradient>
            </View>

            {/* Stats row */}
            {totalBudget > 0 && (
              <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'Budget',    value: `$${totalBudget.toFixed(0)}`,  accent: '#60a5fa' },
                  { label: 'Spent',     value: `$${totalSpent.toFixed(0)}`,   accent: overBudget ? '#ef4444' : '#f87171' },
                  { label: 'Remaining', value: `$${remaining.toFixed(0)}`,    accent: '#22c55e' },
                ].map(s => (
                  <View key={s.label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                    <Text style={{ color: s.accent, fontSize: 17, fontWeight: '800', marginBottom: 2 }}>{s.value}</Text>
                    <Text style={{ color: '#374151', fontSize: 11, fontWeight: '600' }}>{s.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Category breakdown */}
            {catRows.length > 0 && (
              <View style={{ paddingHorizontal: 20 }}>
                <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
                  BY CATEGORY
                </Text>
                {catRows.map((r, i) => (
                  <CategoryRow key={r.cat.key} cat={r.cat} spent={r.spent} budget={r.budget} index={i} />
                ))}
              </View>
            )}

            {/* Empty state */}
            {catRows.length === 0 && (
              <View style={{ marginHorizontal: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                <TrendingUp size={32} color="#1f3a5f" />
                <Text style={{ color: '#374151', fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 }}>No spending this month</Text>
                <Text style={{ color: '#1f2937', fontSize: 12, textAlign: 'center' }}>Submit expenses to see your budget usage here</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
