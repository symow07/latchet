import {
  View,
  Text,
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

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const SUGGESTED_PROMPTS = [
  { icon: TrendingUp, text: "How am I doing this month?", color: '#a855f7' },
  { icon: PiggyBank, text: "How can I save more money?", color: '#22c55e' },
  { icon: AlertCircle, text: "Where am I overspending?", color: '#f59e0b' },
  { icon: Lightbulb, text: "Give me personalized tips", color: '#3b82f6' },
];

export default function AdvisorTab() {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysis, setAnalysis] = useState<SpendingAnalysis | null>(null);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  // Analyze spending when data loads - use length and settings id to avoid re-renders
  const transactionsLength = transactions.length;
  useEffect(() => {
    if (transactionsLength > 0 && settings) {
      const spendingAnalysis = analyzeSpending(transactions, settings);
      setAnalysis(spendingAnalysis);
    }
  }, [transactions, settings, transactionsLength]);

  const quickInsights = analysis && settings ? getQuickInsights(analysis, settings) : [];

  const sendMessageMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      // TODO: route via backend AI proxy — never expose API keys in mobile bundle.
      // The local prompt builder still runs so the architecture is ready for a
      // proxied call; getAIResponse currently throws a friendly unavailable error.
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      const prompt = buildAIPrompt(analysis, settings ?? null, userMessage, conversationHistory);
      const response = await getAIResponse(prompt, '');
      return response;
    },
    onSuccess: (response) => {
      const assistantMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      const errorMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `I'm sorry, I encountered an issue: ${error instanceof Error ? error.message : 'Please try again later.'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleSend = () => {
    const trimmedInput = inputText.trim();
    if (!trimmedInput || sendMessageMutation.isPending) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    sendMessageMutation.mutate(trimmedInput);
  };

  const handleSuggestedPrompt = (prompt: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText(prompt);
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  return (
    <View className="flex-1" style={{ backgroundColor: '#06060f' }}>
      {/* Header */}
      <LinearGradient
        colors={['#2e1065', '#4c1d95', '#7c3aed', '#06060f']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 24,
          paddingHorizontal: 16,
          borderBottomLeftRadius: 36,
          borderBottomRightRadius: 36,
        }}
      >
        <View className="flex-row items-center justify-center">
          <View className="flex-row items-center">
            <View className="w-8 h-8 rounded-full bg-white/20 items-center justify-center mr-2">
              <Bot size={18} color="white" />
            </View>
            <Text className="text-white text-lg font-bold">AI Advisor</Text>
          </View>
        </View>
        <Text className="text-white/70 text-xs mt-1 text-center">Your personal finance assistant</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={85}
      >
        <ScrollView
          ref={scrollViewRef}
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 16, paddingBottom: 16 }}
        >
          {/* Welcome message when no messages */}
          {messages.length === 0 && (
            <Animated.View entering={FadeInDown.duration(400)}>
              {/* AI Welcome Card */}
              <View
                className="rounded-2xl p-5 mb-4"
                style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)' }}
              >
                <View className="flex-row items-center mb-3">
                  <View className="w-12 h-12 rounded-2xl bg-purple-500/20 items-center justify-center mr-3">
                    <Sparkles size={24} color="#a855f7" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-bold text-lg">Welcome!</Text>
                    <Text className="text-gray-400 text-sm">I've analyzed your spending</Text>
                  </View>
                </View>
                <Text className="text-gray-300 text-sm leading-5">
                  Ask me anything about your finances. I can help you understand spending patterns,
                  identify savings opportunities, and give personalized advice based on your actual data.
                </Text>
              </View>

              {/* Temporarily unavailable notice */}
              <View
                className="rounded-2xl p-4 mb-4"
                style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.25)' }}
              >
                <Text className="text-amber-400 font-semibold text-sm mb-1">AI chat is temporarily unavailable</Text>
                <Text className="text-gray-400 text-xs leading-4">
                  We&apos;re moving the advisor to a secure backend service. Your local insights below are
                  still live and update with every transaction.
                </Text>
              </View>

              {/* Quick Insights */}
              {quickInsights.length > 0 && (
                <View className="mb-4">
                  <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">QUICK INSIGHTS</Text>
                  {quickInsights.map((insight, idx) => (
                    <Animated.View
                      key={idx}
                      entering={FadeInUp.delay(100 * idx).duration(300)}
                      className="rounded-xl p-3 mb-2"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <Text className="text-gray-200 text-sm">{insight}</Text>
                    </Animated.View>
                  ))}
                </View>
              )}

              {/* Suggested Prompts */}
              <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">TRY ASKING</Text>
              <View className="gap-2">
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <Animated.View key={idx} entering={FadeInUp.delay(200 + 100 * idx).duration(300)}>
                    <Pressable
                      onPress={() => handleSuggestedPrompt(prompt.text)}
                      className="active:scale-98"
                    >
                      <View
                        className="rounded-xl p-4 flex-row items-center"
                        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                      >
                        <View
                          className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                          style={{ backgroundColor: `${prompt.color}20` }}
                        >
                          <prompt.icon size={20} color={prompt.color} />
                        </View>
                        <Text className="text-white flex-1">{prompt.text}</Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Messages */}
          {messages.map((message, idx) => (
            <Animated.View
              key={message.id}
              entering={FadeInUp.duration(300)}
              className={`mb-4 ${message.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <View
                className={`max-w-[85%] rounded-2xl p-4 ${
                  message.role === 'user'
                    ? 'bg-purple-600'
                    : 'bg-gray-800/80'
                }`}
              >
                <View className="flex-row items-center mb-2">
                  <View
                    className={`w-6 h-6 rounded-full items-center justify-center mr-2 ${
                      message.role === 'user' ? 'bg-white/20' : 'bg-purple-500/30'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <User size={14} color="white" />
                    ) : (
                      <Bot size={14} color="#a855f7" />
                    )}
                  </View>
                  <Text className={`text-xs ${message.role === 'user' ? 'text-white/70' : 'text-gray-400'}`}>
                    {message.role === 'user' ? 'You' : 'AI Advisor'}
                  </Text>
                </View>
                <Text
                  className={`text-sm leading-5 ${
                    message.role === 'user' ? 'text-white' : 'text-gray-200'
                  }`}
                >
                  {message.content}
                </Text>
              </View>
            </Animated.View>
          ))}

          {/* Loading indicator */}
          {sendMessageMutation.isPending && (
            <Animated.View
              entering={FadeInUp.duration(300)}
              className="items-start mb-4"
            >
              <View className="bg-gray-800/80 rounded-2xl p-4 flex-row items-center">
                <ActivityIndicator size="small" color="#a855f7" />
                <Text className="text-gray-400 text-sm ml-3">Analyzing your finances...</Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* Input Area */}
        <View
          className="px-4 py-3 border-t border-gray-800/50"
        >
          <View className="flex-row items-end gap-3">
            <View
              className="flex-1 rounded-2xl px-4 py-3 min-h-[48px]"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            >
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask about your finances..."
                placeholderTextColor="#6b7280"
                multiline
                maxLength={500}
                className="text-white text-base"
                style={{ maxHeight: 100 }}
                editable={!sendMessageMutation.isPending}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />
            </View>
            <Pressable
              onPress={handleSend}
              disabled={!inputText.trim() || sendMessageMutation.isPending}
              className="active:scale-95"
            >
              <LinearGradient
                colors={inputText.trim() && !sendMessageMutation.isPending ? ['#7c3aed', '#a855f7'] : ['#374151', '#374151']}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Send size={20} color="white" />
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
