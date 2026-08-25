import {
  View,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { getTransactions, deleteTransaction, getSettings } from '@/lib/db';
import { getCategories, categoryMeta, DEFAULT_CATEGORIES, categoryLabel } from '@/lib/categories';
import { formatCurrency, formatTimeCost, calculateTimeCost } from '@/lib/calculations';
import { Trash2, Filter, Zap, Clock, Inbox } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { R, useC } from '@/lib/design';
import { Txt, GlassCard, Pill, ScreenBackground } from '@/components/ui';
import { t } from '@/lib/i18n/core';

interface Transaction {
  id: string;
  amount: number;
  category: string;
  type: string;
  isImpulse: number;
  note?: string;
  dateISO: string;
  createdAt: string;
}


export default function TransactionsScreen() {
  const C = useC();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterImpulseOnly, setFilterImpulseOnly] = useState(false);
  const [startDate, setStartDate] = useState(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(endOfMonth(new Date()));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const queryClient = useQueryClient();
  const hasMounted = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (hasMounted.current) setRefreshKey(prev => prev + 1);
      else hasMounted.current = true;
    }, [])
  );

  const { data: transactions = [] } = useQuery({ queryKey: ['transactions', refreshKey], queryFn: getTransactions });
  const { data: settings } = useQuery({ queryKey: ['settings', refreshKey], queryFn: getSettings });
  const { data: allCategories = DEFAULT_CATEGORIES } = useQuery({ queryKey: ['categories'], queryFn: getCategories });
  const meta = (name: string) => categoryMeta(name, allCategories);

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setRefreshKey(prev => prev + 1);
    },
  });

  const handleDelete = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Delete Transaction', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const filtered = transactions.filter(tx => {
    const txDate = parseISO(`${tx.dateISO}T00:00:00`);
    const isInDateRange = txDate >= startDate && txDate <= endDate;
    const matchesCategory = !filterCategory || tx.category === filterCategory;
    const matchesImpulse = !filterImpulseOnly || tx.isImpulse;
    return isInDateRange && matchesCategory && matchesImpulse;
  });

  const grouped = filtered.reduce((acc, tx) => {
    const date = tx.dateISO;
    if (!acc[date]) acc[date] = [];
    acc[date].push(tx);
    return acc;
  }, {} as Record<string, Transaction[]>);

  const groupedArray = Object.entries(grouped)
    .map(([date, txs]) => ({
      date,
      transactions: txs,
      total: txs.reduce((sum, tx) => sum + (tx.type === 'Expense' ? -tx.amount : tx.amount), 0),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const categories = Array.from(new Set(transactions.map(tx => tx.category))).sort();

  const handleStartDateChange = (event: any, selectedDate?: Date) => { if (selectedDate) setStartDate(selectedDate); setShowStartPicker(false); };
  const handleEndDateChange = (event: any, selectedDate?: Date) => { if (selectedDate) setEndDate(selectedDate); setShowEndPicker(false); };

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* ── Header ── */}
        <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20 }}>
