import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { getTransactions, deleteTransaction, getSettings } from '@/lib/db';
import { formatCurrency, formatTimeCost, calculateTimeCost } from '@/lib/calculations';
import { Trash2, Filter, Zap, Clock } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

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

const CATEGORY_ICONS: Record<string, string> = {
  Food: '🍔',
  Gym: '💪',
  Transport: '🚗',
  Shopping: '🛍️',
  Subscriptions: '📱',
  Other: '📦',
};

const CATEGORY_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Food: { text: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },
  Gym: { text: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.3)' },
  Transport: { text: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' },
  Shopping: { text: '#f472b6', bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.3)' },
  Subscriptions: { text: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.3)' },
  Other: { text: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' },
};

export default function TransactionsScreen() {
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
      if (hasMounted.current) {
        setRefreshKey(prev => prev + 1);
      } else {
        hasMounted.current = true;
      }
    }, [])
  );

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', refreshKey],
    queryFn: getTransactions,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings', refreshKey],
    queryFn: getSettings,
  });

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
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
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

  const handleStartDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) setStartDate(selectedDate);
    setShowStartPicker(false);
  };

  const handleEndDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) setEndDate(selectedDate);
    setShowEndPicker(false);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#06060f' }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Deep Purple Gradient Header */}
        <LinearGradient
          colors={['#2e1065', '#4c1d95', '#6d28d9', '#06060f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: 24,
            paddingHorizontal: 20,
            borderBottomLeftRadius: 36,
            borderBottomRightRadius: 36,
          }}
        >
          <Text className="text-3xl font-bold text-white mb-1">History 📖</Text>
          <Text className="text-purple-200/70">
            {filtered.length > 0 ? `${filtered.length} records found ✨` : 'No records yet — start tracking!'}
          </Text>

          {/* Date Range Filter */}
          <View className="flex-row gap-3 mt-5">
            <Pressable onPress={() => setShowStartPicker(true)} className="flex-1">
              <View
                className="rounded-2xl p-3"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
              >
                <Text className="text-purple-200/60 text-xs mb-1">From 📅</Text>
                <Text className="text-white font-semibold">{format(startDate, 'MMM d, yyyy')}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => setShowEndPicker(true)} className="flex-1">
              <View
                className="rounded-2xl p-3"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
              >
                <Text className="text-purple-200/60 text-xs mb-1">To 📅</Text>
                <Text className="text-white font-semibold">{format(endDate, 'MMM d, yyyy')}</Text>
              </View>
            </Pressable>
          </View>
        </LinearGradient>

        {showStartPicker && (
          <DateTimePicker value={startDate} mode="date" display="spinner" onChange={handleStartDateChange} />
        )}
        {showEndPicker && (
          <DateTimePicker value={endDate} mode="date" display="spinner" onChange={handleEndDateChange} />
        )}

        {/* Filters */}
        <View className="px-4 pt-4">
          <View className="flex-row items-center mb-3">
            <Filter size={14} color="#a855f7" />
            <Text className="text-purple-300/80 text-xs ml-2">Filter by category</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} className="mb-3">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setFilterCategory(null);
              }}
            >
              <View
                className="py-2.5 px-4 rounded-2xl mr-2"
                style={{
                  backgroundColor: filterCategory === null ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255,255,255,0.04)',
                  borderWidth: 1.5,
                  borderColor: filterCategory === null ? 'rgba(168, 85, 247, 0.55)' : 'transparent',
                }}
              >
                <Text className="font-semibold" style={{ color: filterCategory === null ? '#c084fc' : '#4b5563' }}>
                  All ✨
                </Text>
              </View>
            </Pressable>
            {categories.map(cat => {
              const catStyle = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Other'];
              const isSelected = filterCategory === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setFilterCategory(cat);
                  }}
                >
                  <View
                    className="py-2.5 px-4 rounded-2xl mr-2 flex-row items-center"
                    style={{
                      backgroundColor: isSelected ? catStyle.bg : 'rgba(255,255,255,0.04)',
                      borderWidth: 1.5,
                      borderColor: isSelected ? catStyle.border : 'transparent',
                    }}
                  >
                    <Text style={{ marginRight: 6 }}>{CATEGORY_ICONS[cat] || '📦'}</Text>
                    <Text className="font-semibold" style={{ color: isSelected ? catStyle.text : '#4b5563' }}>
                      {cat}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilterImpulseOnly(!filterImpulseOnly);
            }}
          >
            <View
              className="py-3 px-4 rounded-2xl flex-row items-center"
              style={{
                backgroundColor: filterImpulseOnly ? 'rgba(244, 114, 182, 0.12)' : 'rgba(255,255,255,0.04)',
                borderWidth: 1.5,
                borderColor: filterImpulseOnly ? 'rgba(244, 114, 182, 0.4)' : 'transparent',
              }}
            >
              <Zap size={16} color={filterImpulseOnly ? '#f472b6' : '#4b5563'} />
              <Text className="ml-2 font-medium" style={{ color: filterImpulseOnly ? '#f472b6' : '#4b5563' }}>
                {filterImpulseOnly ? 'Showing impulse only ⚡' : 'Show impulse only'}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Transactions List */}
        {groupedArray.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20">
            <View
              className="w-20 h-20 rounded-3xl items-center justify-center mb-4"
              style={{ backgroundColor: 'rgba(109,40,217,0.15)' }}
            >
              <Text className="text-4xl">📭</Text>
            </View>
            <Text className="text-white text-lg font-semibold mb-2">Nothing here yet!</Text>
            <Text className="text-gray-500 text-sm text-center px-8">
              Try adjusting your filters, or add your first transaction 👆
            </Text>
          </View>
        ) : (
          <View className="px-4 pt-4">
            {groupedArray.map(group => (
              <View key={group.date} className="mb-6">
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-gray-300 text-sm font-semibold">
                    {format(parseISO(group.date), 'EEEE, MMMM d')}
                  </Text>
                  <View
                    className="px-3 py-1 rounded-2xl"
                    style={{
                      backgroundColor: group.total < 0 ? 'rgba(251, 113, 133, 0.12)' : 'rgba(52, 211, 153, 0.12)',
                      borderWidth: 1,
                      borderColor: group.total < 0 ? 'rgba(251, 113, 133, 0.25)' : 'rgba(52, 211, 153, 0.25)',
                    }}
                  >
                    <Text className="text-sm font-bold" style={{ color: group.total < 0 ? '#fb7185' : '#34d399' }}>
                      {group.total < 0 ? '−' : '+'}{formatCurrency(Math.abs(group.total))}
                    </Text>
                  </View>
                </View>

                {group.transactions.map(tx => {
                  const catStyle = CATEGORY_COLORS[tx.category] || CATEGORY_COLORS['Other'];
                  return (
                    <View
                      key={tx.id}
                      className="rounded-3xl p-4 mb-2 flex-row items-center"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.06)',
                      }}
                    >
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
                        style={{ backgroundColor: catStyle.bg }}
                      >
                        <Text className="text-xl">{CATEGORY_ICONS[tx.category] || '📦'}</Text>
                      </View>

                      <View className="flex-1">
                        <View className="flex-row items-center flex-wrap gap-1">
                          <Text className="text-white font-semibold">{tx.category}</Text>
                          {tx.isImpulse ? (
                            <View className="bg-pink-500/15 border border-pink-500/25 rounded-full px-2 py-0.5">
                              <Text className="text-pink-400 text-xs font-semibold">⚡ Impulse</Text>
                            </View>
                          ) : null}
                        </View>
                        {tx.note && <Text className="text-gray-500 text-sm mt-0.5">{tx.note}</Text>}
                        {!!settings?.showTimeCost && settings?.hourlyValue > 0 && tx.type === 'Expense' && (
                          <View className="flex-row items-center mt-1">
                            <Clock size={12} color="#4b5563" />
                            <Text className="text-gray-600 text-xs ml-1">
                              {formatTimeCost(calculateTimeCost(tx.amount, settings.hourlyValue))}
                            </Text>
                          </View>
                        )}
                      </View>

                      <View className="items-end">
                        <Text
                          className="text-lg font-bold"
                          style={{ color: tx.type === 'Expense' ? '#fb7185' : '#34d399' }}
                        >
                          {tx.type === 'Expense' ? '−' : '+'}${tx.amount.toFixed(2)}
                        </Text>
                        <Pressable onPress={() => handleDelete(tx.id)} className="mt-2 active:opacity-50">
                          <View className="rounded-xl p-1.5" style={{ backgroundColor: 'rgba(239,68,68,0.08)' }}>
                            <Trash2 size={14} color="#ef4444" />
                          </View>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
