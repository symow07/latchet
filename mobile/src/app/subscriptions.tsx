import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { useC, type Palette } from '@/lib/design';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  CreditCard,
  Repeat,
  Search,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';
import { format, parseISO, differenceInDays } from 'date-fns';

import { getSubscriptions, type Subscription } from '@/lib/db';
import { EmailScanCard } from '@/components/EmailScanCard';
import { ScreenBackground } from '@/components/ui';
import {
  scanAndSaveSubscriptions,
  monthlySubscriptionTotal,
} from '@/lib/subscription-detection';
import { formatCurrency } from '@/lib/calculations';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

type SegmentKey = 'confirmed' | 'possible' | 'canceled';

const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'possible', label: 'Possible' },
  { key: 'canceled', label: 'Canceled' },
];

function cadenceLabel(cadence: Subscription['cadence']): string {
  switch (cadence) {
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'yearly': return 'Yearly';
    default: return 'Unknown';
  }
}

function nextChargeMeta(nextExpectedAt: string | null, C: Palette): { label: string; color: string } | null {
  if (!nextExpectedAt) return null;
  const today = new Date();
  const nextDate = parseISO(nextExpectedAt);
  const daysUntil = differenceInDays(nextDate, today);
  const formatted = format(nextDate, 'MMM d', { locale: getDateFnsLocale() });

  if (daysUntil < 0) {
    return { label: `Overdue (${formatted})`, color: '#ef4444' };
  }
  if (daysUntil <= 7) {
    return { label: `Next: ${formatted}`, color: '#f59e0b' };
  }
  return { label: `Next: ${formatted}`, color: C.textDim };
}

function SkeletonCard() {
  const C = useC();
  return (
    <View
      className="mx-4 mb-3 rounded-2xl overflow-hidden"
      style={{ backgroundColor: C.glass, padding: 16 }}
    >
      <View className="flex-row items-center gap-3">
        <View className="w-11 h-11 rounded-xl bg-white/10" />
        <View className="flex-1 gap-2">
          <View className="h-4 rounded-md bg-white/10 w-3/5" />
          <View className="h-3 rounded-md bg-white/10 w-2/5" />
        </View>
        <View className="h-5 w-16 rounded-full bg-white/10" />
      </View>
    </View>
  );
}

