import { useRef, useState } from 'react';
import {
  View, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Send, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getBusiness } from '@/lib/businessApi';
import { getBudget } from '@/lib/budgetApi';
import { getPayroll } from '@/lib/salaryApi';
import { getExpenses } from '@/lib/expenseApi';
import { buildBusinessContext, businessAdvisorPersona, type BusinessFacts } from '@/lib/business-advisor';
import { localeInstruction } from '@/lib/prompt-budget';
import { api } from '@/lib/api/api';
import { useEntitlement } from '@/lib/useEntitlement';
import { readMembers } from '@/lib/group-members';
import { R, useB } from '@/lib/design';
import { Txt, GlassCard, BizBackground } from '@/components/ui';
import { t, getLocale } from '@/lib/i18n/core';

/**
 * The business advisor.
 *
 * Business mode had no advisor at all, which left the whole AI tier as a
 * personal-only feature even though a company has more to ask about than an
 * individual does.
 *
 * It sends the same chat shape as the personal one — persona and figures in
 * the system role, the exchange as real turns — so the server-side hard
 * constraints in lib/advisor-safety.ts apply here too without this screen
 * restating them.
 */

interface Msg { id: string; role: 'user' | 'assistant'; content: string }

/** Mirrors tabBarStyle.height in (business-tabs)/_layout.tsx. */
const TAB_BAR_HEIGHT = 86;

export default function BusinessAdvisorScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { handleUpgradeRequired } = useEntitlement();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');

  const { data: business } = useQuery({ queryKey: ['business'], queryFn: getBusiness });
  const { data: budget } = useQuery({ queryKey: ['budget'], queryFn: getBudget, enabled: !!business });
  const { data: payroll } = useQuery({ queryKey: ['payroll'], queryFn: () => getPayroll(), enabled: !!business });
  const { data: expenses } = useQuery({ queryKey: ['expenses'], queryFn: () => getExpenses(), enabled: !!business });

  const facts: BusinessFacts = {
    name: business?.name,
    memberCount: readMembers(business).length,
    currency: '$',
    monthLabel: budget?.month.label,
    budget: budget ? {
      totalMonthly: budget.budget.totalMonthly,
      byCategory: Object.fromEntries(
        Object.entries(budget.budget.categories).map(([k, v]) => [k, v ?? 0])
      ),
    } : null,
    spending: budget ? {
      total: budget.spending.total,
      approved: budget.spending.approved,
      byCategory: Object.fromEntries(
        Object.entries(budget.spending.byCategory).map(([k, v]) => [k, v?.spent ?? 0])
      ),
    } : null,
    payroll: payroll ? {
      totalPayroll: payroll.summary.totalPayroll,
      paidTotal: payroll.summary.paidTotal,
      unpaidTotal: payroll.summary.unpaidTotal,
    } : null,
    pendingExpenseCount: (expenses ?? []).filter((e) => e.status === 'pending').length,
  };

  const ask = useMutation({
    mutationFn: async (question: string) => {
      const locale = getLocale();
      const system = [
        businessAdvisorPersona(localeInstruction(locale)),
        buildBusinessContext(facts),
      ].filter(Boolean).join('\n\n');

      const { response } = await api.post<{ response: string }>('/api/ai/chat', {
        system,
        messages: [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: question },
        ],
      });
      return response;
    },
    onSuccess: (response) => {
      setMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: response }]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    },
    onError: async (error: Error) => {
      if (await handleUpgradeRequired(error)) {
        setMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: t('advisor.upgraded') }]);
        return;
      }
      setMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: t('advisor.error') }]);
    },
  });

  const send = () => {
    const question = input.trim();
    if (!question || ask.isPending) return;
    Haptics.selectionAsync();
    setMessages((prev) => [...prev, { id: `u_${Date.now()}`, role: 'user', content: question }]);
    setInput('');
    ask.mutate(question);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const suggestions = [
    t('businessAdvisor.q1'),
    t('businessAdvisor.q2'),
    t('businessAdvisor.q3'),
  ];

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 }}>
          <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>
            {t('tabs.advisor')}
          </Txt>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={{ marginTop: 8 }}>
              <GlassCard padding={16} radius={R.md}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Sparkles size={16} color={B.accent} />
                  <Txt weight="semibold" size={14} color={B.text} style={{ marginStart: 8 }}>
                    {t('businessAdvisor.introTitle')}
                  </Txt>
                </View>
                <Txt size={13} color={B.textFaint} style={{ marginTop: 8, lineHeight: 19 }}>
                  {business
                    ? t('businessAdvisor.introBody')
                    : t('businessAdvisor.noBusiness')}
                </Txt>
              </GlassCard>

              {business && suggestions.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => { setInput(q); }}
                  style={{ marginTop: 10 }}
                >
                  <GlassCard padding={13} radius={R.sm}>
                    <Txt size={13} color={B.textFaint}>{q}</Txt>
                  </GlassCard>
                </Pressable>
              ))}
            </View>
          )}

          {messages.map((m) => (
            <View
              key={m.id}
              style={{
                marginTop: 12,
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
              }}
            >
              <GlassCard
                padding={13}
                radius={R.md}
                tint={m.role === 'user' ? `${B.accent}1f` : undefined}
              >
                <Txt size={14} color={B.text} style={{ lineHeight: 20 }}>{m.content}</Txt>
              </GlassCard>
            </View>
          ))}

          {ask.isPending && (
            <ActivityIndicator color={B.accent} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
          )}
        </ScrollView>

        {/* Same disclaimer as the personal advisor, and for the same reason:
            it belongs where someone is looking when they decide what to ask. */}
        <View style={{ paddingHorizontal: 20 }}>
          <Txt size={11} color={B.textFaint} style={{ textAlign: 'center', lineHeight: 15 }}>
            {t('advisor.disclaimer')}
          </Txt>
        </View>

        {/* The tab bar is position:absolute and 86pt tall (see _layout.tsx),
            so it floats over this row. Without clearing it the input is simply
            not on screen — which is what shipped in the first build of this
            screen. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: TAB_BAR_HEIGHT + 14 }}>
          <View style={{ flex: 1, borderRadius: R.lg, paddingHorizontal: 16, paddingVertical: 12, minHeight: 50, backgroundColor: B.glassStrong, borderWidth: 1, borderColor: B.glassBorder }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('businessAdvisor.placeholder')}
              placeholderTextColor={B.textFaint}
              multiline
              style={{ color: B.text, fontSize: 15, maxHeight: 100 }}
            />
          </View>
          <Pressable
            onPress={send}
            disabled={!input.trim() || ask.isPending}
            style={{
              width: 50, height: 50, borderRadius: 25,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: input.trim() ? B.accent : B.glassStrong,
            }}
          >
            <Send size={19} color={input.trim() ? '#fff' : B.textFaint} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BizBackground>
  );
}
