import {
  View, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing,
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
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, BizBackground, BubbleButton } from '@/components/ui';
import { t } from '@/lib/i18n/core';

const ALL_CATEGORIES: { key: BudgetCategory; label: string; icon: React.ComponentType<{ size: number; color: string }>; color: string }[] = [
  { key: 'Travel', label: 'Travel', icon: Plane, color: '#818cf8' },
  { key: 'Software', label: 'Software', icon: Laptop, color: '#14b8a6' },
  { key: 'Meals', label: 'Meals', icon: Coffee, color: '#f59e0b' },
  { key: 'Transport', label: 'Transport', icon: Car, color: '#3b82f6' },
  { key: 'Office', label: 'Office', icon: Building, color: '#f472b6' },
  { key: 'Other', label: 'Other', icon: Tag, color: '#a78bfa' },
];

function pct(spent: number, budget: number) { if (budget <= 0) return 0; return Math.min((spent / budget) * 100, 100); }
function barColor(p: number) { if (p >= 100) return '#ef4444'; if (p >= 80) return '#f59e0b'; return '#14b8a6'; }

function ProgressBar({ pct: targetPct, color, delay = 0 }: { pct: number; color: string; delay?: number }) {
  const B = useB();
  const width = useSharedValue(0);
  useFocusEffect(useCallback(() => {
    width.value = withDelay(delay, withTiming(targetPct, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [targetPct, delay, width]));
  const barStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View style={{ height: 7, backgroundColor: B.glassStrong, borderRadius: 4, overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', borderRadius: 4, backgroundColor: color }, barStyle]} />
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  const B = useB();
  return <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>{children}</Txt>;
}

function EditBudgetModal({ visible, onClose, currentData }: { visible: boolean; onClose: () => void; currentData: BudgetData | null | undefined }) {
  const B = useB();
  const qc = useQueryClient();
  const [total, setTotal] = useState('');
  const [catVals, setCatVals] = useState<Partial<Record<BudgetCategory, string>>>({});

  const handleOpen = useCallback(() => {
    setTotal(currentData?.budget.totalMonthly ? String(currentData.budget.totalMonthly) : '');
    const init: Partial<Record<BudgetCategory, string>> = {};
    ALL_CATEGORIES.forEach(c => { const v = currentData?.budget.categories[c.key]; init[c.key] = v ? String(v) : ''; });
    setCatVals(init);
  }, [currentData]);

  const saveMut = useMutation({
    mutationFn: () => {
      const totalNum = parseFloat(total);
      if (isNaN(totalNum) || totalNum < 0) throw new Error('Enter a valid total budget');
      const cats: Partial<Record<BudgetCategory, number>> = {};
      ALL_CATEGORIES.forEach(c => { const v = parseFloat(catVals[c.key] ?? ''); if (!isNaN(v) && v > 0) cats[c.key] = v; });
      return setBudget({ totalMonthly: totalNum, categories: cats });
    },
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); qc.invalidateQueries({ queryKey: ['biz-budget'] }); onClose(); },
    onError: (e: Error) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); Alert.alert(t('common.error'), e.message); },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onShow={handleOpen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ backgroundColor: B.slate900, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: `${B.accent}26`, paddingBottom: 44, maxHeight: '90%' }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22 }}>
            <View style={{ width: 40, height: 4, backgroundColor: B.slate700, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <Txt weight="bold" size={20} color={B.text}>{t('businessInsights.setBudget')}</Txt>
              <Pressable onPress={onClose} hitSlop={10}><X size={22} color={B.textFaint} /></Pressable>
            </View>

            <FieldLabel>{t('businessInsights.totalBudget')}</FieldLabel>
            <GlassCard padding={0} radius={R.md} border={`${B.accent}33`} style={{ marginBottom: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <Txt weight="bold" size={20} color={B.accent} style={{ marginRight: 8 }}>$</Txt>
                <TextInput value={total} onChangeText={setTotal} placeholder="0" placeholderTextColor={B.textFaint} keyboardType="decimal-pad" style={{ flex: 1, color: B.text, fontSize: 24, fontFamily: 'PlusJakartaSans_700Bold', padding: 0 }} selectionColor={B.accent} />
              </View>
            </GlassCard>

            <FieldLabel>{t('businessInsights.categoryBudgets')}</FieldLabel>
            <View style={{ gap: 8 }}>
              {ALL_CATEGORIES.map(cat => {
                const Icon = cat.icon;
                return (
                  <GlassCard key={cat.key} padding={0} radius={R.sm}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 }}>
                      <IconBubble color={cat.color} size={34} radius={10} style={{ marginRight: 12 }}><Icon size={16} color={cat.color} /></IconBubble>
                      <Txt size={14} color={B.textDim} style={{ flex: 1 }}>{cat.label}</Txt>
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: B.glass, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: B.glassBorder, minWidth: 90 }}>
                        <Txt size={14} color={B.textFaint} style={{ marginRight: 4 }}>$</Txt>
                        <TextInput value={catVals[cat.key] ?? ''} onChangeText={v => setCatVals(prev => ({ ...prev, [cat.key]: v }))} placeholder="—" placeholderTextColor={B.textFaint} keyboardType="decimal-pad" style={{ color: B.text, fontSize: 15, fontFamily: 'PlusJakartaSans_600SemiBold', minWidth: 55, padding: 0 }} selectionColor={cat.color} />
                      </View>
                    </View>
                  </GlassCard>
                );
              })}
            </View>

            <View style={{ marginTop: 16 }}>
              <BubbleButton label={saveMut.isPending ? t('businessInsights.savingBudget') : t('businessInsights.saveBudgetButton')} onPress={() => saveMut.mutate()} disabled={saveMut.isPending} radius={R.md} colors={[B.accentDeep, B.accent]} glowColor={B.accent} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CategoryRow({ cat, spent, budget, index }: { cat: typeof ALL_CATEGORIES[number]; spent: number; budget: number; index: number }) {
  const B = useB();
  const Icon = cat.icon;
  const p = pct(spent, budget);
  const color = barColor(p);
  const overBudget = budget > 0 && spent > budget;
  const warning = budget > 0 && p >= 80 && !overBudget;

  return (
    <GlassCard
      padding={16}
      radius={R.md}
      tint={overBudget ? `${B.red}0e` : warning ? `${B.amber}0c` : B.glass}
      border={overBudget ? `${B.red}33` : warning ? `${B.amber}2a` : B.glassBorder}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <IconBubble color={cat.color} size={40} radius={13} style={{ marginRight: 12 }}><Icon size={18} color={cat.color} /></IconBubble>
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={14} color={B.text}>{cat.label}</Txt>
          {budget > 0 ? (
            <Txt size={11} color={B.textFaint} style={{ marginTop: 1 }}>${spent.toFixed(0)} of ${budget.toFixed(0)} · {p.toFixed(0)}%</Txt>
          ) : (
            <Txt size={11} color={B.textFaint} style={{ marginTop: 1 }}>{t('businessInsights.spentNoLimit', { amount: `$${spent.toFixed(0)}` })}</Txt>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt weight="bold" size={15} color={overBudget ? B.red : B.text}>${spent.toFixed(0)}</Txt>
          {(overBudget || warning) && <AlertTriangle size={13} color={overBudget ? B.red : B.amber} />}
        </View>
      </View>
      {budget > 0 && <ProgressBar pct={p} color={color} delay={index * 80} />}
    </GlassCard>
  );
}

export default function BudgetScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [showEdit, setShowEdit] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['biz-budget'], queryFn: getBudget });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['biz-budget'] }); }, [qc]));

  const myRole = business?.teamMembers.find(m => m.userId === session?.user?.id)?.role;
  const canEdit = myRole === 'owner' || myRole === 'manager';

  const totalBudget = data?.budget.totalMonthly ?? 0;
  const totalSpent = data?.spending.total ?? 0;
  const totalPct = pct(totalSpent, totalBudget);
  const totalColor = barColor(totalPct);
  const overallWarn = totalBudget > 0 && totalPct >= 80;
  const overBudget = totalBudget > 0 && totalSpent > totalBudget;
  const remaining = Math.max(totalBudget - totalSpent, 0);

  const catRows = ALL_CATEGORIES.map(cat => ({
    cat,
    spent: data?.spending.byCategory[cat.key]?.spent ?? 0,
    budget: data?.budget.categories[cat.key] ?? 0,
  })).filter(r => r.spent > 0 || r.budget > 0);

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <EditBudgetModal visible={showEdit} onClose={() => setShowEdit(false)} currentData={data} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
          <View>
            <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>{t('business.label')}</Txt>
            <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>{t('businessInsights.budget')}</Txt>
          </View>
          {canEdit && (
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowEdit(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: `${B.accent}22`, borderWidth: 1.5, borderColor: `${B.accent}44` })}>
              <SlidersHorizontal size={15} color={B.accent} />
              <Txt weight="bold" size={13} color={B.accent}>{t('businessInsights.edit')}</Txt>
            </Pressable>
          )}
        </View>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}><ActivityIndicator color={B.accent} size="large" /></View>
        ) : (
          <>
            <Txt size={12} color={B.textFaint} style={{ textAlign: 'center', marginBottom: 16 }}>{data?.month.label ?? ''}</Txt>

            {/* Total budget card */}
            <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
              <LinearGradient
                colors={overBudget ? ['#220a0a', '#170808'] : overallWarn ? ['#221606', '#171005'] : [B.heroFrom, '#102a4a']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[{ borderRadius: R.lg, padding: 22, borderWidth: 1, borderColor: overBudget ? `${B.red}44` : overallWarn ? `${B.amber}44` : `${B.accent}2a` }, glow(overBudget ? B.red : B.accentDeep, 0.25, 20, B.glowScale)]}
              >
                {(overBudget || overallWarn) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: overBudget ? `${B.red}1a` : `${B.amber}1a`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 14, borderWidth: 1, borderColor: overBudget ? `${B.red}33` : `${B.amber}33` }}>
                    <AlertTriangle size={14} color={overBudget ? B.red : B.amber} />
                    <Txt weight="bold" size={12} color={overBudget ? B.red : B.amber}>
                      {overBudget ? t('businessInsights.overBudgetBy', { amount: `$${(totalSpent - totalBudget).toFixed(2)}` }) : t('businessInsights.pctUsed', { pct: totalPct.toFixed(0) })}
                    </Txt>
                  </View>
                )}

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
                  <View>
                    <Txt weight="semibold" size={12} color="rgba(255,255,255,0.45)" style={{ letterSpacing: 1, marginBottom: 4 }}>{t('businessInsights.monthlySpend')}</Txt>
                    <Txt weight="bold" size={38} color={overBudget ? B.red : '#fff'} style={{ lineHeight: 42 }}>${totalSpent.toFixed(0)}</Txt>
                    {totalBudget > 0 && <Txt size={13} color={B.textFaint} style={{ marginTop: 2 }}>of ${totalBudget.toFixed(0)} budget</Txt>}
                  </View>
                  {totalBudget > 0 && (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt weight="bold" size={28} color={totalColor}>{totalPct.toFixed(0)}%</Txt>
                      {!overBudget && <Txt weight="semibold" size={12} color={B.teal}>${remaining.toFixed(0)} left</Txt>}
                    </View>
                  )}
                </View>

                {totalBudget > 0 && <ProgressBar pct={totalPct} color={totalColor} delay={0} />}

                {totalBudget === 0 && canEdit && (
                  <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowEdit(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: `${B.accent}16`, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: `${B.accent}2a` })}>
                    <TrendingUp size={14} color={B.accent} />
                    <Txt weight="bold" size={13} color={B.accent}>{t('businessInsights.setBudgetShort')}</Txt>
                  </Pressable>
                )}
              </LinearGradient>
            </View>

            {/* Stats row */}
            {totalBudget > 0 && (
              <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 20 }}>
                {[
                  { label: t('businessInsights.budgetLabel'), value: `$${totalBudget.toFixed(0)}`, accent: B.accent },
                  { label: t('bizStats.spent'), value: `$${totalSpent.toFixed(0)}`, accent: overBudget ? B.red : '#f87171' },
                  { label: t('bizStats.remaining'), value: `$${remaining.toFixed(0)}`, accent: B.teal },
                ].map(s => (
                  <GlassCard key={s.label} style={{ flex: 1, alignItems: 'center' }} padding={14} radius={R.md}>
                    <Txt weight="bold" size={17} color={s.accent} style={{ marginBottom: 2 }}>{s.value}</Txt>
                    <Txt weight="semibold" size={11} color={B.textFaint}>{s.label}</Txt>
                  </GlassCard>
                ))}
              </View>
            )}

            {/* By category */}
            {catRows.length > 0 && (
              <View style={{ paddingHorizontal: 20 }}>
                <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.4, marginBottom: 12 }}>{t('businessInsights.byCategory')}</Txt>
                <View style={{ gap: 10 }}>
                  {catRows.map((r, i) => <CategoryRow key={r.cat.key} cat={r.cat} spent={r.spent} budget={r.budget} index={i} />)}
                </View>
              </View>
            )}

            {catRows.length === 0 && (
              <View style={{ marginHorizontal: 20 }}>
                <GlassCard padding={40} radius={R.lg} style={{ alignItems: 'center' }}>
                  <TrendingUp size={32} color={B.slate700} />
                  <Txt weight="semibold" size={14} color={B.textDim} style={{ marginTop: 12, marginBottom: 4 }}>{t('businessInsights.noSpending')}</Txt>
                  <Txt size={12} color={B.textFaint} style={{ textAlign: 'center' }}>{t('businessInsights.noSpendingHint')}</Txt>
                </GlassCard>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </BizBackground>
  );
}
