import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useState, useMemo } from 'react';
import { C } from '@/lib/design';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Plus,
  TrendingUp,
  TrendingDown,
  Wallet,
  Building2,
  Briefcase,
  DollarSign,
  CreditCard,
  Landmark,
  Home,
  PiggyBank,
  X,
  BarChart3,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';

import { api } from '@/lib/api/api';
import { t } from '@/lib/i18n/core';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 120;
const CHART_WIDTH = SCREEN_WIDTH - 32;

// ─── Types ───────────────────────────────────────────────────────────────────

interface NetWorthBreakdown {
  cashSavings?: number;
  investments?: number;
  realEstate?: number;
  otherAssets?: number;
  creditCardDebt?: number;
  loans?: number;
  mortgage?: number;
  otherLiabilities?: number;
}

interface NetWorthEntry {
  id: string;
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  breakdown?: NetWorthBreakdown;
  createdAt?: string;
}

interface NetWorthListResponse {
  data: NetWorthEntry[];
}

interface FormState {
  cashSavings: string;
  investments: string;
  realEstate: string;
  otherAssets: string;
  creditCardDebt: string;
  loans: string;
  mortgage: string;
  otherLiabilities: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${value < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatCurrencyFull(value: number): string {
  const abs = Math.abs(value);
  return `${value < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseAmount(str: string): number {
  const n = parseFloat(str.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Net Worth Chart ──────────────────────────────────────────────────────────

function NetWorthChart({ entries }: { entries: NetWorthEntry[] }) {
  const data = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    return sorted.slice(-12);
  }, [entries]);

  if (data.length === 0) {
    return (
      <View
        style={{ height: CHART_HEIGHT, width: CHART_WIDTH }}
        className="items-center justify-center"
      >
        <BarChart3 size={32} color="#374151" />
        <Text className="text-gray-600 text-xs mt-2">{t('netWorth.noHistory')}</Text>
      </View>
    );
  }

  if (data.length === 1) {
    return (
      <View
        style={{ height: CHART_HEIGHT, width: CHART_WIDTH }}
        className="items-center justify-center"
      >
        <Text className="text-gray-500 text-xs">{t('netWorth.needMore')}</Text>
      </View>
    );
  }

  const values = data.map((e) => e.netWorth);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal === 0 ? 1 : maxVal - minVal;

  const barWidth = Math.floor((CHART_WIDTH - (data.length - 1) * 4) / data.length);
  const paddedMin = minVal - range * 0.1;

  return (
    <View style={{ height: CHART_HEIGHT, width: CHART_WIDTH }}>
      {/* Zero baseline if values cross zero */}
      {minVal < 0 && maxVal > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.15)',
            top: CHART_HEIGHT * (1 - (0 - paddedMin) / (range * 1.2)),
          }}
        />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT }}>
        {data.map((entry, i) => {
          const netWorth = entry.netWorth;
          const isPositive = netWorth >= 0;
          const heightFraction = (netWorth - paddedMin) / (range * 1.2);
          const barHeight = Math.max(4, heightFraction * CHART_HEIGHT);

          const isLast = i === data.length - 1;
          const isHighlighted = isLast;

          return (
            <View
              key={entry.id ?? i}
              style={{
                width: barWidth,
                marginRight: i < data.length - 1 ? 4 : 0,
                alignItems: 'center',
                justifyContent: 'flex-end',
                height: CHART_HEIGHT,
              }}
            >
              <View
                style={{
                  width: barWidth,
                  height: barHeight,
                  borderRadius: 4,
                  backgroundColor: isHighlighted
                    ? isPositive
                      ? '#22c55e'
                      : '#ef4444'
                    : isPositive
                    ? 'rgba(34,197,94,0.45)'
                    : 'rgba(239,68,68,0.45)',
                }}
              />
            </View>
          );
        })}
      </View>

      {/* X-axis labels: first and last */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ color: '#6b7280', fontSize: 10 }}>
          {new Date(data[0].date + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
            year: '2-digit',
          })}
        </Text>
        <Text style={{ color: '#6b7280', fontSize: 10 }}>
          {new Date(data[data.length - 1].date + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
            year: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}

// ─── Input Row ────────────────────────────────────────────────────────────────

interface InputRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  iconComponent: React.ReactNode;
  placeholder?: string;
}

function InputRow({ label, value, onChange, iconComponent, placeholder }: InputRowProps) {
  return (
    <View className="flex-row items-center mb-3">
      <View className="w-9 h-9 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}>
        {iconComponent}
      </View>
      <Text className="text-gray-300 text-sm flex-1">{label}</Text>
      <View
        className="flex-row items-center rounded-xl px-3 py-2"
        style={{ backgroundColor: 'rgba(255,255,255,0.07)', minWidth: 110 }}
      >
        <Text className="text-gray-500 text-sm mr-1">$</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? '0'}
          placeholderTextColor="#4b5563"
          keyboardType="decimal-pad"
          returnKeyType="done"
          style={{ color: 'white', fontSize: 14, minWidth: 70, textAlign: 'right' }}
        />
      </View>
    </View>
  );
}

// ─── Add Modal ────────────────────────────────────────────────────────────────

interface AddModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (body: {
    date: string;
    assets: number;
    liabilities: number;
    breakdown: NetWorthBreakdown;
  }) => void;
  isSubmitting: boolean;
}

function AddModal({ visible, onClose, onSubmit, isSubmitting }: AddModalProps) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<FormState>({
    cashSavings: '',
    investments: '',
    realEstate: '',
    otherAssets: '',
    creditCardDebt: '',
    loans: '',
    mortgage: '',
    otherLiabilities: '',
  });

  const field = (key: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [key]: v }));

  const totalAssets =
    parseAmount(form.cashSavings) +
    parseAmount(form.investments) +
    parseAmount(form.realEstate) +
    parseAmount(form.otherAssets);

  const totalLiabilities =
    parseAmount(form.creditCardDebt) +
    parseAmount(form.loans) +
    parseAmount(form.mortgage) +
    parseAmount(form.otherLiabilities);

  const netWorth = totalAssets - totalLiabilities;

  function handleSubmit() {
    const breakdown: NetWorthBreakdown = {
      cashSavings: parseAmount(form.cashSavings) || undefined,
      investments: parseAmount(form.investments) || undefined,
      realEstate: parseAmount(form.realEstate) || undefined,
      otherAssets: parseAmount(form.otherAssets) || undefined,
      creditCardDebt: parseAmount(form.creditCardDebt) || undefined,
      loans: parseAmount(form.loans) || undefined,
      mortgage: parseAmount(form.mortgage) || undefined,
      otherLiabilities: parseAmount(form.otherLiabilities) || undefined,
    };
    onSubmit({
      date: todayISO(),
      assets: totalAssets,
      liabilities: totalLiabilities,
      breakdown,
    });
    setForm({
      cashSavings: '',
      investments: '',
      realEstate: '',
      otherAssets: '',
      creditCardDebt: '',
      loans: '',
      mortgage: '',
      otherLiabilities: '',
    });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Modal header */}
        <View
          style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}
          className="flex-row items-center justify-between border-b border-gray-800"
        >
          <View>
            <Text className="text-white text-xl font-bold">{t('netWorth.newSnapshot')}</Text>
            <Text className="text-gray-500 text-xs mt-0.5">{formatDate(todayISO())}</Text>
          </View>
          <Pressable
            onPress={onClose}
            className="w-9 h-9 rounded-full bg-gray-800 items-center justify-center"
          >
            <X size={18} color="#9ca3af" />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Assets section */}
            <View className="mb-5">
              <View className="flex-row items-center mb-3">
                <View
                  className="w-7 h-7 rounded-lg items-center justify-center mr-2"
                  style={{ backgroundColor: 'rgba(34,197,94,0.15)' }}
                >
                  <TrendingUp size={14} color="#22c55e" />
                </View>
                <Text className="text-green-400 text-xs font-bold tracking-widest">{t('netWorth.assets')}</Text>
              </View>

              <View
                className="rounded-2xl p-4"
                style={{ backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.12)' }}
              >
                <InputRow
                  label="Cash & Savings"
                  value={form.cashSavings}
                  onChange={field('cashSavings')}
                  iconComponent={<Wallet size={16} color="#22c55e" />}
                />
                <InputRow
                  label="Investments"
                  value={form.investments}
                  onChange={field('investments')}
                  iconComponent={<TrendingUp size={16} color="#22c55e" />}
                />
                <InputRow
                  label="Real Estate"
                  value={form.realEstate}
                  onChange={field('realEstate')}
                  iconComponent={<Home size={16} color="#22c55e" />}
                />
                <InputRow
                  label="Other Assets"
                  value={form.otherAssets}
                  onChange={field('otherAssets')}
                  iconComponent={<Briefcase size={16} color="#22c55e" />}
                />

                <View
                  className="flex-row items-center justify-between pt-3 mt-1"
                  style={{ borderTopWidth: 1, borderTopColor: 'rgba(34,197,94,0.15)' }}
                >
                  <Text className="text-green-400 text-sm font-semibold">{t('netWorth.totalAssets')}</Text>
                  <Text className="text-green-400 text-base font-bold">{formatCurrencyFull(totalAssets)}</Text>
                </View>
              </View>
            </View>

            {/* Liabilities section */}
            <View className="mb-6">
              <View className="flex-row items-center mb-3">
                <View
                  className="w-7 h-7 rounded-lg items-center justify-center mr-2"
                  style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}
                >
                  <TrendingDown size={14} color="#ef4444" />
                </View>
                <Text className="text-red-400 text-xs font-bold tracking-widest">{t('netWorth.liabilities')}</Text>
              </View>

              <View
                className="rounded-2xl p-4"
                style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.12)' }}
              >
                <InputRow
                  label="Credit Card Debt"
                  value={form.creditCardDebt}
                  onChange={field('creditCardDebt')}
                  iconComponent={<CreditCard size={16} color="#ef4444" />}
                />
                <InputRow
                  label="Loans"
                  value={form.loans}
                  onChange={field('loans')}
                  iconComponent={<DollarSign size={16} color="#ef4444" />}
                />
                <InputRow
                  label="Mortgage"
                  value={form.mortgage}
                  onChange={field('mortgage')}
                  iconComponent={<Landmark size={16} color="#ef4444" />}
                />
                <InputRow
                  label="Other Liabilities"
                  value={form.otherLiabilities}
                  onChange={field('otherLiabilities')}
                  iconComponent={<Building2 size={16} color="#ef4444" />}
                />

                <View
                  className="flex-row items-center justify-between pt-3 mt-1"
                  style={{ borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.15)' }}
                >
                  <Text className="text-red-400 text-sm font-semibold">{t('netWorth.totalLiabilities')}</Text>
                  <Text className="text-red-400 text-base font-bold">{formatCurrencyFull(totalLiabilities)}</Text>
                </View>
              </View>
            </View>

            {/* Net worth preview */}
            <LinearGradient
              colors={netWorth >= 0 ? ['#14532d', '#166534'] : ['#450a0a', '#7f1d1d']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 16, padding: 16, marginBottom: 24 }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 4 }}>
                Net Worth Preview
              </Text>
              <Text
                style={{
                  color: netWorth >= 0 ? '#4ade80' : '#f87171',
                  fontSize: 28,
                  fontWeight: '800',
                }}
              >
                {netWorth >= 0 ? '+' : ''}{formatCurrencyFull(netWorth)}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 }}>
                {formatCurrencyFull(totalAssets)} assets − {formatCurrencyFull(totalLiabilities)} liabilities
              </Text>
            </LinearGradient>

            {/* Save button */}
            <Pressable
              onPress={handleSubmit}
              disabled={isSubmitting || (totalAssets === 0 && totalLiabilities === 0)}
              style={({ pressed }) => ({
                opacity: pressed || (totalAssets === 0 && totalLiabilities === 0) ? 0.6 : 1,
              })}
            >
              <LinearGradient
                colors={['#2563eb', '#1d4ed8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                    Save Snapshot
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Snapshot Row ─────────────────────────────────────────────────────────────

interface SnapshotRowProps {
  entry: NetWorthEntry;
  prevEntry: NetWorthEntry | null;
  index: number;
}

function SnapshotRow({ entry, prevEntry, index }: SnapshotRowProps) {
  const isPositive = entry.netWorth >= 0;
  const delta = prevEntry != null ? entry.netWorth - prevEntry.netWorth : null;
  const deltaPositive = delta != null && delta >= 0;

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).duration(350)}>
      <View
        className="flex-row items-center rounded-2xl px-4 py-3 mb-2"
        style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}
      >
        {/* Left color bar */}
        <View
          style={{
            width: 3,
            height: 36,
            borderRadius: 3,
            backgroundColor: isPositive ? '#22c55e' : '#ef4444',
            marginRight: 12,
          }}
        />

        <View style={{ flex: 1 }}>
          <Text className="text-white font-semibold text-sm">{formatDate(entry.date)}</Text>
          <View className="flex-row items-center mt-1">
            <Text className="text-gray-500 text-xs mr-2">
              Assets {formatCurrency(entry.assets)}
            </Text>
            <Text className="text-gray-700 text-xs mr-2">·</Text>
            <Text className="text-gray-500 text-xs">
              Liabilities {formatCurrency(entry.liabilities)}
            </Text>
          </View>
        </View>

        <View className="items-end">
          <Text
            style={{
              color: isPositive ? '#4ade80' : '#f87171',
              fontSize: 15,
              fontWeight: '700',
            }}
          >
            {formatCurrency(entry.netWorth)}
          </Text>
          {delta !== null && (
            <View className="flex-row items-center mt-0.5">
              {deltaPositive ? (
                <TrendingUp size={10} color="#22c55e" />
              ) : (
                <TrendingDown size={10} color="#ef4444" />
              )}
              <Text
                style={{
                  color: deltaPositive ? '#22c55e' : '#ef4444',
                  fontSize: 10,
                  marginLeft: 2,
                }}
              >
                {deltaPositive ? '+' : ''}{formatCurrency(delta)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function NetWorthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);

  const { data, isLoading, isError } = useQuery<NetWorthEntry[]>({
    queryKey: ['net-worth'],
    queryFn: async () => {
      const res = await api.get<NetWorthEntry[] | NetWorthListResponse>('/api/net-worth?limit=24');
      if (Array.isArray(res)) return res;
      return (res as NetWorthListResponse).data ?? [];
    },
  });

  const entries: NetWorthEntry[] = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data]);

  const latestEntry = entries[0] ?? null;
  const secondEntry = entries[1] ?? null;

  const currentNetWorth = latestEntry?.netWorth ?? 0;
  const currentAssets = latestEntry?.assets ?? 0;
  const currentLiabilities = latestEntry?.liabilities ?? 0;
  const isPositive = currentNetWorth >= 0;

  const netWorthDelta =
    latestEntry && secondEntry ? latestEntry.netWorth - secondEntry.netWorth : null;
  const deltaPositive = netWorthDelta != null && netWorthDelta >= 0;

  const addMutation = useMutation({
    mutationFn: (body: {
      date: string;
      assets: number;
      liabilities: number;
      breakdown: NetWorthBreakdown;
    }) => api.post('/api/net-worth', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['net-worth'] });
      setModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header gradient ── */}
      <LinearGradient
        colors={
          isPositive
            ? ['#052e16', '#14532d', '#1a6b39']
            : ['#1c0404', '#450a0a', '#5a0d0d']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ paddingTop: insets.top + 8, paddingBottom: 36, paddingHorizontal: 16 }}
      >
        {/* Nav row */}
        <View className="flex-row items-center justify-between mb-8">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>

          <View className="items-center">
            <Text className="text-white/60 text-xs font-semibold tracking-widest">{t('netWorth.title')}</Text>
          </View>

          <View style={{ width: 40 }} />
        </View>

        {/* Big net worth number */}
        <Animated.View entering={FadeInDown.duration(500)} className="items-center">
          {isLoading ? (
            <ActivityIndicator color="white" size="large" />
          ) : (
            <>
              <Text
                style={{
                  color: isPositive ? '#4ade80' : '#f87171',
                  fontSize: 48,
                  fontWeight: '800',
                  letterSpacing: -1,
                }}
              >
                {isPositive ? '' : '-'}${Math.abs(currentNetWorth).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </Text>

              {netWorthDelta !== null && (
                <View
                  className="flex-row items-center mt-2 px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
                >
                  {deltaPositive ? (
                    <TrendingUp size={13} color={deltaPositive ? '#4ade80' : '#f87171'} />
                  ) : (
                    <TrendingDown size={13} color="#f87171" />
                  )}
                  <Text
                    style={{
                      color: deltaPositive ? '#4ade80' : '#f87171',
                      fontSize: 12,
                      fontWeight: '600',
                      marginLeft: 4,
                    }}
                  >
                    {deltaPositive ? '+' : ''}{formatCurrencyFull(netWorthDelta)} since last snapshot
                  </Text>
                </View>
              )}

              {entries.length === 0 && !isLoading && (
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 6 }}>
                  Add your first snapshot to get started
                </Text>
              )}
            </>
          )}
        </Animated.View>

        {/* Stats row */}
        <View className="flex-row mt-8 gap-3">
          <View
            className="flex-1 rounded-2xl p-3 items-center"
            style={{ backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)' }}
          >
            <View className="flex-row items-center mb-1">
              <TrendingUp size={13} color="#4ade80" />
              <Text className="text-green-400 text-xs font-semibold ml-1">{t('netWorth.assets')}</Text>
            </View>
            <Text className="text-white font-bold text-base">{formatCurrency(currentAssets)}</Text>
          </View>

          <View
            className="flex-1 rounded-2xl p-3 items-center"
            style={{ backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}
          >
            <View className="flex-row items-center mb-1">
              <TrendingDown size={13} color="#f87171" />
              <Text className="text-red-400 text-xs font-semibold ml-1">{t('netWorth.liabilities')}</Text>
            </View>
            <Text className="text-white font-bold text-base">{formatCurrency(currentLiabilities)}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <ScrollView
        style={{ flex: 1, marginTop: -18 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Chart card */}
        {entries.length >= 2 && (
          <Animated.View entering={FadeInUp.delay(100).duration(400)} className="mx-4 mb-4">
            <View
              className="rounded-2xl p-4"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
            >
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-gray-400 text-xs font-semibold tracking-widest">
                  NET WORTH HISTORY
                </Text>
                <Text className="text-gray-600 text-xs">Last {Math.min(entries.length, 12)} snapshots</Text>
              </View>
              <NetWorthChart entries={entries} />
            </View>
          </Animated.View>
        )}

        {/* Breakdown card for latest entry */}
        {latestEntry?.breakdown && Object.values(latestEntry.breakdown).some((v) => v != null && v > 0) && (
          <Animated.View entering={FadeInUp.delay(200).duration(400)} className="mx-4 mb-4">
            <View
              className="rounded-2xl p-4"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
            >
              <Text className="text-gray-400 text-xs font-semibold tracking-widest mb-4">
                LATEST BREAKDOWN
              </Text>

              {/* Assets breakdown */}
              <View className="mb-3">
                {latestEntry.breakdown.cashSavings != null && latestEntry.breakdown.cashSavings > 0 && (
                  <BreakdownLine icon={<Wallet size={14} color="#4ade80" />} label="Cash & Savings" value={latestEntry.breakdown.cashSavings} color="#4ade80" />
                )}
                {latestEntry.breakdown.investments != null && latestEntry.breakdown.investments > 0 && (
                  <BreakdownLine icon={<TrendingUp size={14} color="#4ade80" />} label="Investments" value={latestEntry.breakdown.investments} color="#4ade80" />
                )}
                {latestEntry.breakdown.realEstate != null && latestEntry.breakdown.realEstate > 0 && (
                  <BreakdownLine icon={<Home size={14} color="#4ade80" />} label="Real Estate" value={latestEntry.breakdown.realEstate} color="#4ade80" />
                )}
                {latestEntry.breakdown.otherAssets != null && latestEntry.breakdown.otherAssets > 0 && (
                  <BreakdownLine icon={<Briefcase size={14} color="#4ade80" />} label="Other Assets" value={latestEntry.breakdown.otherAssets} color="#4ade80" />
                )}
              </View>

              <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 12 }} />

              {latestEntry.breakdown.creditCardDebt != null && latestEntry.breakdown.creditCardDebt > 0 && (
                <BreakdownLine icon={<CreditCard size={14} color="#f87171" />} label="Credit Card Debt" value={latestEntry.breakdown.creditCardDebt} color="#f87171" negate />
              )}
              {latestEntry.breakdown.loans != null && latestEntry.breakdown.loans > 0 && (
                <BreakdownLine icon={<DollarSign size={14} color="#f87171" />} label="Loans" value={latestEntry.breakdown.loans} color="#f87171" negate />
              )}
              {latestEntry.breakdown.mortgage != null && latestEntry.breakdown.mortgage > 0 && (
                <BreakdownLine icon={<Landmark size={14} color="#f87171" />} label="Mortgage" value={latestEntry.breakdown.mortgage} color="#f87171" negate />
              )}
              {latestEntry.breakdown.otherLiabilities != null && latestEntry.breakdown.otherLiabilities > 0 && (
                <BreakdownLine icon={<Building2 size={14} color="#f87171" />} label="Other Liabilities" value={latestEntry.breakdown.otherLiabilities} color="#f87171" negate />
              )}
            </View>
          </Animated.View>
        )}

        {/* Snapshots list */}
        <View className="mx-4">
          <Text className="text-gray-400 text-xs font-semibold tracking-widest mb-3">
            SNAPSHOT HISTORY
          </Text>

          {isLoading && (
            <View className="items-center py-10">
              <ActivityIndicator color="#3b82f6" />
            </View>
          )}

          {isError && (
            <View
              className="rounded-2xl p-4 items-center"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.15)' }}
            >
              <Text className="text-red-400 text-sm">{t('netWorth.loadFailed')}</Text>
            </View>
          )}

          {!isLoading && !isError && entries.length === 0 && (
            <View className="items-center py-12">
              <View
                className="w-16 h-16 rounded-2xl items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(59,130,246,0.12)' }}
              >
                <PiggyBank size={30} color="#3b82f6" />
              </View>
              <Text className="text-white font-semibold text-base mb-1">{t('netWorth.noSnapshots')}</Text>
              <Text className="text-gray-500 text-sm text-center px-8">
                Tap the + button to record your first net worth snapshot.
              </Text>
            </View>
          )}

          {entries.map((entry, index) => (
            <SnapshotRow
              key={entry.id ?? index}
              entry={entry}
              prevEntry={entries[index + 1] ?? null}
              index={index}
            />
          ))}
        </View>
      </ScrollView>

      {/* ── FAB ── */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setModalVisible(true);
        }}
        style={({ pressed }) => ({
          position: 'absolute',
          bottom: insets.bottom + 24,
          right: 20,
          width: 58,
          height: 58,
          borderRadius: 29,
          overflow: 'hidden',
          opacity: pressed ? 0.85 : 1,
          shadowColor: '#3b82f6',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.5,
          shadowRadius: 12,
          elevation: 10,
        })}
      >
        <LinearGradient
          colors={['#3b82f6', '#2563eb']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Plus size={26} color="white" strokeWidth={2.5} />
        </LinearGradient>
      </Pressable>

      {/* ── Add Modal ── */}
      <AddModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSubmit={(body) => addMutation.mutate(body)}
        isSubmitting={addMutation.isPending}
      />
    </View>
  );
}

// ─── Breakdown Line ───────────────────────────────────────────────────────────

interface BreakdownLineProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  negate?: boolean;
}

function BreakdownLine({ icon, label, value, color, negate }: BreakdownLineProps) {
  return (
    <View className="flex-row items-center justify-between mb-2">
      <View className="flex-row items-center">
        <View
          className="w-7 h-7 rounded-lg items-center justify-center mr-2"
          style={{ backgroundColor: `${color}18` }}
        >
          {icon}
        </View>
        <Text className="text-gray-400 text-sm">{label}</Text>
      </View>
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>
        {negate ? '-' : '+'}{formatCurrencyFull(value)}
      </Text>
    </View>
  );
}
