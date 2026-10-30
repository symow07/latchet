import {
  View,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  type ScrollViewInstance } from 'react-native';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoiceReviewSheet } from '@/components/VoiceReviewSheet';
import { VoiceInput, type VoicePhase } from '@/components/VoiceInput';
import { toTransactionInputs, type ReviewRow, type VoiceResult } from '@/lib/voice-capture';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Send, TrendingUp, PiggyBank, AlertCircle, Lightbulb } from '@/components/icons';
import * as Haptics from 'expo-haptics';

import { getTransactions, getSettings, addTransaction } from '@/lib/db';
import {
  analyzeSpending,
  getQuickInsights,
  sendAdvisorMessage,
  type SpendingAnalysis,
} from '@/lib/ai-analysis';
import { BAR, F, R, S, useC } from '@/lib/design';
import { Card, Chip, CircleAction, Screen, Type, mirror } from '@/components/kit';
import { useEntitlement } from '@/lib/useEntitlement';
import { isUpgradeRequired } from '@/lib/entitlementApi';
import { t, getLocale } from '@/lib/i18n/core';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Built per call, not at module scope: t() at module scope resolves once at
// import and freezes the startup language.
function suggestedPrompts() {
  // No per-prompt colour. §1.3 makes these suggested-reply chips — white
  // pills with a hairline (§6.4) — and four differently-tinted icon bubbles
  // turned four equivalent options into four competing ones.
  return [
    { icon: TrendingUp, text: t('advisor2.promptDoing') },
    { icon: PiggyBank, text: t('advisor2.promptSave') },
    { icon: AlertCircle, text: t('advisor2.promptOverspend') },
    { icon: Lightbulb, text: t('advisor2.promptTips') },
  ];
}

const VOICE_PHASE_KEY = {
  recording: 'voice.listening',
  extracting: 'voice.thinking',
  unavailable: 'voice.unavailable',
} as const;

