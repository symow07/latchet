import {
  View, Text, ScrollView, Pressable, Modal,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, Wrench, AlertCircle, ChevronDown, ChevronUp,
  ExternalLink, CalendarClock, TrendingDown, X, Info,
  RefreshCw, Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, router } from 'expo-router';
import { getExpenses } from '@/lib/expenseApi';
import {
  detectSubscriptions,
  formatNextCharge,
  type DetectedSubscription,
} from '@/lib/business-subscription-detection';

// ─── Cancel Guide Modal ─────────────────────────────────────────────────────────

function CancelGuideModal({
  sub,
  visible,
  onClose,
}: {
  sub: DetectedSubscription | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!sub) return null;

  const daysUntil = Math.round(
    (new Date(sub.nextChargeDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
        onPress={onClose}
      />
      <View style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        backgroundColor: '#0d1828',
        borderTopLeftRadius: 32, borderTopRightRadius: 32,
        borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)',
        paddingBottom: 48,
      }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 24 }}
        >
          {/* Handle */}
          <View style={{ width: 40, height: 4, backgroundColor: '#1e3a5f', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#60a5fa', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 }}>HOW TO CANCEL</Text>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{sub.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={22} color="#4b5563" />
            </Pressable>
          </View>

          {/* Cost summary */}
          <View style={{
            backgroundColor: 'rgba(248,113,113,0.08)',
            borderRadius: 18, padding: 16, marginBottom: 16,
            borderWidth: 1, borderColor: 'rgba(248,113,113,0.15)',
            flexDirection: 'row', alignItems: 'center',
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '600', letterSpacing: 0.8 }}>MONTHLY COST</Text>
              <Text style={{ color: '#f87171', fontSize: 26, fontWeight: '800', marginTop: 2 }}>${sub.amount.toFixed(2)}</Text>
              <Text style={{ color: '#4b5563', fontSize: 12, marginTop: 2 }}>
                ${(sub.amount * 12).toFixed(0)}/year
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: '#4b5563', fontSize: 11 }}>Next charge</Text>
              <Text style={{ color: daysUntil <= 7 ? '#fbbf24' : '#9ca3af', fontSize: 14, fontWeight: '700', marginTop: 2 }}>
                {formatNextCharge(sub.nextChargeDate)}
              </Text>
            </View>
          </View>

          {/* Steps */}
          <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 }}>CANCELLATION STEPS</Text>

          <View style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: 18, padding: 18, marginBottom: 16,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
          }}>
            {/* Step 1 */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(96,165,250,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '800' }}>1</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600', marginBottom: 2 }}>Go to the billing page</Text>
                <Text style={{ color: '#6b7280', fontSize: 12, lineHeight: 18 }}>{sub.cancelInstructions}</Text>
              </View>
            </View>

            {/* Step 2 */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(96,165,250,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '800' }}>2</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600', marginBottom: 2 }}>Confirm cancellation</Text>
                <Text style={{ color: '#6b7280', fontSize: 12, lineHeight: 18 }}>Look for "Cancel plan", "Downgrade", or "End subscription". Some services hide this in advanced settings.</Text>
              </View>
            </View>

            {/* Step 3 */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(96,165,250,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '800' }}>3</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600', marginBottom: 2 }}>Get confirmation</Text>
                <Text style={{ color: '#6b7280', fontSize: 12, lineHeight: 18 }}>Save the cancellation confirmation email. Check your payment method to ensure no future charges occur.</Text>
              </View>
            </View>
          </View>

          {/* Tip */}
          <View style={{
            backgroundColor: 'rgba(251,191,36,0.08)',
            borderRadius: 14, padding: 14, marginBottom: 20,
            borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)',
            flexDirection: 'row', gap: 10,
          }}>
            <Info size={16} color="#fbbf24" style={{ marginTop: 1 }} />
            <Text style={{ color: '#fbbf24', fontSize: 12, lineHeight: 18, flex: 1 }}>
              Cancel before {new Date(sub.nextChargeDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} to avoid being charged ${sub.amount.toFixed(2)} again.
            </Text>
          </View>

          {/* Open website button */}
          {sub.cancelUrl && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                if (sub.cancelUrl) Linking.openURL(sub.cancelUrl);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <LinearGradient
                colors={['#1d4ed8', '#3b82f6']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ borderRadius: 18, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
              >
                <ExternalLink size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Open Billing Page</Text>
              </LinearGradient>
            </Pressable>
          )}

          {!sub.cancelUrl && (
            <View style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: 18, paddingVertical: 16, alignItems: 'center',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
            }}>
              <Text style={{ color: '#4b5563', fontSize: 14 }}>Search for "{sub.name} cancel subscription"</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Subscription Card ──────────────────────────────────────────────────────────

function SubscriptionCard({
  sub,
  onCancelGuide,
}: {
  sub: DetectedSubscription;
  onCancelGuide: (sub: DetectedSubscription) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const daysUntil = Math.round(
    (new Date(sub.nextChargeDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  const isUrgent = daysUntil <= 7 && daysUntil >= 0;
  const isOverdue = daysUntil < 0;

  return (
    <View style={{
      backgroundColor: isUrgent ? 'rgba(251,191,36,0.04)' : 'rgba(255,255,255,0.04)',
      borderRadius: 20, marginBottom: 10,
      borderWidth: 1,
      borderColor: isUrgent ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.07)',
      overflow: 'hidden',
    }}>
      {/* Main row */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setExpanded(v => !v);
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, padding: 16 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Icon */}
          <View style={{
            width: 44, height: 44, borderRadius: 14,
            backgroundColor: 'rgba(96,165,250,0.12)',
            borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)',
            alignItems: 'center', justifyContent: 'center',
            marginRight: 13,
          }}>
            <Wrench size={20} color="#60a5fa" />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
              {sub.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {sub.isRecurring && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <RefreshCw size={9} color="#22c55e" />
                  <Text style={{ color: '#22c55e', fontSize: 10, fontWeight: '700' }}>RECURRING</Text>
                </View>
              )}
              <Text style={{ color: '#374151', fontSize: 10 }}>{sub.category}</Text>
            </View>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              ${sub.amount.toFixed(2)}
              <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '500' }}>/mo</Text>
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {isUrgent && <AlertCircle size={10} color="#fbbf24" />}
              <Text style={{ color: isUrgent ? '#fbbf24' : isOverdue ? '#ef4444' : '#4b5563', fontSize: 10, fontWeight: '600' }}>
                {formatNextCharge(sub.nextChargeDate)}
              </Text>
            </View>
          </View>

          <View style={{ marginLeft: 10 }}>
            {expanded ? <ChevronUp size={16} color="#4b5563" /> : <ChevronDown size={16} color="#4b5563" />}
          </View>
        </View>
      </Pressable>

      {/* Expanded detail */}
      {expanded && (
        <View style={{
          borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
          paddingHorizontal: 16, paddingVertical: 14,
          backgroundColor: 'rgba(0,0,0,0.15)',
        }}>
          <View style={{ flexDirection: 'row', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 }}>ANNUAL COST</Text>
              <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '700' }}>${(sub.amount * 12).toFixed(0)}/yr</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 }}>LAST CHARGED</Text>
              <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '700' }}>
                {new Date(sub.lastChargeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>
            {sub.isRecurring && (
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 }}>MONTHS SEEN</Text>
                <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '700' }}>{sub.monthlyCount}×</Text>
              </View>
            )}
          </View>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onCancelGuide(sub);
            }}
            style={({ pressed }) => ({
              opacity: pressed ? 0.75 : 1,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 6, paddingVertical: 10, borderRadius: 12,
              backgroundColor: 'rgba(248,113,113,0.1)',
              borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
            })}
          >
            <X size={13} color="#f87171" />
            <Text style={{ color: '#f87171', fontSize: 13, fontWeight: '700' }}>How to Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────────

