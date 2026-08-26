import {
  View,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Send, Bot, User, Sparkles, TrendingUp, PiggyBank, AlertCircle, Lightbulb } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';

import { getTransactions, getSettings } from '@/lib/db';
import {
  analyzeSpending,
  buildAIPrompt,
  getAIResponse,
  getQuickInsights,
  type SpendingAnalysis,
} from '@/lib/ai-analysis';
import { R, glow, useC } from '@/lib/design';
import { Txt, GlassCard, IconBubble, ScreenBackground } from '@/components/ui';
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
  return [
    { icon: TrendingUp, text: t('advisor2.promptDoing'), color: '#a855f7' },
    { icon: PiggyBank, text: t('advisor2.promptSave'), color: '#10b981' },
    { icon: AlertCircle, text: t('advisor2.promptOverspend'), color: '#f59e0b' },
    { icon: Lightbulb, text: t('advisor2.promptTips'), color: '#0ea5e9' },
  ];
}

export default function AdvisorTab() {
  const C = useC();
  const { handleUpgradeRequired } = useEntitlement();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysis, setAnalysis] = useState<SpendingAnalysis | null>(null);

  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const transactionsLength = transactions.length;
  useEffect(() => {
    if (transactionsLength > 0 && settings) {
      setAnalysis(analyzeSpending(transactions, settings));
    }
  }, [transactions, settings, transactionsLength]);

  const quickInsights = analysis && settings ? getQuickInsights(analysis, settings) : [];

  const sendMessageMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));
      const prompt = buildAIPrompt(analysis, settings ?? null, userMessage, conversationHistory, getLocale());
      return getAIResponse(prompt, '');
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

  return (
    <ScreenBackground>
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + 12, paddingBottom: 6, paddingHorizontal: 20, alignItems: 'center' }}>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <LinearGradient colors={[C.p600, C.p400]} style={[{ width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, glow(C.p500, 0.45, 12, C.glowScale)]}>
            <Bot size={20} color="#fff" />
          </LinearGradient>
          <View>
            <Txt weight="bold" size={19} color={C.text}>{t('advisor.title')}</Txt>
            <Txt size={11} color={C.textDim}>{t('advisor.subtitle')}</Txt>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={85}
      >
        <ScrollView
          ref={scrollViewRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 20, paddingBottom: 16 }}
        >
          {/* Welcome */}
          {messages.length === 0 && (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard tint={`${C.p500}14`} border={`${C.p500}2e`} radius={R.lg} style={{ marginBottom: 16 }}>
                <View className="flex-row items-center mb-3" style={{ gap: 12 }}>
                  <IconBubble color={C.p500} size={48} radius={18}><Sparkles size={23} color={C.p400} /></IconBubble>
                  <View className="flex-1">
                    <Txt weight="bold" size={18} color={C.text}>{t('advisor.welcome')}</Txt>
                    <Txt size={13} color={C.textDim}>{t('advisor.analyzed')}</Txt>
                  </View>
                </View>
                <Txt size={13} color={C.textDim} style={{ lineHeight: 20 }}>
                  {t('advisor2.welcomeBody')}
                </Txt>
              </GlassCard>

              {quickInsights.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Txt weight="bold" size={11} color={C.textFaint} style={{ marginBottom: 10, marginLeft: 2, letterSpacing: 1 }}>{t('advisor.quickInsights')}</Txt>
                  <View style={{ gap: 8 }}>
                    {quickInsights.map((insight, idx) => (
                      <Animated.View key={idx} entering={FadeInUp.delay(100 * idx).duration(300)}>
                        <GlassCard padding={14} radius={R.md}>
                          <Txt size={13} color={C.text} style={{ lineHeight: 19 }}>{insight}</Txt>
                        </GlassCard>
                      </Animated.View>
                    ))}
                  </View>
                </View>
              )}

              <Txt weight="bold" size={11} color={C.textFaint} style={{ marginBottom: 10, marginLeft: 2, letterSpacing: 1 }}>{t('advisor.tryAsking')}</Txt>
              <View style={{ gap: 10 }}>
                {suggestedPrompts().map((prompt, idx) => (
                  <Animated.View key={idx} entering={FadeInUp.delay(200 + 100 * idx).duration(300)}>
                    <Pressable onPress={() => handleSuggestedPrompt(prompt.text)}>
                      <GlassCard padding={14} radius={R.md}>
                        <View className="flex-row items-center" style={{ gap: 12 }}>
                          <IconBubble color={prompt.color} size={40}><prompt.icon size={19} color={prompt.color} /></IconBubble>
                          <Txt weight="medium" size={14} color={C.text} style={{ flex: 1 }}>{prompt.text}</Txt>
                        </View>
                      </GlassCard>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Messages */}
          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <Animated.View key={message.id} entering={FadeInUp.duration(300)} style={{ marginBottom: 14, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                {isUser ? (
                  <LinearGradient
                    colors={[C.p600, C.p500]}
                    style={[{ maxWidth: '86%', borderRadius: R.lg, borderBottomRightRadius: 8, padding: 14 }, glow(C.p500, 0.3, 14, C.glowScale)]}
                  >
                    <View className="flex-row items-center mb-2" style={{ gap: 6 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' }}>
                        <User size={13} color="#fff" />
                      </View>
                      <Txt size={11} color="rgba(255,255,255,0.75)">You</Txt>
                    </View>
                    <Txt size={14} color="#fff" style={{ lineHeight: 20 }}>{message.content}</Txt>
                  </LinearGradient>
                ) : (
                  <GlassCard padding={14} radius={R.lg} style={{ maxWidth: '86%', borderBottomLeftRadius: 8 }} tint={C.glassStrong}>
                    <View className="flex-row items-center mb-2" style={{ gap: 6 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${C.p500}33` }}>
                        <Bot size={13} color={C.p400} />
                      </View>
                      <Txt size={11} color={C.textDim}>{t('advisor.title')}</Txt>
                    </View>
                    <Txt size={14} color={C.text} style={{ lineHeight: 20 }}>{message.content}</Txt>
                  </GlassCard>
                )}
              </Animated.View>
            );
          })}

          {/* Loading */}
          {sendMessageMutation.isPending && (
            <Animated.View entering={FadeInUp.duration(300)} style={{ alignItems: 'flex-start', marginBottom: 14 }}>
              <GlassCard padding={14} radius={R.lg} tint={C.glassStrong}>
                <View className="flex-row items-center" style={{ gap: 10 }}>
                  <ActivityIndicator size="small" color={C.p400} />
                  <Txt size={13} color={C.textDim}>{t('advisor.analyzing')}</Txt>
                </View>
              </GlassCard>
            </Animated.View>
          )}
        </ScrollView>

        {/* ── Input ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }}>
          <View className="flex-row items-end" style={{ gap: 10 }}>
            <View style={{ flex: 1, borderRadius: R.lg, paddingHorizontal: 16, paddingVertical: 12, minHeight: 50, backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.glassBorder }}>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask about your finances…"
                placeholderTextColor={C.textFaint}
                multiline
                maxLength={500}
                style={{ color: C.text, fontSize: 15, fontFamily: 'PlusJakartaSans_500Medium', maxHeight: 100 }}
                editable={!sendMessageMutation.isPending}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />
            </View>
            <Pressable onPress={handleSend} disabled={!canSend}>
              <LinearGradient
                colors={canSend ? [C.p600, C.p400] : ['#2a2138', '#2a2138']}
                style={[{ width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, canSend ? glow(C.p500, 0.5, 14, C.glowScale) : null]}
              >
                <Send size={20} color={canSend ? '#fff' : C.textFaint} />
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}