export default function AdvisorTab() {
  const C = useC();
  const { handleUpgradeRequired } = useEntitlement();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollViewInstance>(null);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  const queryClient = useQueryClient();
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const analysis = useMemo<SpendingAnalysis | null>(
    () => (transactions.length > 0 && settings ? analyzeSpending(transactions, settings) : null),
    [transactions, settings],
  );

  const quickInsights = analysis && settings ? getQuickInsights(analysis, settings) : [];

  const sendMessageMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));
      // The chat shape: persona and figures in the system role, the exchange as
      // real turns. The server prepends the hard safety constraints to that
      // system message, which is what makes them un-overridable by anything
      // typed here.
      return sendAdvisorMessage(analysis, settings ?? null, userMessage, conversationHistory, getLocale());
    },
    onSuccess: (response) => {
      setMessages(prev => [...prev, { id: `msg_${Date.now()}`, role: 'assistant', content: response, timestamp: new Date() }]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: async (error) => {
      // A free user who has used their daily allowance gets the paywall, not an
      // apology — the server sends 402 with a code so we can tell the two apart.
      if (await handleUpgradeRequired(error)) {
        setMessages(prev => [...prev, { id: `msg_${Date.now()}`, role: 'assistant', content: t('advisor.upgraded'), timestamp: new Date() }]);
        return;
      }
      const message = isUpgradeRequired(error)
        ? t('subscription.aiLimitReached')
        : t('advisor.issue', {
            message: error instanceof Error ? error.message : t('common.retry'),
          });
      setMessages(prev => [...prev, { id: `msg_${Date.now()}`, role: 'assistant', content: message, timestamp: new Date() }]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleSend = () => {
    const trimmedInput = inputText.trim();
    if (!trimmedInput || sendMessageMutation.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessages(prev => [...prev, { id: `msg_${Date.now()}`, role: 'user', content: trimmedInput, timestamp: new Date() }]);
    setInputText('');
    sendMessageMutation.mutate(trimmedInput);
  };

  const handleSuggestedPrompt = (prompt: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText(prompt);
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const canSend = inputText.trim() && !sendMessageMutation.isPending;

  // ── Voice capture ──────────────────────────────────────────────────────────
  // The button and its recorder are components/VoiceInput.tsx; this screen
  // shows what it is doing and reviews what it heard.
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);

  const saveVoiceRows = async (rows: ReviewRow[]) => {
    setSavingVoice(true);
    try {
      // Sequential rather than parallel: addTransaction adjusts the running
      // balance, so concurrent writes would race it.
      for (const input of toTransactionInputs(rows)) {
        await addTransaction(input);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVoiceResult(null);
      queryClient.invalidateQueries();
    } catch {
      Alert.alert(t('dialogs.error'), t('voice.failed'));
    } finally {
      setSavingVoice(false);
    }
  };

  return (
    <Screen pal={C}>
      {/* Ask comes off the tab bar (§5), so it has to carry its own way out.
          A screen you can reach and not leave is the one wayfinding failure
          that has no excuse. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: S.screen, paddingTop: 8 }}>
        <CircleAction
          pal={C}
          label={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        >
          <ChevronLeft size={20} color={C.ink} strokeWidth={S.stroke} style={mirror} />
        </CircleAction>
        <Type role="cardTitle" color={C.ink} style={{ flex: 1 }}>
          {t('advisor.title')}
        </Type>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={85}
      >
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 16, paddingBottom: 16 }}
        >
          {/* The Milo screen (§16, §1.3): a headline sitting directly on the
              ground, three short paragraphs of ordinary English, and tappable
              chips. No avatar chip, no gradient badge, no card around the
              greeting — prose is the interface here, so it gets the room. */}
          {messages.length === 0 ? (
            <>
              <Type role="headline" color={C.ink} style={{ marginTop: 12 }}>
                {t('advisor.welcome')}
              </Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 12 }}>
                {t('advisor2.welcomeBody')}
              </Type>

              {quickInsights.length > 0 ? (
                <View style={{ marginTop: 16, gap: 12 }}>
                  {quickInsights.map((insight, idx) => (
                    <Type key={idx} role="body" color={C.ink}>
                      {insight}
                    </Type>
                  ))}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
                {suggestedPrompts().map((prompt, idx) => (
                  <Chip
                    key={idx}
                    pal={C}
                    label={prompt.text}
                    onPress={() => handleSuggestedPrompt(prompt.text)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {/* A conversation. The question is the user's own bubble, filled
              with the tint; the answer sits on a lifted card surface with the
              silver edge, so the two voices read apart without a second
              colour. Each bubble's tail is the smaller corner on its own side. */}
          {messages.map((message) => (
            <View
              key={message.id}
              style={{
                marginBottom: 16,
                alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              {/* Your words on the soft tint wash, the advisor's on a card.
                  Not an espresso bubble: a long chat would otherwise be a
                  column of anchors. Business draws the same pair. */}
              {message.role === 'user' ? (
                <View
                  style={{
                    maxWidth: '86%',
                    backgroundColor: C.accentSoft,
                    borderRadius: R.md,
                    borderBottomEndRadius: R.sm,
                    borderCurve: 'continuous',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <Type role="body" color={C.ink}>{message.content}</Type>
                </View>
              ) : (
                <Card
                  pal={C}
                  padding={0}
                  style={{ maxWidth: '96%' }}
                  contentStyle={{
                    borderBottomStartRadius: R.sm,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <Type role="body" color={C.ink}>{message.content}</Type>
                </Card>
              )}
            </View>
          ))}

          {sendMessageMutation.isPending ? (
            <Type role="body" color={C.inkDim}>{t('advisor.analyzing')}</Type>
          ) : null}
        </ScrollView>

        {/* ── Disclaimer ──
            Persistent and on-screen, not a modal nobody reads. It sits directly
            above the input because that is where someone is looking when they
            decide what to ask, which is the moment it has to be true. It names
            medical and nutritional advice on purpose: the advisor profile
            collects health and diet details, and answers can lean on them. */}
        <Type
          role="meta"
          color={C.inkDim}
          style={{ paddingHorizontal: S.screen, textAlign: 'center' }}
        >
          {t('advisor.disclaimer')}
        </Type>

        {/* ── Input ── */}
        {/* The floating tab bar sits over the bottom of this screen, so the
            input row clears it by hand, as the business advisor's does. With a
            fixed 28 the field, the mic and send were under the bar. */}
        <View style={{ paddingHorizontal: S.screen, paddingTop: 12, paddingBottom: BAR.clearance(insets.bottom) }}>
          {voicePhase !== 'idle' ? (
            <Type role="meta" color={voicePhase === 'extracting' ? C.inkDim : C.negative} style={{ marginBottom: 8 }}>
              {t(VOICE_PHASE_KEY[voicePhase])}
            </Type>
          ) : null}

          {/* One pill holding the field, the mic and send — §16 asks for a pill
              input with a mic, and three separate 50pt squares was three
              objects where the reference has one. */}
          <Card pal={C} padding={0} radius={R.pill} contentStyle={{ paddingStart: 20, paddingEnd: 6, paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('fields.askFinances')}
                placeholderTextColor={C.inkFaint}
                multiline
                maxLength={500}
                style={{
                  flex: 1,
                  color: C.ink,
                  fontSize: 16,
                  lineHeight: 22,
                  ...F.regular,
                  maxHeight: 100,
                  paddingVertical: 12,
                }}
                editable={!sendMessageMutation.isPending}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />

              <VoiceInput
                pal={C}
                disabled={sendMessageMutation.isPending}
                onPhase={setVoicePhase}
                onResult={setVoiceResult}
              />

              <Pressable
                onPress={handleSend}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel={t('advisor.title')}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: R.pill,
                  borderCurve: 'continuous',
                  alignItems: 'center',
                  justifyContent: 'center',
                  // The primary action: espresso, the identity's signature.
                  backgroundColor: canSend ? C.espresso : C.groundSunk,
                }}
              >
                <Send size={18} color={canSend ? C.onEspresso : C.inkFaint} strokeWidth={S.stroke} />
              </Pressable>
            </View>
          </Card>
        </View>
      </KeyboardAvoidingView>

      <VoiceReviewSheet
        result={voiceResult}
        visible={voiceResult !== null}
        saving={savingVoice}
        onCancel={() => setVoiceResult(null)}
        onConfirm={saveVoiceRows}
      />
    </Screen>
  );
}
