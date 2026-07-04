import {
  View, ScrollView, Pressable, Modal,
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
import { getEmailDetectedForBusiness } from '@/lib/emailSubscriptionApi';
import { EmailScanCard } from '@/components/EmailScanCard';
import { B, R, glow } from '@/lib/design';
import { Txt, GlassCard, IconBubble, BizBackground, BubbleButton } from '@/components/ui';

// ─── Cancel Guide Modal ─────────────────────────────────────────────────────────
function CancelGuideModal({ sub, visible, onClose }: { sub: DetectedSubscription | null; visible: boolean; onClose: () => void }) {
  if (!sub) return null;
  const steps = [
    { t: 'Go to the billing page', d: sub.cancelInstructions },
    { t: 'Confirm cancellation', d: 'Look for "Cancel plan", "Downgrade", or "End subscription". Some services hide this in advanced settings.' },
    { t: 'Get confirmation', d: 'Save the cancellation confirmation email. Check your payment method to ensure no future charges occur.' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: B.slate900, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: `${B.accent}26`, paddingBottom: 44 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 22 }}>
          <View style={{ width: 40, height: 4, backgroundColor: B.slate700, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={11} color={B.accent} style={{ letterSpacing: 1.2, marginBottom: 4 }}>HOW TO CANCEL</Txt>
              <Txt weight="bold" size={20} color={B.text} numberOfLines={2}>{sub.name}</Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><X size={22} color={B.textFaint} /></Pressable>
          </View>

          <GlassCard padding={16} radius={R.md} tint={`${B.red}0e`} border={`${B.red}26`} style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Txt weight="semibold" size={11} color={B.textDim} style={{ letterSpacing: 0.8 }}>MONTHLY COST</Txt>
              <Txt weight="bold" size={26} color={B.red} style={{ marginTop: 2 }}>${sub.amount.toFixed(2)}</Txt>
              <Txt size={12} color={B.textFaint} style={{ marginTop: 2 }}>${(sub.amount * 12).toFixed(0)}/year</Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt size={11} color={B.textFaint}>Next charge</Txt>
              <Txt weight="bold" size={14} color={B.amber} style={{ marginTop: 2 }}>{formatNextCharge(sub.nextChargeDate)}</Txt>
            </View>
          </GlassCard>

          <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 12 }}>CANCELLATION STEPS</Txt>
          <GlassCard padding={18} radius={R.md} style={{ marginBottom: 16 }}>
            {steps.map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: i < steps.length - 1 ? 16 : 0 }}>
                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${B.accent}1f`, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt weight="bold" size={12} color={B.accent}>{i + 1}</Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" size={14} color={B.text} style={{ marginBottom: 2 }}>{s.t}</Txt>
                  <Txt size={12} color={B.textDim} style={{ lineHeight: 18 }}>{s.d}</Txt>
                </View>
              </View>
            ))}
          </GlassCard>

          <GlassCard padding={14} radius={R.sm} tint={`${B.amber}0e`} border={`${B.amber}2a`} style={{ marginBottom: 20, flexDirection: 'row', gap: 10 }}>
            <Info size={16} color={B.amber} style={{ marginTop: 1 }} />
            <Txt size={12} color={B.amber} style={{ lineHeight: 18, flex: 1 }}>
              Cancel before {new Date(sub.nextChargeDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} to avoid being charged ${sub.amount.toFixed(2)} again.
            </Txt>
          </GlassCard>

          {sub.cancelUrl ? (
            <BubbleButton label="Open Billing Page" icon={<ExternalLink size={16} color="#fff" />} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); if (sub.cancelUrl) Linking.openURL(sub.cancelUrl); }} radius={R.md} colors={[B.accentDeep, B.accent]} glowColor={B.accent} />
          ) : (
            <GlassCard padding={16} radius={R.md} style={{ alignItems: 'center' }}>
              <Txt size={14} color={B.textFaint}>Search for "{sub.name} cancel subscription"</Txt>
            </GlassCard>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Subscription Card ──────────────────────────────────────────────────────────
function SubscriptionCard({ sub, onCancelGuide }: { sub: DetectedSubscription; onCancelGuide: (sub: DetectedSubscription) => void }) {
  const [expanded, setExpanded] = useState(false);
  const daysUntil = Math.round((new Date(sub.nextChargeDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const isUrgent = daysUntil <= 7 && daysUntil >= 0;
  const isOverdue = daysUntil < 0;

  return (
    <GlassCard padding={0} radius={R.lg} tint={isUrgent ? `${B.amber}0a` : B.glass} border={isUrgent ? `${B.amber}2a` : B.glassBorder} style={{ overflow: 'hidden' }}>
      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpanded(v => !v); }} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, padding: 16 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconBubble color={B.accent} size={44} radius={14} style={{ marginRight: 13 }}><Wrench size={20} color={B.accent} /></IconBubble>
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={15} color={B.text} numberOfLines={1}>{sub.name}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {sub.isRecurring && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <RefreshCw size={9} color={B.teal} />
                  <Txt weight="bold" size={10} color={B.teal}>RECURRING</Txt>
                </View>
              )}
              <Txt size={10} color={B.textFaint}>{sub.category}</Txt>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Txt weight="bold" size={16} color={B.text}>${sub.amount.toFixed(2)}<Txt size={11} color={B.textFaint}>/mo</Txt></Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {isUrgent && <AlertCircle size={10} color={B.amber} />}
              <Txt weight="semibold" size={10} color={isUrgent ? B.amber : isOverdue ? B.red : B.textFaint}>{formatNextCharge(sub.nextChargeDate)}</Txt>
            </View>
          </View>
          <View style={{ marginLeft: 10 }}>
            {expanded ? <ChevronUp size={16} color={B.textFaint} /> : <ChevronDown size={16} color={B.textFaint} />}
          </View>
        </View>
      </Pressable>

      {expanded && (
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.15)' }}>
          <View style={{ flexDirection: 'row', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.8, marginBottom: 4 }}>ANNUAL COST</Txt>
              <Txt weight="bold" size={15} color={B.text}>${(sub.amount * 12).toFixed(0)}/yr</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.8, marginBottom: 4 }}>LAST CHARGED</Txt>
              <Txt weight="bold" size={15} color={B.text}>{new Date(sub.lastChargeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Txt>
            </View>
            {sub.isRecurring && (
              <View style={{ flex: 1 }}>
                <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.8, marginBottom: 4 }}>MONTHS SEEN</Txt>
                <Txt weight="bold" size={15} color={B.text}>{sub.monthlyCount}×</Txt>
              </View>
            )}
          </View>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onCancelGuide(sub); }} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: `${B.red}14`, borderWidth: 1, borderColor: `${B.red}2a` })}>
            <X size={13} color={B.red} />
            <Txt weight="bold" size={13} color={B.red}>How to Cancel</Txt>
          </Pressable>
        </View>
      )}
    </GlassCard>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────────
export default function BusinessToolsScreen() {
  const insets = useSafeAreaInsets();
  const [cancelSub, setCancelSub] = useState<DetectedSubscription | null>(null);

  const { data: allExpenses = [], isLoading, refetch, isRefetching } = useQuery({ queryKey: ['biz-expenses', undefined], queryFn: () => getExpenses() });
  const { data: emailDetected = [], refetch: refetchEmail } = useQuery({ queryKey: ['email-detected-biz'], queryFn: getEmailDetectedForBusiness });

  useFocusEffect(useCallback(() => { refetch(); refetchEmail(); }, [refetch, refetchEmail]));

  const summary = detectSubscriptions(allExpenses);
  const expenseNames = new Set(summary.subscriptions.map(s => s.name.toLowerCase()));
  const emailOnly = emailDetected.filter(s => !expenseNames.has(s.name.toLowerCase()));
  const subscriptions = [...summary.subscriptions, ...emailOnly].sort((a, b) => b.amount - a.amount);
  const monthlyTotal = subscriptions.reduce((sum, s) => sum + s.amount, 0);
  const annualTotal = monthlyTotal * 12;
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 86400000);
  const upcoming = subscriptions.filter(s => { const next = new Date(s.nextChargeDate); return next >= now && next <= in30Days; });

  return (
    <BizBackground>
      <CancelGuideModal sub={cancelSub} visible={!!cancelSub} onClose={() => setCancelSub(null)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: 14 }}>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'flex-start' })}>
            <ArrowLeft size={18} color={B.accent} />
            <Txt weight="semibold" size={14} color={B.accent}>Dashboard</Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>BUSINESS</Txt>
              <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>Tools & Subscriptions</Txt>
            </View>
            <IconBubble color={B.accent} size={44} radius={14}><Wrench size={20} color={B.accent} /></IconBubble>
          </View>
        </View>

        {/* Email scanner */}
        <EmailScanCard accent={B.accent} />

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}><ActivityIndicator color={B.accent} size="large" /></View>
        ) : subscriptions.length === 0 ? (
          <View style={{ marginHorizontal: 20, marginTop: 30 }}>
            <GlassCard padding={40} radius={R.xl} style={{ alignItems: 'center' }}>
              <IconBubble color={B.accent} size={72} radius={24} style={{ marginBottom: 16 }}><Wrench size={32} color={B.slate700} /></IconBubble>
              <Txt weight="bold" size={16} color={B.textDim} style={{ marginBottom: 6 }}>No subscriptions detected</Txt>
              <Txt size={13} color={B.textFaint} style={{ textAlign: 'center', lineHeight: 19 }}>Submit software or recurring expenses to start tracking your business tools here.</Txt>
            </GlassCard>
          </View>
        ) : (
          <>
            {/* Summary banner */}
            <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
              <LinearGradient colors={[B.slate800, '#102a4a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: R.lg, padding: 24, borderWidth: 1, borderColor: `${B.accent}2a` }, glow(B.accentDeep, 0.25, 22)]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View>
                    <Txt weight="semibold" size={12} color="rgba(255,255,255,0.4)" style={{ letterSpacing: 1, marginBottom: 6 }}>MONTHLY TOOL SPEND</Txt>
                    <Txt weight="bold" size={40} color="#fff" style={{ lineHeight: 44 }}>${monthlyTotal.toFixed(2)}</Txt>
                    <Txt size={12} color={B.textFaint} style={{ marginTop: 4 }}>{subscriptions.length} tool{subscriptions.length !== 1 ? 's' : ''} · ${annualTotal.toFixed(0)}/year</Txt>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: `${B.accent}1f`, borderWidth: 1.5, borderColor: `${B.accent}33`, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <TrendingDown size={22} color={B.red} />
                    </View>
                    <Txt weight="bold" size={11} color={B.red}>per month</Txt>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[
                    { label: 'TOOLS', value: `${subscriptions.length}`, color: B.accent },
                    { label: 'RECURRING', value: `${subscriptions.filter(s => s.isRecurring).length}`, color: B.teal },
                    { label: 'DUE SOON', value: `${upcoming.length}`, color: upcoming.length > 0 ? B.amber : B.textFaint },
                  ].map(stat => (
                    <View key={stat.label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 12, alignItems: 'center' }}>
                      <Txt weight="bold" size={18} color={stat.color}>{stat.value}</Txt>
                      <Txt weight="bold" size={9} color={B.textFaint} style={{ letterSpacing: 0.8, marginTop: 2 }}>{stat.label}</Txt>
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </View>

            {/* Upcoming */}
            {upcoming.length > 0 && (
              <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                  <CalendarClock size={14} color={B.amber} />
                  <Txt weight="bold" size={11} color={B.amber} style={{ letterSpacing: 1.2 }}>UPCOMING CHARGES ({upcoming.length})</Txt>
                </View>
                <GlassCard padding={0} radius={R.lg} tint={`${B.amber}0a`} border={`${B.amber}26`} style={{ overflow: 'hidden' }}>
                  {upcoming.map((sub, i) => (
                    <View key={sub.key} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: i < upcoming.length - 1 ? 1 : 0, borderBottomColor: `${B.amber}14` }}>
                      <Zap size={14} color={B.amber} style={{ marginRight: 10 }} />
                      <Txt weight="semibold" size={14} color={B.text} style={{ flex: 1 }} numberOfLines={1}>{sub.name}</Txt>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Txt weight="bold" size={14} color={B.amber}>${sub.amount.toFixed(2)}</Txt>
                        <Txt size={10} color={B.textFaint} style={{ marginTop: 2 }}>{formatNextCharge(sub.nextChargeDate)}</Txt>
                      </View>
                    </View>
                  ))}
                </GlassCard>
              </View>
            )}

            {/* All tools */}
            <View style={{ paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <Wrench size={13} color={B.textFaint} />
                <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2 }}>ALL TOOLS ({subscriptions.length})</Txt>
              </View>
              <View style={{ gap: 10 }}>
                {subscriptions.map(sub => <SubscriptionCard key={sub.key} sub={sub} onCancelGuide={setCancelSub} />)}
              </View>
            </View>

            {/* Tip */}
            <View style={{ marginHorizontal: 20, marginTop: 12 }}>
              <GlassCard padding={18} radius={R.lg} tint={`${B.accent}0c`} border={`${B.accent}22`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Info size={15} color={B.accent} />
                  <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 0.8 }}>CANCELLATION TIP</Txt>
                </View>
                <Txt size={13} color={B.textDim} style={{ lineHeight: 20 }}>
                  Most SaaS tools let you cancel from <Txt weight="semibold" size={13} color={B.text}>Settings → Billing</Txt>. Cancel <Txt weight="semibold" size={13} color={B.text}>at least 24 hours before</Txt> the next renewal date to avoid being charged. Always request a cancellation confirmation email.
                </Txt>
              </GlassCard>
            </View>
          </>
        )}
      </ScrollView>
    </BizBackground>
  );
}
