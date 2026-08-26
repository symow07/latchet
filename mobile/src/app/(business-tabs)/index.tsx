import { View, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  TrendingDown, DollarSign, Briefcase, Clock,
  Wrench, ChevronRight, AlertCircle,
} from 'lucide-react-native';
import { useSession } from '@/lib/auth/use-session';
import { useQuery } from '@tanstack/react-query';
import { getExpenses } from '@/lib/expenseApi';
import { getBusiness } from '@/lib/businessApi';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { detectSubscriptions } from '@/lib/business-subscription-detection';
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground } from '@/components/ui';
import { t } from '@/lib/i18n/core';
import { expenseCategoryLabel } from '@/lib/expense-meta';

function Label({ children }: { children: string }) {
  const B = useB();
  return <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.4, marginBottom: 12 }}>{children}</Txt>;
}

export default function BusinessDashboardTab() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';

  const { data: allExpenses = [], isLoading } = useQuery({ queryKey: ['biz-expenses', undefined], queryFn: () => getExpenses() });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });

  const myRole = business?.teamMembers.find(m => m.userId === session?.user?.id)?.role;
  const canReview = myRole === 'owner' || myRole === 'manager';

  const totalExpenses = allExpenses.reduce((s, e) => s + e.amount, 0);
  const approved = allExpenses.filter(e => e.status === 'approved');
  const pending = allExpenses.filter(e => e.status === 'pending');
  const rejected = allExpenses.filter(e => e.status === 'rejected');
  const approvedTotal = approved.reduce((s, e) => s + e.amount, 0);
  const recentExpenses = allExpenses.slice(0, 5);

  const subSummary = detectSubscriptions(allExpenses);

  const metrics = [
    { label: t('bizStats.totalSubmitted'), value: `$${totalExpenses.toFixed(0)}`, sub: t('bizStats.expenseCount', { count: allExpenses.length }), accent: B.red },
    { label: t('bizStats.approved'), value: `$${approvedTotal.toFixed(0)}`, sub: t('bizStats.approvedCount', { count: approved.length }), accent: B.teal },
    { label: t('bizStats.pendingReview'), value: `${pending.length}`, sub: canReview ? t('bizStats.needsReview') : t('bizStats.awaitingReview'), accent: B.amber },
    { label: t('bizStats.rejected'), value: `${rejected.length}`, sub: t('bizStats.rejectedCount', { count: rejected.length }), accent: B.textDim },
  ];

  const statusColor: Record<string, string> = { pending: B.amber, approved: B.teal, rejected: B.red };

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>{t('business.label')}</Txt>
            <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>{t('bizStats.greeting', { name: firstName })}</Txt>
          </View>
          <IconBubble color={B.accent} size={42} radius={14}><Briefcase size={19} color={B.accent} /></IconBubble>
        </View>

        {/* Business balance banner */}
        <Animated.View entering={FadeInUp.delay(40).springify().damping(16)} style={{ marginHorizontal: 20, marginBottom: 20 }}>
          <LinearGradient
            colors={[B.heroFrom, B.heroTo]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[{ borderRadius: R.lg, padding: 22, borderWidth: 1, borderColor: `${B.accent}33` }, glow(B.accentDeep, 0.3, 22, B.glowScale)]}
          >
            <Txt weight="semibold" size={12} color="rgba(255,255,255,0.5)" style={{ letterSpacing: 1, marginBottom: 6 }}>
              {business?.name?.toUpperCase() ?? t('bizStats.yourBusiness')}
            </Txt>
            {isLoading ? (
              <ActivityIndicator color={B.accent} size="small" style={{ alignSelf: 'flex-start', marginVertical: 6 }} />
            ) : (
              <Txt weight="bold" size={38} color="#fff" style={{ marginBottom: 4 }}>${approvedTotal.toFixed(2)}</Txt>
            )}
            <Txt weight="semibold" size={13} color={B.accentSoft}>
              {pending.length > 0 && canReview
                ? t('bizStats.expensesWaiting', { count: pending.length })
                : approved.length > 0 ? t('bizStats.totalApprovedExpenses') : t('bizStats.noExpensesYet')}
            </Txt>
          </LinearGradient>
        </Animated.View>

        {/* Metrics */}
        <Animated.View entering={FadeInUp.delay(80).springify().damping(16)} style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Label>{t('business.overview')}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {metrics.map(m => (
              <GlassCard key={m.label} style={{ width: '47.5%' }} padding={16} radius={R.md} tint={`${m.accent}12`} border={`${m.accent}26`}>
                <Txt weight="bold" size={22} color={m.accent} style={{ marginBottom: 2 }}>{m.value}</Txt>
                <Txt weight="semibold" size={12} color={B.textDim}>{m.label}</Txt>
                <Txt size={11} color={B.textFaint} style={{ marginTop: 1 }}>{m.sub}</Txt>
              </GlassCard>
            ))}
          </View>
        </Animated.View>

        {/* Quick actions */}
        <Animated.View entering={FadeInUp.delay(120).springify().damping(16)} style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Label>{t('business.quickActions')}</Label>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(business-tabs)/expenses'); }} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1 })}>
              <GlassCard padding={14} radius={R.md} tint={`${B.accent}0e`} border={`${B.accent}24`} style={{ alignItems: 'center', gap: 8 }}>
                <IconBubble color={B.red} size={40}><TrendingDown size={18} color={B.red} /></IconBubble>
                <Txt weight="semibold" size={11} color={B.textDim}>{t('business.addExpense')}</Txt>
              </GlassCard>
            </Pressable>
            {canReview && pending.length > 0 && (
              <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(business-tabs)/expenses'); }} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1 })}>
                <GlassCard padding={14} radius={R.md} tint={`${B.amber}0e`} border={`${B.amber}2e`} style={{ alignItems: 'center', gap: 8 }}>
                  <IconBubble color={B.amber} size={40}><Clock size={18} color={B.amber} /></IconBubble>
                  <Txt weight="semibold" size={11} color={B.textDim}>{t('bizStats.reviewCount', { count: pending.length })}</Txt>
                </GlassCard>
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* Tools & subscriptions */}
        <Animated.View entering={FadeInUp.delay(150).springify().damping(16)} style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Label>{t('business.tools')}</Label>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/business-tools'); }} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <GlassCard padding={20} radius={R.lg} tint={B.slate900} border={`${B.accent}22`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <IconBubble color={B.accent} size={40} radius={13} style={{ marginRight: 12 }}><Wrench size={18} color={B.accent} /></IconBubble>
                <View style={{ flex: 1 }}>
                  <Txt weight="bold" size={15} color={B.text}>{t('business.businessTools')}</Txt>
                  <Txt size={12} color={B.textFaint} style={{ marginTop: 1 }}>
                    {subSummary.subscriptions.length > 0 ? t('bizStats.toolsDetected', { count: subSummary.subscriptions.length }) : t('bizStats.noToolsDetected')}
                  </Txt>
                </View>
                <ChevronRight size={18} color={B.textFaint} />
              </View>

              {subSummary.subscriptions.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <GlassCard style={{ flex: 1 }} padding={12} radius={R.sm} tint={`${B.red}10`} border={`${B.red}26`}>
                    <Txt weight="bold" size={18} color={B.red}>${subSummary.monthlyTotal.toFixed(0)}</Txt>
                    <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.5, marginTop: 2 }}>{t('business.perMonth')}</Txt>
                  </GlassCard>
                  {subSummary.upcoming.length > 0 && (
                    <GlassCard style={{ flex: 1 }} padding={12} radius={R.sm} tint={`${B.amber}0e`} border={`${B.amber}2a`}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <AlertCircle size={12} color={B.amber} />
                        <Txt weight="bold" size={18} color={B.amber}>{subSummary.upcoming.length}</Txt>
                      </View>
                      <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.5, marginTop: 2 }}>{t('business.dueSoon')}</Txt>
                    </GlassCard>
                  )}
                  <GlassCard style={{ flex: 1 }} padding={12} radius={R.sm}>
                    <Txt weight="bold" size={18} color={B.textDim}>${(subSummary.annualTotal / 1000).toFixed(1)}k</Txt>
                    <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.5, marginTop: 2 }}>{t('business.perYear')}</Txt>
                  </GlassCard>
                </View>
              ) : (
                <GlassCard padding={12} radius={R.sm}>
                  <Txt size={12} color={B.textFaint} style={{ textAlign: 'center' }}>{t('business.detectHint')}</Txt>
                </GlassCard>
              )}
            </GlassCard>
          </Pressable>
        </Animated.View>

        {/* Recent activity */}
        <View style={{ paddingHorizontal: 20 }}>
          <Label>{t('business.recent')}</Label>
          {isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}><ActivityIndicator color={B.accent} /></View>
          ) : recentExpenses.length === 0 ? (
            <GlassCard padding={32} radius={R.lg} style={{ alignItems: 'center' }}>
              <DollarSign size={32} color={B.slate700} />
              <Txt weight="semibold" size={14} color={B.textDim} style={{ marginTop: 12, marginBottom: 4 }}>{t('business.noExpenses')}</Txt>
              <Txt size={12} color={B.textFaint} style={{ textAlign: 'center' }}>{t('business.noExpensesHint')}</Txt>
            </GlassCard>
          ) : (
            <View style={{ gap: 8 }}>
              {recentExpenses.map(expense => (
                <GlassCard key={expense.id} padding={13} radius={R.sm}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Txt weight="semibold" size={14} color={B.text} numberOfLines={1}>{expense.description}</Txt>
                      <Txt size={11} color={B.textFaint} style={{ marginTop: 2 }}>{expense.submitter.name} · {expenseCategoryLabel(expense.category)}</Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Txt weight="bold" size={14} color={B.text}>${expense.amount.toFixed(2)}</Txt>
                      <Pill label={expense.status.toUpperCase()} color={statusColor[expense.status] ?? B.textDim} />
                    </View>
                  </View>
                </GlassCard>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </BizBackground>
  );
}
