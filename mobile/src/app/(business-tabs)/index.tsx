import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
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
import { detectSubscriptions } from '@/lib/subscriptionDetection';

export default function BusinessDashboardTab() {
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';

  const { data: allExpenses = [], isLoading } = useQuery({
    queryKey: ['biz-expenses', undefined],
    queryFn: () => getExpenses(),
  });

  const { data: business } = useQuery({
    queryKey: ['my-business'],
    queryFn: getBusiness,
  });

  const myRole = business?.teamMembers.find(m => m.userId === session?.user?.id)?.role;
  const canReview = myRole === 'owner' || myRole === 'manager';

  const totalExpenses  = allExpenses.reduce((s, e) => s + e.amount, 0);
  const approved       = allExpenses.filter(e => e.status === 'approved');
  const pending        = allExpenses.filter(e => e.status === 'pending');
  const rejected       = allExpenses.filter(e => e.status === 'rejected');
  const approvedTotal  = approved.reduce((s, e) => s + e.amount, 0);
  const recentExpenses = allExpenses.slice(0, 5);

  const subSummary = detectSubscriptions(allExpenses);

  const metrics = [
    { label: 'Total Submitted', value: `$${totalExpenses.toFixed(0)}`, sub: `${allExpenses.length} expense${allExpenses.length !== 1 ? 's' : ''}`, accent: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.15)' },
    { label: 'Approved',        value: `$${approvedTotal.toFixed(0)}`, sub: `${approved.length} approved`,  accent: '#22c55e', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.15)'   },
    { label: 'Pending Review',  value: `${pending.length}`,            sub: canReview ? 'Needs review' : 'Awaiting review', accent: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.15)' },
    { label: 'Rejected',        value: `${rejected.length}`,           sub: `${rejected.length} rejected`,  accent: '#9ca3af', bg: 'rgba(156,163,175,0.06)', border: 'rgba(156,163,175,0.12)' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#060d18', paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>

        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>
              BUSINESS
            </Text>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 }}>
              Hey, {firstName}
            </Text>
          </View>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.3)', alignItems: 'center', justifyContent: 'center' }}>
            <Briefcase size={18} color="#60a5fa" />
          </View>
        </View>

        {/* Business name banner */}
        <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
          <LinearGradient
            colors={['#0c1f3d', '#0f2d58']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 22, padding: 22, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 4 }}>
              {business?.name?.toUpperCase() ?? 'YOUR BUSINESS'}
            </Text>
            {isLoading ? (
              <ActivityIndicator color="#60a5fa" size="small" style={{ alignSelf: 'flex-start', marginVertical: 4 }} />
            ) : (
              <Text style={{ color: '#fff', fontSize: 38, fontWeight: '800', marginBottom: 4 }}>
                ${approvedTotal.toFixed(2)}
              </Text>
            )}
            <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '600' }}>
              {pending.length > 0 && canReview
                ? `${pending.length} expense${pending.length > 1 ? 's' : ''} waiting for your review`
                : approved.length > 0
                  ? 'Total approved expenses'
                  : 'No expenses yet — submit your first'}
            </Text>
          </LinearGradient>
        </View>

        {/* Metrics Grid */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
            OVERVIEW
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {metrics.map(m => (
              <View key={m.label} style={{ width: '47%', backgroundColor: m.bg, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: m.border }}>
                <Text style={{ color: m.accent, fontSize: 22, fontWeight: '800', marginBottom: 2 }}>{m.value}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', marginBottom: 2 }}>{m.label}</Text>
                <Text style={{ color: '#4b5563', fontSize: 11 }}>{m.sub}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Quick Actions */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
            QUICK ACTIONS
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(business-tabs)/expenses'); }}
              style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1, backgroundColor: 'rgba(96,165,250,0.07)', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(96,165,250,0.14)', gap: 8 })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(248,113,113,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingDown size={18} color="#f87171" />
              </View>
              <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '600', textAlign: 'center' }}>Add Expense</Text>
            </Pressable>
            {canReview && pending.length > 0 && (
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(business-tabs)/expenses'); }}
                style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1, backgroundColor: 'rgba(251,191,36,0.07)', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', gap: 8 })}
              >
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(251,191,36,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Clock size={18} color="#fbbf24" />
                </View>
                <Text style={{ color: '#9ca3af', fontSize: 11, fontWeight: '600', textAlign: 'center' }}>Review ({pending.length})</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ── Tools & Subscriptions Card ── */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
            TOOLS & SUBSCRIPTIONS
          </Text>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/business-tools'); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <LinearGradient
              colors={['#060e1f', '#0b1c38']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 22, padding: 20, borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(96,165,250,0.12)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Wrench size={18} color="#60a5fa" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '700' }}>Business Tools</Text>
                  <Text style={{ color: '#4b5563', fontSize: 12, marginTop: 1 }}>
                    {subSummary.subscriptions.length > 0
                      ? `${subSummary.subscriptions.length} tool${subSummary.subscriptions.length !== 1 ? 's' : ''} detected`
                      : 'No subscriptions detected yet'}
                  </Text>
                </View>
                <ChevronRight size={18} color="#374151" />
              </View>

              {subSummary.subscriptions.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(248,113,113,0.08)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.15)' }}>
                    <Text style={{ color: '#f87171', fontSize: 18, fontWeight: '800' }}>
                      ${subSummary.monthlyTotal.toFixed(0)}
                    </Text>
                    <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 }}>PER MONTH</Text>
                  </View>
                  {subSummary.upcoming.length > 0 && (
                    <View style={{ flex: 1, backgroundColor: 'rgba(251,191,36,0.06)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <AlertCircle size={12} color="#fbbf24" />
                        <Text style={{ color: '#fbbf24', fontSize: 18, fontWeight: '800' }}>{subSummary.upcoming.length}</Text>
                      </View>
                      <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 }}>DUE SOON</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                    <Text style={{ color: '#9ca3af', fontSize: 18, fontWeight: '800' }}>
                      ${(subSummary.annualTotal / 1000).toFixed(1)}k
                    </Text>
                    <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 }}>PER YEAR</Text>
                  </View>
                </View>
              ) : (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                  <Text style={{ color: '#374151', fontSize: 12, textAlign: 'center' }}>
                    Add Software expenses to detect recurring tools
                  </Text>
                </View>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        {/* Recent Activity */}
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
            RECENT ACTIVITY
          </Text>
          {isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <ActivityIndicator color="#60a5fa" />
            </View>
          ) : recentExpenses.length === 0 ? (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
              <DollarSign size={32} color="#1f3556" />
              <Text style={{ color: '#374151', fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 }}>No expenses yet</Text>
              <Text style={{ color: '#1f2937', fontSize: 12, textAlign: 'center' }}>
                Go to Expenses tab to submit your first expense
              </Text>
            </View>
          ) : (
            recentExpenses.map(expense => {
              const ss = { pending: { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)' }, approved: { text: '#22c55e', bg: 'rgba(34,197,94,0.1)' }, rejected: { text: '#ef4444', bg: 'rgba(239,68,68,0.1)' } }[expense.status];
              return (
                <View key={expense.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{expense.description}</Text>
                    <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 2 }}>{expense.submitter.name} · {expense.category}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>${expense.amount.toFixed(2)}</Text>
                    <View style={{ backgroundColor: ss.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: ss.text, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>{expense.status}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

      </ScrollView>
    </View>
  );
}