export default function BusinessToolsScreen() {
  const insets = useSafeAreaInsets();
  const [cancelSub, setCancelSub] = useState<DetectedSubscription | null>(null);

  const { data: allExpenses = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['biz-expenses', undefined],
    queryFn: () => getExpenses(),
  });

  useFocusEffect(useCallback(() => {
    refetch();
  }, [refetch]));

  const summary = detectSubscriptions(allExpenses);
  const { subscriptions, upcoming, monthlyTotal, annualTotal } = summary;

  return (
    <View style={{ flex: 1, backgroundColor: '#060d18' }}>
      <CancelGuideModal
        sub={cancelSub}
        visible={!!cancelSub}
        onClose={() => setCancelSub(null)}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#60a5fa" />}
      >
        {/* ── Header ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: 14 }}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'flex-start' })}
          >
            <ArrowLeft size={18} color="#60a5fa" />
            <Text style={{ color: '#60a5fa', fontSize: 14, fontWeight: '600' }}>Dashboard</Text>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>BUSINESS</Text>
              <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 2 }}>Tools & Subscriptions</Text>
            </View>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(96,165,250,0.12)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.25)', alignItems: 'center', justifyContent: 'center' }}>
              <Wrench size={20} color="#60a5fa" />
            </View>
          </View>
        </View>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <ActivityIndicator color="#60a5fa" size="large" />
          </View>
        ) : subscriptions.length === 0 ? (
          /* ── Empty state ── */
          <View style={{ marginHorizontal: 20, marginTop: 40 }}>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
              <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: 'rgba(96,165,250,0.1)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Wrench size={32} color="#1e3a5f" />
              </View>
              <Text style={{ color: '#4b5563', fontSize: 16, fontWeight: '700', marginBottom: 6 }}>No subscriptions detected</Text>
              <Text style={{ color: '#1f2937', fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
                Submit software or recurring expenses to start tracking your business tools here.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* ── Summary banner ── */}
            <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
              <LinearGradient
                colors={['#060e1f', '#0c1e3d']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 26, padding: 24, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 6 }}>
                      MONTHLY TOOL SPEND
                    </Text>
                    <Text style={{ color: '#fff', fontSize: 40, fontWeight: '800', lineHeight: 44 }}>
                      ${monthlyTotal.toFixed(2)}
                    </Text>
                    <Text style={{ color: '#4b5563', fontSize: 12, marginTop: 4 }}>
                      {subscriptions.length} tool{subscriptions.length !== 1 ? 's' : ''} · ${annualTotal.toFixed(0)}/year
                    </Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: 'rgba(96,165,250,0.12)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <TrendingDown size={22} color="#f87171" />
                    </View>
                    <Text style={{ color: '#f87171', fontSize: 11, fontWeight: '700' }}>per month</Text>
                  </View>
                </View>

                {/* Mini stats */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[
                    { label: 'TOOLS', value: `${subscriptions.length}`, color: '#60a5fa' },
                    { label: 'RECURRING', value: `${subscriptions.filter(s => s.isRecurring).length}`, color: '#22c55e' },
                    { label: 'DUE SOON', value: `${upcoming.length}`, color: upcoming.length > 0 ? '#fbbf24' : '#4b5563' },
                  ].map(stat => (
                    <View key={stat.label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 12, alignItems: 'center' }}>
                      <Text style={{ color: stat.color, fontSize: 18, fontWeight: '800' }}>{stat.value}</Text>
                      <Text style={{ color: '#374151', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 2 }}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </View>

            {/* ── Upcoming charges ── */}
            {upcoming.length > 0 && (
              <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                  <CalendarClock size={14} color="#fbbf24" />
                  <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 }}>
                    UPCOMING CHARGES ({upcoming.length})
                  </Text>
                </View>
                <View style={{ backgroundColor: 'rgba(251,191,36,0.05)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(251,191,36,0.15)', overflow: 'hidden' }}>
                  {upcoming.map((sub, i) => (
                    <View
                      key={sub.key}
                      style={{
                        flexDirection: 'row', alignItems: 'center', padding: 14,
                        borderBottomWidth: i < upcoming.length - 1 ? 1 : 0,
                        borderBottomColor: 'rgba(251,191,36,0.08)',
                      }}
                    >
                      <Zap size={14} color="#fbbf24" style={{ marginRight: 10 }} />
                      <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                        {sub.name}
                      </Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: '#fbbf24', fontSize: 14, fontWeight: '800' }}>
                          ${sub.amount.toFixed(2)}
                        </Text>
                        <Text style={{ color: '#4b5563', fontSize: 10, marginTop: 2 }}>
                          {formatNextCharge(sub.nextChargeDate)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ── All Tools ── */}
            <View style={{ paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <Wrench size={13} color="#4b5563" />
                <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 }}>
                  ALL TOOLS ({subscriptions.length})
                </Text>
              </View>
              {subscriptions.map(sub => (
                <SubscriptionCard
                  key={sub.key}
                  sub={sub}
                  onCancelGuide={setCancelSub}
                />
              ))}
            </View>

            {/* ── General Cancel Guidance ── */}
            <View style={{ marginHorizontal: 20, marginTop: 12 }}>
              <View style={{
                backgroundColor: 'rgba(96,165,250,0.05)',
                borderRadius: 20, padding: 18,
                borderWidth: 1, borderColor: 'rgba(96,165,250,0.12)',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Info size={15} color="#60a5fa" />
                  <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>CANCELLATION TIP</Text>
                </View>
                <Text style={{ color: '#6b7280', fontSize: 13, lineHeight: 20 }}>
                  Most SaaS tools let you cancel from{' '}
                  <Text style={{ color: '#9ca3af', fontWeight: '600' }}>Settings → Billing</Text>
                  . Cancel{' '}
                  <Text style={{ color: '#9ca3af', fontWeight: '600' }}>at least 24 hours before</Text>
                  {' '}the next renewal date to avoid being charged. Always request a cancellation confirmation email.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
