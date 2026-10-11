import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { getBusiness } from '@/lib/businessApi';
import { getBudget } from '@/lib/budgetApi';
import { getPayroll } from '@/lib/salaryApi';
import { getExpenses } from '@/lib/expenseApi';
import { getSettings } from '@/lib/db';
import {
  buildBusinessContext,
  businessAdvisorPersona,
  type BusinessFacts,
} from '@/lib/business-advisor';
import { localeInstruction } from '@/lib/prompt-budget';
import { api } from '@/lib/api/api';
import { useEntitlement } from '@/lib/useEntitlement';
import { readMembers } from '@/lib/group-members';
import { BAR, F, R, S, useC } from '@/lib/design';
import { Card, Chip, Screen, Type } from '@/components/kit';
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
 *
 * It now also *looks* like the personal one: the question is a bubble in the
 * tint's soft wash, the answer is prose on the ground, and the field, mic slot
 * and send button share one pill. Two chat screens in one app that disagree
 * about what a message looks like is the kind of thing §16.4 calls a
 * familiarity failure.
 *
 * The send button is the screen's one espresso surface, as the primary action
 * on a form is. Its arrow used to be a hard-coded white on the accent, which
 * in dark mode measured 1.74:1 — invisible in exactly the state where it
 * means "you can send this". It is `onEspresso` now, the pair the identity
 * measures.
 */

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function BusinessAdvisorScreen() {
  const B = useC();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { handleUpgradeRequired } = useEntitlement();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');

  const { data: business } = useQuery({ queryKey: ['business'], queryFn: getBusiness });
  const { data: budget } = useQuery({ queryKey: ['budget'], queryFn: getBudget, enabled: !!business });
  const { data: payroll } = useQuery({
    queryKey: ['payroll'],
    queryFn: () => getPayroll(),
    enabled: !!business,
  });
  const { data: expenses } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => getExpenses(),
    enabled: !!business,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const facts: BusinessFacts = {
    name: business?.name,
    memberCount: readMembers(business).length,
    // The user's own currency. It was a literal '$', so the model was told
    // every figure was dollars regardless of what the business actually uses,
    // and answered in dollars to match.
    currency: settings?.currencySymbol || '$',
    monthLabel: budget?.month.label,
    budget: budget
      ? {
          totalMonthly: budget.budget.totalMonthly,
          byCategory: Object.fromEntries(
            Object.entries(budget.budget.categories).map(([k, v]) => [k, v ?? 0])
          ),
        }
      : null,
    spending: budget
      ? {
          total: budget.spending.total,
          approved: budget.spending.approved,
          byCategory: Object.fromEntries(
            Object.entries(budget.spending.byCategory).map(([k, v]) => [k, v?.spent ?? 0])
          ),
        }
      : null,
    payroll: payroll
      ? {
          totalPayroll: payroll.summary.totalPayroll,
          paidTotal: payroll.summary.paidTotal,
          unpaidTotal: payroll.summary.unpaidTotal,
        }
      : null,
    pendingExpenseCount: (expenses ?? []).filter((e) => e.status === 'pending').length,
  };

  const ask = useMutation({
    mutationFn: async (question: string) => {
      const locale = getLocale();
      const system = [
        businessAdvisorPersona(localeInstruction(locale)),
        buildBusinessContext(facts),
      ]
        .filter(Boolean)
        .join('\n\n');

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
        setMessages((prev) => [
          ...prev,
          { id: `a_${Date.now()}`, role: 'assistant', content: t('advisor.upgraded') },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: `a_${Date.now()}`, role: 'assistant', content: t('advisor.error') },
      ]);
    },
  });

  const canSend = !!input.trim() && !ask.isPending;

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
    <Screen pal={B}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 16, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <>
              <Type role="headline" color={B.ink} style={{ marginTop: 12 }}>
                {t('businessAdvisor.introTitle')}
              </Type>
              <Type role="body" color={B.inkDim} style={{ marginTop: 12 }}>
                {business ? t('businessAdvisor.introBody') : t('businessAdvisor.noBusiness')}
              </Type>

              {business ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
                  {suggestions.map((q) => (
                    <Chip key={q} pal={B} label={q} onPress={() => setInput(q)} />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {/* A conversation, not two kinds of card. The question is a bubble
              in the tint's soft wash, and the answer is prose on the ground,
              because that is what it is. The bubble is not espresso: a
              conversation would otherwise be a column of anchors. */}
          {messages.map((m) => (
            <View
              key={m.id}
              style={{
                marginBottom: 16,
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              {/* Your words on the soft tint wash, the advisor's on a card:
                  the same pair as the personal advisor. */}
              {m.role === 'user' ? (
                <View
                  style={{
                    maxWidth: '86%',
                    backgroundColor: B.accentSoft,
                    borderRadius: R.md,
                    borderBottomEndRadius: R.sm,
                    borderCurve: 'continuous',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <Type role="body" color={B.ink}>
                    {m.content}
                  </Type>
                </View>
              ) : (
                <Card
                  pal={B}
                  padding={0}
                  style={{ maxWidth: '96%' }}
                  contentStyle={{
                    borderBottomStartRadius: R.sm,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <Type role="body" color={B.ink}>
                    {m.content}
                  </Type>
                </Card>
              )}
            </View>
          ))}

          {ask.isPending ? (
            <Type role="body" color={B.inkDim}>
              {t('advisor.analyzing')}
            </Type>
          ) : null}
        </ScrollView>

        {/* Same disclaimer as the personal advisor, and for the same reason:
            it belongs where someone is looking when they decide what to ask. */}
        <Type
          role="meta"
          color={B.inkDim}
          style={{ paddingHorizontal: S.screen, textAlign: 'center' }}
        >
          {t('advisor.disclaimer')}
        </Type>

        {/* The tab bar is position:absolute, so it floats over this row and
            the row has to clear it by hand. Without that the input is simply
            not on screen — which is what shipped in the first build of this
            screen. `BAR.clearance` is the shared number; this file used to
            keep its own copy of the pill's height, which went stale the first
            time the pill was resized. */}
        <View
          style={{
            paddingHorizontal: S.screen,
            paddingTop: 12,
            paddingBottom: BAR.clearance(insets.bottom),
          }}
        >
          <Card
            pal={B}
            padding={0}
            radius={R.pill}
            contentStyle={{ paddingStart: 20, paddingEnd: 6, paddingVertical: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={t('businessAdvisor.placeholder')}
                placeholderTextColor={B.inkFaint}
                multiline
                maxLength={500}
                editable={!ask.isPending}
                onSubmitEditing={send}
                returnKeyType="send"
                style={{
                  flex: 1,
                  color: B.ink,
                  fontSize: 16,
                  lineHeight: 22,
                  ...F.regular,
                  maxHeight: 100,
                  paddingVertical: 12,
                }}
              />
              <Pressable
                onPress={send}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel={t('tabs.advisor')}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: R.pill,
                  borderCurve: 'continuous',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: canSend ? B.espresso : B.groundSunk,
                }}
              >
                {ask.isPending ? (
                  <ActivityIndicator size="small" color={B.inkDim} />
                ) : (
                  <Send
                    size={18}
                    color={canSend ? B.onEspresso : B.inkFaint}
                    strokeWidth={S.stroke}
                  />
                )}
              </Pressable>
            </View>
          </Card>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