<Txt weight="bold" size={30} color={C.text}>History </Txt>
          <Txt weight="medium" size={13} color={C.textDim} style={{ marginTop: 2 }}>
{filtered.length > 0? `${filtered.length} records found `: 'No records yet — start tracking!'}
          </Txt>

          {/* Date range */}
          <View className="flex-row" style={{ gap: 12, marginTop: 16 }}>
            {([
              { label: 'From', val: startDate, onPress: () => setShowStartPicker(true) },
              { label: 'To', val: endDate, onPress: () => setShowEndPicker(true) },
            ]).map((d, i) => (
              <Pressable key={i} onPress={d.onPress} style={{ flex: 1 }}>
                <GlassCard padding={12} radius={R.md} tint={`${C.p500}14`} border={`${C.p500}2e`}>
                  <Txt size={11} color={C.textFaint} style={{ marginBottom: 2 }}>{d.label}</Txt>
                  <Txt weight="semibold" size={14} color={C.text}>{format(d.val, 'MMM d, yyyy')}</Txt>
                </GlassCard>
              </Pressable>
            ))}
          </View>
        </View>

        {showStartPicker && <DateTimePicker value={startDate} mode="date" display="spinner" onChange={handleStartDateChange} />}
        {showEndPicker && <DateTimePicker value={endDate} mode="date" display="spinner" onChange={handleEndDateChange} />}

        {/* ── Filters ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
            <Filter size={14} color={C.p400} />
            <Txt weight="semibold" size={12} color={C.p300}>{t('transactionsScreen.filterByCategory')}</Txt>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilterCategory(null); }}>
              <View style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: filterCategory === null ? `${C.p500}2a` : C.glass, borderWidth: 1.5, borderColor: filterCategory === null ? `${C.p500}88` : 'transparent' }}>
<Txt weight="semibold" size={13} color={filterCategory === null? C.p400: C.textFaint}>All </Txt>
              </View>
            </Pressable>
            {categories.map(cat => {
              const color = meta(cat).color;
              const isSelected = filterCategory === cat;
              return (
                <Pressable key={cat} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilterCategory(cat); }}>
                  <View style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: isSelected ? `${color}22` : C.glass, borderWidth: 1.5, borderColor: isSelected ? `${color}77` : 'transparent' }}>
                    <Txt size={13}>{meta(cat).icon}</Txt>
                    <Txt weight="semibold" size={13} color={isSelected ? color : C.textFaint}>{categoryLabel(cat, allCategories)}</Txt>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilterImpulseOnly(!filterImpulseOnly); }}>
            <View style={{ paddingVertical: 13, paddingHorizontal: 16, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: filterImpulseOnly ? `${C.rose}16` : C.glass, borderWidth: 1.5, borderColor: filterImpulseOnly ? `${C.rose}55` : 'transparent' }}>
              <Zap size={16} color={filterImpulseOnly ? C.rose : C.textFaint} />
              <Txt weight="semibold" size={13} color={filterImpulseOnly ? C.rose : C.textFaint}>
                {filterImpulseOnly ? 'Showing impulse only' : 'Show impulse only'}
              </Txt>
            </View>
          </Pressable>
        </View>

        {/* ── List ── */}
        {groupedArray.length === 0 ? (
          <View className="items-center justify-center" style={{ paddingVertical: 70 }}>
            <View style={{ width: 84, height: 84, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 16, backgroundColor: `${C.p700}26` }}>
              <Inbox size={38} color={C.textFaint} />
            </View>
            <Txt weight="bold" size={18} color={C.text} style={{ marginBottom: 6 }}>{t('common.nothingYet')}</Txt>
            <Txt size={13} color={C.textFaint} style={{ textAlign: 'center', paddingHorizontal: 40 }}>
Try adjusting your filters, or add your first transaction
            </Txt>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            {groupedArray.map((group, gi) => (
              <Animated.View key={group.date} entering={FadeInUp.delay(Math.min(gi * 40, 240)).springify().damping(16)} style={{ marginBottom: 22 }}>
                <View className="flex-row justify-between items-center mb-3">
                  <Txt weight="semibold" size={13} color={C.textDim}>{format(parseISO(group.date), 'EEEE, MMMM d')}</Txt>
                  <Pill
                    label={`${group.total < 0 ? '−' : '+'}${formatCurrency(Math.abs(group.total))}`}
                    color={group.total < 0 ? C.rose : C.green}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  {group.transactions.map(tx => {
                    const color = meta(tx.category).color;
                    return (
                      <GlassCard key={tx.id} padding={14} radius={R.lg}>
                        <View className="flex-row items-center">
                          <View style={{ width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: `${color}1f`, borderWidth: 1, borderColor: `${color}33` }}>
                            <Txt size={20}>{meta(tx.category).icon}</Txt>
                          </View>

                          <View className="flex-1">
                            <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
                              <Txt weight="semibold" size={15} color={C.text}>{categoryLabel(tx.category, allCategories)}</Txt>
                              {tx.isImpulse ? <Pill label="Impulse" color={C.rose} /> : null}
                            </View>
                            {tx.note ? <Txt size={13} color={C.textFaint} style={{ marginTop: 2 }}>{tx.note}</Txt> : null}
                            {!!settings?.showTimeCost && settings?.hourlyValue > 0 && tx.type === 'Expense' && (
                              <View className="flex-row items-center" style={{ gap: 4, marginTop: 3 }}>
                                <Clock size={12} color={C.textFaint} />
                                <Txt size={11} color={C.textFaint}>{formatTimeCost(calculateTimeCost(tx.amount, settings.hourlyValue))}</Txt>
                              </View>
                            )}
                          </View>

                          <View className="items-end">
                            <Txt weight="bold" size={17} color={tx.type === 'Expense' ? C.rose : C.green}>
                              {tx.type === 'Expense' ? '−' : '+'}${tx.amount.toFixed(2)}
                            </Txt>
                            <Pressable onPress={() => handleDelete(tx.id)} style={{ marginTop: 6 }}>
                              <View style={{ borderRadius: 12, padding: 6, backgroundColor: 'rgba(239,68,68,0.1)' }}>
                                <Trash2 size={14} color="#ef4444" />
                              </View>
                            </Pressable>
                          </View>
                        </View>
                      </GlassCard>
                    );
                  })}
                </View>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
