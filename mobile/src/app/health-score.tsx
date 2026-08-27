import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useC } from '@/lib/design';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  PiggyBank,
  Target,
  Sparkles,
  Zap,
  Award,
  ChevronRight,
  Lightbulb,
  BarChart3,
  Info,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { getTransactions, getSettings } from '@/lib/db';
import { t } from '@/lib/i18n/core';
import {
  calculateHealthScore,
  getPersonalityDescription,
  type HealthScoreResult,
} from '@/lib/health-score';

const { width } = Dimensions.get('window');
const CIRCLE_SIZE = width * 0.55;
const STROKE_WIDTH = 14;
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function HealthScoreScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [healthScore, setHealthScore] = useState<HealthScoreResult | null>(null);
  const [displayScore, setDisplayScore] = useState(0);
  const [progress, setProgress] = useState(0);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  useEffect(() => {
    // Compute as soon as settings load — a brand-new user with zero transactions
    // should still get a (low) score, not an infinite "Loading…".
    if (settings) {
      let score: HealthScoreResult;
      try {
        score = calculateHealthScore(transactions, settings);
      } catch {
        return;
      }
      setHealthScore(score);

      // Animate score counting up
      let currentScore = 0;
      const targetScore = score.totalScore;
      const duration = 1500;
      const steps = 60;
      const increment = targetScore / steps;
      const stepDuration = duration / steps;

      const interval = setInterval(() => {
        currentScore += increment;
        if (currentScore >= targetScore) {
          currentScore = targetScore;
          clearInterval(interval);
        }
        setDisplayScore(Math.round(currentScore));
        setProgress(currentScore / 100);
      }, stepDuration);

      return () => clearInterval(interval);
    }
  }, [transactions, settings]);

  if (!healthScore || !settings) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: C.bg }}>
        <Text style={{ color: C.textDim }} >{t('common.loading')}</Text>
      </View>
    );
  }

  const personality = getPersonalityDescription(healthScore.personalityType);
  const { breakdown } = healthScore;
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  const breakdownItems = [
    {
      label: t('healthBreakdown.savingsRate'),
      score: breakdown.savingsRate.score,
      max: breakdown.savingsRate.maxPoints,
      value: `${breakdown.savingsRate.value}%`,
      icon: PiggyBank,
      color: '#22c55e',
    },
    {
      label: t('healthBreakdown.discipline'),
      score: breakdown.budgetDiscipline.score,
      max: breakdown.budgetDiscipline.maxPoints,
      value: `${breakdown.budgetDiscipline.value}%`,
      icon: Target,
      color: '#3b82f6',
    },
    {
      label: t('healthBreakdown.consistency'),
      score: breakdown.spendingConsistency.score,
      max: breakdown.spendingConsistency.maxPoints,
      value: `${breakdown.spendingConsistency.value}%`,
      icon: BarChart3,
      color: C.p500,
    },
    {
      label: t('healthBreakdown.goalProgress'),
      score: breakdown.goalProgress.score,
      max: breakdown.goalProgress.maxPoints,
      value: `${breakdown.goalProgress.value}%`,
      icon: Award,
      color: '#f59e0b',
    },
    {
      label: t('healthBreakdown.impulse'),
      score: breakdown.impulseControl.score,
      max: breakdown.impulseControl.maxPoints,
      value: `${breakdown.impulseControl.value}%`,
      icon: Zap,
      color: '#f472b6',
    },
  ];

  const TrendIcon = healthScore.trend === 'up' ? TrendingUp : healthScore.trend === 'down' ? TrendingDown : Minus;

  return (
    <View className="flex-1" style={{ backgroundColor: C.bg }}>
      {/* Header */}
      <LinearGradient
        colors={[healthScore.gradeColor, adjustColor(healthScore.gradeColor, -30)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 40,
          paddingHorizontal: 16,
        }}
      >
        <View className="flex-row items-center justify-between mb-6">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>

          <View className="flex-1 items-center">
            <Text className="text-white text-lg font-bold">{t('healthScore.title')}</Text>
            <Text className="text-white/70 text-xs mt-1">{t('healthScore.breakdownHint')}</Text>
          </View>

          <View className="w-10" />
        </View>

        {/* Score Circle */}
        <View className="items-center">
          <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}>
            <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE}>
              <G rotation="-90" origin={`${CIRCLE_SIZE / 2}, ${CIRCLE_SIZE / 2}`}>
                {/* Background circle */}
                <Circle
                  cx={CIRCLE_SIZE / 2}
                  cy={CIRCLE_SIZE / 2}
                  r={RADIUS}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={STROKE_WIDTH}
                  fill="none"
                />
                {/* Progress circle */}
                <Circle
                  cx={CIRCLE_SIZE / 2}
                  cy={CIRCLE_SIZE / 2}
                  r={RADIUS}
                  stroke="white"
                  strokeWidth={STROKE_WIDTH}
                  fill="none"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </G>
            </Svg>

            {/* Score in center */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 52, fontWeight: '800', textAlign: 'center' }}>{displayScore}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '500', textAlign: 'center', marginTop: 2 }}>Grade: {healthScore.grade}</Text>
            </View>
          </View>

          {/* Trend indicator */}
          <View
            className="flex-row items-center mt-4 px-4 py-2 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
          >
            <TrendIcon size={16} color="white" />
            <Text className="text-white ms-2">
              {healthScore.trend === 'up' && t('healthScore.trendUp', { value: healthScore.trendValue })}
              {healthScore.trend === 'down' && t('healthScore.trendDown', { value: healthScore.trendValue })}
              {healthScore.trend === 'stable' && t('healthScore.stableThisWeek')}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        style={{ marginTop: -20 }}
      >
        {/* Estimated-data notice — the score needs real history to be meaningful */}
        {transactions.length < 5 && (
          <View className="px-4 mb-4">
            <View style={{ backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)', flexDirection: 'row', gap: 10 }}>
              <Info size={16} color="rgba(255,255,255,0.45)" />
              <Text style={{ color: '#fcd34d', fontSize: 13, lineHeight: 19, flex: 1 }}>
                {t('healthScore.estimateNote', { count: transactions.length })}
              </Text>
            </View>
          </View>
        )}

        {/* Personality Card */}
        <Animated.View entering={FadeInUp.delay(200).duration(400)} className="px-4 mb-4">
          <View
            className="rounded-2xl p-4"
            style={{
              backgroundColor: C.glass,
              borderWidth: 1,
              borderColor: `${personality.color}40`,
            }}
          >
            <View className="flex-row items-center mb-3">
              <Text className="text-3xl me-3">{personality.icon}</Text>
              <View className="flex-1">
                <Text style={{ color: C.text }} className="text-lg font-bold">{personality.title}</Text>
                <Text style={{ color: C.textDim }} className="text-sm" numberOfLines={2}>
                  {personality.description}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Score Breakdown */}
        <View className="px-4 mb-4">
          <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-3 ms-1">{t('healthScore.breakdown')}</Text>

          {breakdownItems.map((item, idx) => (
            <Animated.View
              key={item.label}
              entering={FadeInUp.delay(300 + idx * 100).duration(400)}
            >
              <View
                className="rounded-xl p-4 mb-2"
                style={{ backgroundColor: C.glass }}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center me-3"
                      style={{ backgroundColor: `${item.color}20` }}
                    >
                      <item.icon size={20} color={item.color} />
                    </View>
                    <View>
                      <Text style={{ color: C.text }} className="font-medium">{item.label}</Text>
                      <Text style={{ color: C.textFaint }} className="text-xs">{item.value}</Text>
                    </View>
                  </View>
                  <Text style={{ color: C.text }} className="font-bold text-lg">
                    {item.score}/{item.max}
                  </Text>
                </View>

                {/* Progress bar */}
                <View className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.score / item.max) * 100}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </View>
              </View>
            </Animated.View>
          ))}
        </View>

        {/* Suggestions */}
        {healthScore.suggestions.length > 0 && (
          <View className="px-4 mb-4">
            <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-3 ms-1">
              {t('healthScore.howToImprove')}
            </Text>

            {healthScore.suggestions.map((suggestion, idx) => (
              <Animated.View
                key={idx}
                entering={FadeInUp.delay(800 + idx * 100).duration(400)}
              >
                <View
                  className="rounded-xl p-4 mb-2 flex-row items-start"
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 1,
                    borderColor: 'rgba(245, 158, 11, 0.2)',
                  }}
                >
                  <Lightbulb size={18} color="#f59e0b" style={{ marginTop: 2 }} />
                  <Text style={{ color: C.textDim }} className="text-sm ms-3 flex-1">{suggestion}</Text>
                </View>
              </Animated.View>
            ))}
          </View>
        )}

        {/* AI Advisor CTA */}
        <View className="px-4">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(tabs)/advisor');
            }}
          >
            <LinearGradient
              colors={[C.p600, C.p500]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: 16, padding: 16 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <View className="w-12 h-12 rounded-xl bg-white/20 items-center justify-center me-3">
                    <Sparkles size={24} color="white" />
                  </View>
                  <View>
                    <Text className="text-white font-bold">{t('healthScore.getAdvice')}</Text>
                    <Text className="text-white/70 text-xs mt-0.5">
                      {t('healthScore.chatWithAi')}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="white" />
              </View>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// Helper to darken/lighten color
function adjustColor(color: string, amount: number): string {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