function SubscriptionCard({
  sub,
  segment,
  index,
  onPress,
}: {
  sub: Subscription;
  segment: SegmentKey;
  index: number;
  onPress: () => void;
}) {
  const C = useC();
  const nextMeta = nextChargeMeta(sub.nextExpectedAt, C);

  const statusIcon =
    sub.status === 'confirmed' ? (
      <CheckCircle size={18} color="#22c55e" />
    ) : sub.status === 'canceled' ? (
      <XCircle size={18} color="#6b7280" />
    ) : (
      <Clock size={18} color="#f59e0b" />
    );

  return (
    <Animated.View entering={FadeInUp.delay(index * 60).springify()}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={({ pressed }) => ({
          marginHorizontal: 16,
          marginBottom: 10,
          borderRadius: 18,
          backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
          padding: 16,
          borderWidth: 1,
          borderColor: pressed ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)',
        })}
      >
        <View className="flex-row items-start gap-3">
          {/* Icon block */}
          <View
            className="w-11 h-11 rounded-xl items-center justify-center"
            style={{
              backgroundColor:
                sub.status === 'confirmed'
                  ? 'rgba(34,197,94,0.15)'
                  : sub.status === 'canceled'
                  ? 'rgba(107,114,128,0.15)'
                  : 'rgba(245,158,11,0.15)',
            }}
          >
            <CreditCard
              size={20}
              color={
                sub.status === 'confirmed'
                  ? '#22c55e'
                  : sub.status === 'canceled'
                  ? '#6b7280'
                  : '#f59e0b'
              }
            />
          </View>

          {/* Info */}
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="font-bold text-base"
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {sub.merchantDisplay}
              </Text>
              {statusIcon}
            </View>

            <View className="flex-row items-center gap-2 flex-wrap">
              {/* Cadence badge */}
              <View
                className="px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(168,85,247,0.18)' }}
              >
                <Text className="text-xs font-semibold" style={{ color: C.p400 }}>
                  {cadenceLabel(sub.cadence)}
                </Text>
              </View>

              {/* Amount */}
              <Text style={{ color: C.text }} className="font-semibold text-sm">
                {formatCurrency(sub.typicalAmount)}
              </Text>

              {/* Next charge */}
              {nextMeta && sub.status !== 'canceled' && (
                <Text className="text-xs" style={{ color: nextMeta.color }}>
                  {nextMeta.label}
                </Text>
              )}
            </View>

            {/* Confidence bar for 'possible' segment */}
            {segment === 'possible' && (
              <View className="mt-2 gap-1">
                <View className="flex-row justify-between">
                  <Text className="text-xs" style={{ color: C.textDim }}>
                    Confidence
                  </Text>
                  <Text className="text-xs font-semibold" style={{ color: '#f59e0b' }}>
                    {Math.round(sub.confidenceScore)}%
                  </Text>
                </View>
                <View
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: C.glassStrong }}
                >
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${sub.confidenceScore}%`,
                      backgroundColor:
                        sub.confidenceScore >= 60 ? '#22c55e' : sub.confidenceScore >= 40 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function EmptyState({ segment }: { segment: SegmentKey }) {
  const C = useC();
  const configs: Record<SegmentKey, { icon: React.ReactNode; title: string; subtitle: string }> = {
    confirmed: {
      icon: <CheckCircle size={36} color="#22c55e" />,
      title: 'No confirmed subscriptions',
      subtitle: 'Subscriptions you verify will appear here.',
    },
    possible: {
      icon: <Clock size={36} color="#f59e0b" />,
      title: 'No possible subscriptions',
      subtitle: 'Tap "Scan" to detect recurring charges from your transactions.',
    },
    canceled: {
      icon: <XCircle size={36} color="#6b7280" />,
      title: 'No canceled subscriptions',
      subtitle: "Subscriptions you've canceled will be tracked here.",
    },
  };
  const { icon, title, subtitle } = configs[segment];

  return (
    <Animated.View entering={FadeInDown.delay(100).springify()} className="items-center py-14 px-8">
      <View
        className="w-20 h-20 rounded-full items-center justify-center mb-4"
        style={{ backgroundColor: C.glass }}
      >
        {icon}
      </View>
      <Text style={{ color: C.text }} className="font-bold text-lg text-center mb-2">{title}</Text>
      <Text className="text-center text-sm leading-5" style={{ color: C.textDim }}>
        {subtitle}
      </Text>
    </Animated.View>
  );
}

export default function SubscriptionsScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<SegmentKey>('confirmed');
  const [isScanning, setIsScanning] = useState(false);

  const { data: allSubscriptions = [], isLoading } = useQuery<Subscription[]>({
    queryKey: ['subscriptions'],
    queryFn: () => getSubscriptions(),
  });

  const filtered = allSubscriptions.filter(s => s.status === segment);
  const monthlyTotal = monthlySubscriptionTotal(allSubscriptions);
  const activeCount = allSubscriptions.filter(s => s.status !== 'canceled').length;

  async function handleScan() {
    if (isScanning) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsScanning(true);
    try {
      await scanAndSaveSubscriptions();
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    } catch (e) {
      console.error('[Subscriptions] scan error:', e);
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <ScreenBackground>
      {/* Header */}
      <LinearGradient
        colors={[C.p600, C.p500, C.p400, C.scheme === 'light' ? C.p300 : '#1e1b2e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 16,
          paddingBottom: 24,
          paddingHorizontal: 16,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        }}
      >
        {/* Top row */}
        <View className="flex-row items-center justify-between mb-5">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>

          <View className="flex-1 items-center px-3">
            <Text className="text-white text-lg font-bold">{t('subscriptionsScreen.title')}</Text>
            {activeCount > 0 && (
              <Text className="text-white/70 text-xs mt-0.5">
                {formatCurrency(monthlyTotal)}/mo from {activeCount} active
              </Text>
            )}
          </View>

          <Pressable
            onPress={handleScan}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
            disabled={isScanning}
          >
            {isScanning ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <RefreshCw size={18} color="white" />
            )}
          </Pressable>
        </View>

        {/* Segment pills */}
        <View
          className="flex-row rounded-2xl p-1"
          style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
        >
          {SEGMENTS.map(seg => (
            <Pressable
              key={seg.key}
              onPress={() => {
                Haptics.selectionAsync();
                setSegment(seg.key);
              }}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 14,
                alignItems: 'center',
                backgroundColor: segment === seg.key ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{
                  color: segment === seg.key ? 'white' : 'rgba(255,255,255,0.55)',
                }}
              >
                {seg.label}
              </Text>
              {allSubscriptions.filter(s => s.status === seg.key).length > 0 && (
                <View
                  className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full items-center justify-center"
                  style={{
                    backgroundColor: segment === seg.key ? C.p500 : 'rgba(168,85,247,0.5)',
                  }}
                >
                  <Text className="text-white text-[9px] font-bold">
                    {allSubscriptions.filter(s => s.status === seg.key).length}
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Email scanner — find subscriptions from receipt emails */}
        <EmailScanCard accent={C.p500} />

        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : filtered.length === 0 ? (
          <>
            <EmptyState segment={segment} />
            {/* CTA if no subscriptions at all */}
            {allSubscriptions.length === 0 && (
              <Animated.View entering={FadeInUp.delay(200).springify()} className="mx-4">
                <Pressable
                  onPress={handleScan}
                  disabled={isScanning}
                  className="rounded-2xl overflow-hidden"
                >
                  <LinearGradient
                    colors={[C.p600, C.p500]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 10 }}
                  >
                    {isScanning ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Search size={18} color="white" />
                    )}
                    <Text className="text-white font-bold text-base">
                      {isScanning ? 'Scanning...' : 'Scan for Subscriptions'}
                    </Text>
                  </LinearGradient>
                </Pressable>
                <Text className="text-center text-xs mt-3" style={{ color: C.textDim }}>
                  Analyzes your transaction history to detect recurring charges
                </Text>
              </Animated.View>
            )}
          </>
        ) : (
          filtered.map((sub, i) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              segment={segment}
              index={i}
              onPress={() => router.push(`/subscription-detail?id=${sub.id}`)}
            />
          ))
        )}

        {/* Scan CTA footer when we have subscriptions but user is looking at a non-empty list */}
        {!isLoading && allSubscriptions.length > 0 && (
          <Animated.View
            entering={FadeInUp.delay(300).springify()}
            className="mx-4 mt-4"
          >
            <Pressable
              onPress={handleScan}
              disabled={isScanning}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 14,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: 'rgba(168,85,247,0.3)',
                backgroundColor: 'rgba(168,85,247,0.08)',
              }}
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={C.p500} />
              ) : (
                <Repeat size={16} color={C.p500} />
              )}
              <Text className="font-semibold text-sm" style={{ color: C.p500 }}>
                {isScanning ? 'Scanning...' : 'Re-scan Transactions'}
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
