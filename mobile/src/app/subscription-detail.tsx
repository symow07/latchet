import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  ExternalLink,
  Clock,
  Calendar,
  DollarSign,
  Repeat,
  AlertTriangle,
  ChevronRight,
  X,
  Globe,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInUp,
  FadeInDown,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { format, parseISO, isAfter } from 'date-fns';

import {
  getSubscriptionById,
  getSubscriptionOccurrences,
  updateSubscriptionStatus,
  updateSubscriptionCancelInfo,
  type Subscription,
  type SubscriptionOccurrence,
} from '@/lib/db';
import { findCancelEntry, getCancelLink } from '@/lib/cancel-directory';
import { formatCurrency } from '@/lib/calculations';
import { useC } from '@/lib/design';
import { ScreenBackground } from '@/components/ui';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

function cadenceLabel(cadence: Subscription['cadence']): string {
  switch (cadence) {
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'yearly': return 'Yearly';
    default: return 'Unknown';
  }
}

function StatusBadge({ status }: { status: Subscription['status'] }) {
  const configs: Record<
    Subscription['status'],
    { label: string; bg: string; text: string; icon: React.ReactNode }
  > = {
    confirmed: {
      label: t('subStatus.confirmed'),
      bg: 'rgba(34,197,94,0.15)',
      text: '#22c55e',
      icon: <CheckCircle size={13} color="#22c55e" />,
    },
    possible: {
      label: t('subStatus.possible'),
      bg: 'rgba(245,158,11,0.15)',
      text: '#f59e0b',
      icon: <Clock size={13} color="#f59e0b" />,
    },
    canceled: {
      label: t('subStatus.canceled'),
      bg: 'rgba(107,114,128,0.15)',
      text: '#9ca3af',
      icon: <XCircle size={13} color="#9ca3af" />,
    },
  };
  const c = configs[status];
  return (
    <View
      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full"
      style={{ backgroundColor: c.bg }}
    >
      {c.icon}
      <Text className="text-xs font-bold" style={{ color: c.text }}>
        {c.label}
      </Text>
    </View>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  delay: number;
}) {
  const C = useC();
  return (
    <Animated.View entering={FadeInUp.delay(delay).springify()} className="flex-1">
      <View
        className="rounded-2xl items-center p-4 gap-2"
        style={{ backgroundColor: C.glass }}
      >
        <View
          className="w-10 h-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          {icon}
        </View>
        <Text style={{ color: C.text }} className="font-bold text-base text-center">{value}</Text>
        <Text className="text-xs text-center" style={{ color: C.textDim }}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

function OccurrenceRow({ occ, index }: { occ: SubscriptionOccurrence; index: number }) {
  const C = useC();
  const date = parseISO(occ.chargedAt);
  return (
    <Animated.View entering={FadeInUp.delay(index * 40).springify()}>
      <View
        className="flex-row items-center justify-between py-3 px-4"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: C.glassBorder,
        }}
      >
        <View className="flex-row items-center gap-3">
          <View
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: C.p500 }}
          />
          <Text className="text-white text-sm">{format(date, 'MMM d, yyyy', { locale: getDateFnsLocale() })}</Text>
        </View>
        <Text className="font-semibold text-sm" style={{ color: '#22c55e' }}>
          {formatCurrency(occ.amount)}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function SubscriptionDetailScreen() {
  const C = useC();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelNotes, setCancelNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const overlayOpacity = useSharedValue(0);

  const { data: subscription, isLoading: subLoading } = useQuery<Subscription | null>({
    queryKey: ['subscription', id],
    queryFn: () => getSubscriptionById(id ?? ''),
    enabled: !!id,
  });

  const { data: occurrences = [] } = useQuery<SubscriptionOccurrence[]>({
    queryKey: ['subscription-occurrences', id],
    queryFn: () => getSubscriptionOccurrences(id ?? ''),
    enabled: !!id,
  });

  // Pre-fill notes once subscription loads
  if (subscription?.cancelNotes && cancelNotes === '') {
    setCancelNotes(subscription.cancelNotes);
  }

  const cancelEntry = subscription
    ? findCancelEntry(subscription.merchantNormalized)
    : null;

  // Check if a charge occurred after cancellation
  const hasPostCancelCharge =
    subscription?.status === 'canceled' &&
    subscription.updatedAt &&
    occurrences.some(o => isAfter(parseISO(o.chargedAt), parseISO(subscription.updatedAt)));

  async function handleStatusChange(newStatus: Subscription['status']) {
    if (!subscription || isUpdatingStatus) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsUpdatingStatus(true);
    try {
      await updateSubscriptionStatus(subscription.id, newStatus);
      await queryClient.invalidateQueries({ queryKey: ['subscription', id] });
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    } catch (e) {
      console.error('[SubscriptionDetail] status update error:', e);
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function handleSaveNotes() {
    if (!subscription || isSavingNotes) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSavingNotes(true);
    try {
      await updateSubscriptionCancelInfo(subscription.id, cancelEntry?.cancelUrl ?? null, cancelNotes);
      await queryClient.invalidateQueries({ queryKey: ['subscription', id] });
      await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    } catch (e) {
      console.error('[SubscriptionDetail] save notes error:', e);
    } finally {
      setIsSavingNotes(false);
    }
  }

  // One-tap cancel: jump straight to the exact place the subscription can be
  // canceled (native iOS/Google subscriptions screen, or the merchant's web
  // cancel page). Falls back to the how-to sheet when we don't know the service.
  async function handleCancelNow() {
    if (!subscription) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!cancelEntry) {
      openSheet();
      return;
    }
    const { url } = getCancelLink(cancelEntry);
    try {
      const supported = await Linking.canOpenURL(url);
      await Linking.openURL(supported ? url : cancelEntry.cancelUrl);
    } catch {
      try {
        await Linking.openURL(cancelEntry.cancelUrl);
      } catch {
        openSheet();
      }
    }
  }

  const cancelLink = cancelEntry ? getCancelLink(cancelEntry) : null;

  function openSheet() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    overlayOpacity.value = withTiming(1, { duration: 220 });
    setSheetOpen(true);
  }

  function closeSheet() {
    overlayOpacity.value = withTiming(0, { duration: 180 });
    setTimeout(() => setSheetOpen(false), 180);
  }

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  if (subLoading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: C.bg }}
      >
        <ActivityIndicator size="large" color={C.p500} />
      </View>
    );
  }

  if (!subscription) {
    return (
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: C.bg }}
      >
        <Text style={{ color: C.text }} className="text-lg font-bold mb-2">{t('subscriptionDetail.notFound')}</Text>
        <Text className="text-center text-sm" style={{ color: C.textDim }}>
          {t('subscriptionDetail.notFoundBody')}
        </Text>
        <Pressable onPress={() => router.back()} className="mt-6">
          <Text className="font-semibold" style={{ color: C.p500 }}>
            {t('subscriptionDetail.goBack')}
          </Text>
        </Pressable>
      </View>
    );
  }

  const nextDateFormatted = subscription.nextExpectedAt
    ? format(parseISO(subscription.nextExpectedAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })
    : '—';

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <LinearGradient
          colors={[C.p600, C.p500, C.p400, C.scheme === 'light' ? C.p300 : '#1e1b2e']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: 28,
            paddingHorizontal: 16,
            borderBottomLeftRadius: 32,
            borderBottomRightRadius: 32,
          }}
        >
          <View className="flex-row items-center gap-3 mb-4">
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
            <View className="flex-1">
              <Text className="text-white text-xl font-bold" numberOfLines={1}>
                {subscription.merchantDisplay}
              </Text>
              <Text className="text-white/60 text-xs mt-0.5">{t('subscriptionDetail.title')}</Text>
            </View>
            <StatusBadge status={subscription.status} />
          </View>

          {/* Stats row */}
          <View className="flex-row gap-3">
            <StatCard
              icon={<DollarSign size={18} color="#22c55e" />}
              label={t('subscriptionDetail.amountLabel')}
              value={formatCurrency(subscription.typicalAmount)}
              color="#22c55e"
              delay={0}
            />
            <StatCard
              icon={<Repeat size={18} color={C.p500} />}
              label={t('subDetail.cadence')}
              value={cadenceLabel(subscription.cadence)}
              color={C.p500}
              delay={60}
            />
            <StatCard
              icon={<Calendar size={18} color="#f59e0b" />}
              label={t('subDetail.nextCharge')}
              value={subscription.status === 'canceled' ? t('subStatus.canceled') : nextDateFormatted}
              color="#f59e0b"
              delay={120}
            />
          </View>
        </LinearGradient>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingTop: 20, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Post-cancel charge warning */}
          {hasPostCancelCharge && (
            <Animated.View entering={FadeInDown.springify()} className="mx-4 mb-4">
              <View
                className="flex-row items-start gap-3 rounded-2xl p-4"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(239,68,68,0.3)',
                }}
              >
                <AlertTriangle size={18} color="#ef4444" style={{ marginTop: 1 }} />
                <View className="flex-1">
                  <Text className="font-bold text-sm" style={{ color: '#ef4444' }}>
                    {t('subscriptionDetail.chargeAfterTitle')}
                  </Text>
                  <Text className="text-xs mt-1 leading-4" style={{ color: '#fca5a5' }}>
                    {t('subscriptionDetail.chargeAfterBody')}
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Action buttons */}
          <Animated.View entering={FadeInUp.delay(100).springify()} className="mx-4 mb-6 gap-3">
            {/* Primary one-tap cancel — jumps to the exact cancel destination */}
            {subscription.status !== 'canceled' && (
              <Pressable
                onPress={handleCancelNow}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  paddingVertical: 16,
                  borderRadius: 16,
                  backgroundColor: pressed ? '#dc2626' : '#ef4444',
                })}
              >
                <ExternalLink size={18} color="white" />
                <Text style={{ color: C.text }} className="font-bold text-base">
                  {cancelLink ? cancelLink.label : t('subStatus.cancelAction')}
                </Text>
              </Pressable>
            )}
            {subscription.status !== 'canceled' && cancelEntry && (
              <Text className="text-center text-xs -mt-1 mb-1" style={{ color: C.textFaint }}>
                {cancelEntry.native === 'apple'
                  ? t('subscriptionDetail.opensApple')
                  : t('subscriptionDetail.opensPage', { name: cancelEntry.displayName })}
              </Text>
            )}

            {subscription.status === 'possible' && (
              <Pressable
                onPress={() => handleStatusChange('confirmed')}
                disabled={isUpdatingStatus}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  paddingVertical: 15,
                  borderRadius: 16,
                  backgroundColor: pressed ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.15)',
                  borderWidth: 1,
                  borderColor: 'rgba(34,197,94,0.4)',
                })}
              >
                {isUpdatingStatus ? (
                  <ActivityIndicator size="small" color="#22c55e" />
                ) : (
                  <CheckCircle size={18} color="#22c55e" />
                )}
                <Text className="font-bold text-sm" style={{ color: '#22c55e' }}>
                  {t('subscriptionDetail.confirmSub')}
                </Text>
              </Pressable>
            )}

            {subscription.status !== 'canceled' && (
              <Pressable
                onPress={() => handleStatusChange('canceled')}
                disabled={isUpdatingStatus}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  paddingVertical: 15,
                  borderRadius: 16,
                  backgroundColor: pressed ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.1)',
                  borderWidth: 1,
                  borderColor: 'rgba(239,68,68,0.35)',
                })}
              >
                {isUpdatingStatus ? (
                  <ActivityIndicator size="small" color="#ef4444" />
                ) : (
                  <XCircle size={18} color="#ef4444" />
                )}
                <Text className="font-bold text-sm" style={{ color: '#ef4444' }}>
                  {t('subscriptionDetail.markCanceled')}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={openSheet}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                paddingVertical: 15,
                borderRadius: 16,
                backgroundColor: pressed ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(168,85,247,0.35)',
              })}
            >
              <ExternalLink size={18} color={C.p500} />
              <Text className="font-bold text-sm" style={{ color: C.p500 }}>
                {t('subscriptionDetail.howToCancel')}
              </Text>
              <ChevronRight size={14} color={C.p500} />
            </Pressable>
          </Animated.View>

          {/* Transaction history */}
          <Animated.View entering={FadeInUp.delay(160).springify()} className="mx-4 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text style={{ color: C.text }} className="font-bold text-base">{t('subscriptionDetail.history')}</Text>
              <Text className="text-xs" style={{ color: C.textDim }}>
                {occurrences.length} occurrence{occurrences.length !== 1 ? 's' : ''}
              </Text>
            </View>

            <View
              className="rounded-2xl overflow-hidden"
              style={{ backgroundColor: C.glass }}
            >
              {occurrences.length === 0 ? (
                <View className="items-center py-10 gap-2">
                  <Clock size={28} color="#4b5563" />
                  <Text className="text-sm" style={{ color: C.textFaint }}>
                    {t('subscriptionDetail.noOccurrences')}
                  </Text>
                </View>
              ) : (
                occurrences.map((occ, i) => (
                  <OccurrenceRow key={occ.id} occ={occ} index={i} />
                ))
              )}
            </View>
          </Animated.View>

          {/* Confidence score (if possible) */}
          {subscription.status === 'possible' && (
            <Animated.View entering={FadeInUp.delay(220).springify()} className="mx-4 mb-4">
              <View
                className="rounded-2xl p-4"
                style={{ backgroundColor: C.glass }}
              >
                <View className="flex-row justify-between mb-2">
                  <Text style={{ color: C.text }} className="font-semibold text-sm">{t('subscriptionDetail.confidence')}</Text>
                  <Text className="font-bold text-sm" style={{ color: '#f59e0b' }}>
                    {Math.round(subscription.confidenceScore)}%
                  </Text>
                </View>
                <View
                  className="h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: C.glassStrong }}
                >
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${subscription.confidenceScore}%`,
                      backgroundColor:
                        subscription.confidenceScore >= 60
                          ? '#22c55e'
                          : subscription.confidenceScore >= 40
                          ? '#f59e0b'
                          : '#ef4444',
                    }}
                  />
                </View>
                <Text className="text-xs mt-2 leading-4" style={{ color: C.textDim }}>
                  {t(occurrences.length === 1 ? 'subscriptionDetail.basedOnOne' : 'subscriptionDetail.basedOn', { count: occurrences.length })}
                </Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Cancel how-to bottom sheet overlay */}
      {sheetOpen && (
        <>
          {/* Backdrop */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
              },
              overlayStyle,
            ]}
          >
            <Pressable style={{ flex: 1 }} onPress={closeSheet} />
          </Animated.View>

          {/* Sheet */}
          <Animated.View
            entering={SlideInDown.springify().damping(18)}
            exiting={SlideOutDown.duration(200)}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: C.bgRaise,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingBottom: insets.bottom + 20,
              maxHeight: '85%',
            }}
          >
            {/* Sheet handle */}
            <View className="items-center pt-3 pb-1">
              <View
                className="w-10 h-1 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
              />
            </View>

            {/* Sheet header */}
            <View
              className="flex-row items-center justify-between px-5 py-4"
              style={{
                borderBottomWidth: 1,
                borderBottomColor: C.glassBorder,
              }}
            >
              <Text style={{ color: C.text }} className="font-bold text-lg">
                {t('subscriptionDetail.howToCancel')}
              </Text>
              <Pressable
                onPress={closeSheet}
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: C.glassStrong }}
              >
                <X size={16} color="white" />
              </Pressable>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 20, gap: 20 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {cancelEntry ? (
                <>
                  {/* Steps */}
                  <View className="gap-3">
                    <Text style={{ color: C.text }} className="font-semibold text-sm mb-1">
                      {t('subscriptionDetail.stepsTo', { name: cancelEntry.displayName })}
                    </Text>
                    {cancelEntry.steps.map((step, i) => (
                      <View key={i} className="flex-row gap-3 items-start">
                        <View
                          className="w-6 h-6 rounded-full items-center justify-center shrink-0 mt-0.5"
                          style={{ backgroundColor: 'rgba(168,85,247,0.2)' }}
                        >
                          <Text className="text-xs font-bold" style={{ color: C.p500 }}>
                            {i + 1}
                          </Text>
                        </View>
                        <Text className="text-sm leading-5 flex-1" style={{ color: '#d1d5db' }}>
                          {step}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Open cancel page button */}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      Linking.openURL(cancelEntry.cancelUrl);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      paddingVertical: 14,
                      borderRadius: 14,
                      backgroundColor: pressed ? 'rgba(168,85,247,0.25)' : 'rgba(168,85,247,0.15)',
                      borderWidth: 1,
                      borderColor: 'rgba(168,85,247,0.4)',
                    })}
                  >
                    <Globe size={16} color={C.p500} />
                    <Text className="font-bold text-sm" style={{ color: C.p500 }}>
                      {t('subscriptionDetail.openCancelPage')}
                    </Text>
                    <ExternalLink size={13} color={C.p500} />
                  </Pressable>
                </>
              ) : (
                /* Not in directory — web search fallback */
                <View className="gap-4">
                  <View
                    className="rounded-2xl p-4"
                    style={{ backgroundColor: C.glass }}
                  >
                    <Text style={{ color: C.text }} className="font-semibold text-sm mb-1">
                      {t('subscriptionDetail.notInDirectory')}
                    </Text>
                    <Text className="text-sm leading-5" style={{ color: C.textDim }}>
                      {t('subscriptionDetail.noSteps', { name: subscription.merchantDisplay })}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const query = encodeURIComponent(
                        t('subscriptionDetail.searchQuery', { name: subscription.merchantDisplay })
                      );
                      Linking.openURL(`https://www.google.com/search?q=${query}`);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      paddingVertical: 14,
                      borderRadius: 14,
                      backgroundColor: pressed ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.1)',
                      borderWidth: 1,
                      borderColor: 'rgba(168,85,247,0.3)',
                    })}
                  >
                    <Globe size={16} color={C.p500} />
                    <Text className="font-semibold text-sm" style={{ color: C.p500 }}>
                      {t('subscriptionDetail.searchHow', { name: subscription.merchantDisplay })}
                    </Text>
                  </Pressable>

                  {/* Draft a cancellation email the user can send to the merchant */}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const subj = encodeURIComponent(
                        t('subscriptionDetail.emailSubject', { name: subscription.merchantDisplay })
                      );
                      const body = encodeURIComponent(
                        t('subscriptionDetail.emailBody', { name: subscription.merchantDisplay })
                      );
                      Linking.openURL(`mailto:?subject=${subj}&body=${body}`);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      paddingVertical: 14,
                      borderRadius: 14,
                      backgroundColor: pressed ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
                      borderWidth: 1,
                      borderColor: C.glassBorder,
                    })}
                  >
                    <ExternalLink size={16} color="#9ca3af" />
                    <Text className="font-semibold text-sm" style={{ color: C.textDim }}>
                      {t('subscriptionDetail.draftEmail')}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Cancel notes */}
              <View className="gap-3">
                <Text style={{ color: C.text }} className="font-semibold text-sm">{t('subscriptionDetail.yourNotes')}</Text>
                <TextInput
                  value={cancelNotes}
                  onChangeText={setCancelNotes}
                  placeholder={t('subDetail.notesHint')}
                  placeholderTextColor="#6b7280"
                  multiline
                  numberOfLines={4}
                  style={{
                    backgroundColor: C.glassStrong,
                    borderRadius: 14,
                    padding: 14,
                    color: 'white',
                    fontSize: 14,
                    lineHeight: 20,
                    minHeight: 100,
                    textAlignVertical: 'top',
                    borderWidth: 1,
                    borderColor: C.glassBorder,
                  }}
                />
                <Pressable
                  onPress={handleSaveNotes}
                  disabled={isSavingNotes}
                  style={({ pressed }) => ({
                    paddingVertical: 14,
                    borderRadius: 14,
                    alignItems: 'center',
                    backgroundColor: pressed ? '#9333ea' : C.p600,
                  })}
                >
                  {isSavingNotes ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: C.text }} className="font-bold text-sm">{t('subscriptionDetail.saveNotes')}</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Animated.View>
        </>
      )}
    </ScreenBackground>
  );
}
