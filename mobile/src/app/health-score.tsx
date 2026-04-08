import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
} from 'react-native';
import { useState, useEffect } from 'react';
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
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { getTransactions, getSettings } from '@/lib/db';
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
    if (transactions.length > 0 && settings) {
      const score = calculateHealthScore(transactions, settings);
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
      <View className="flex-1 bg-[#0d0d0f] items-center justify-center">
        <Text className="text-gray-400">Loading...</Text>
      </View>
    );
  }

  const personality = getPersonalityDescription(healthScore.personalityType);
  const { breakdown } = healthScore;
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  const breakdownItems = [
    {
      label: 'Savings Rate',
      score: breakdown.savingsRate.score,
      max: breakdown.savingsRate.maxPoints,
      value: `${breakdown.savingsRate.value}%`,
      icon: PiggyBank,
      color: '#22c55e',
    },
    {
      label: 'Budget Discipline',
      score: breakdown.budgetDiscipline.score,
      max: breakdown.budgetDiscipline.maxPoints,
      value: `${breakdown.budgetDiscipline.value}%`,
      icon: Target,
      color: '#3b82f6',
    },
    {
      label: 'Spending Consistency',
      score: breakdown.spendingConsistency.score,
      max: breakdown.spendingConsistency.maxPoints,
      value: `${breakdown.spendingConsistency.value}%`,
      icon: BarChart3,
      color: '#a855f7',
    },
    {
      label: 'Goal Progress',
      score: breakdown.goalProgress.score,
      max: breakdown.goalProgress.maxPoints,
      value: `${breakdown.goalProgress.value}%`,
      icon: Award,
      color: '#f59e0b',
    },
    {
      label: 'Impulse Control',
      score: breakdown.impulseControl.score,
      max: breakdown.impulseControl.maxPoints,
      value: `${breakdown.impulseControl.value}%`,
      icon: Zap,
      color: '#f472b6',
    },
  ];

  const TrendIcon = healthScore.trend === 'up' ? TrendingUp : healthScore.trend === 'down' ? TrendingDown : Minus;

  return (
    <View className="flex-1 bg-[#0d0d0f]">
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
            <Text className="text-white text-lg font-bold">Financial Health</Text>
            <Text className="text-white/70 text-xs mt-1">Your complete score breakdown</Text>
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
            <View className="absolute inset-0 items-center justify-center">
              <Text className="text-white text-5xl font-bold">{displayScore}</Text>
              <Text className="text-white/80 text-lg font-medium">Grade: {healthScore.grade}</Text>
            </View>
          </View>

          {/* Trend indicator */}
          <View
            className="flex-row items-center mt-4 px-4 py-2 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
          >
            <TrendIcon size={16} color="white" />
            <Text className="text-white ml-2">
              {healthScore.trend === 'up' && `↑ ${healthScore.trendValue}% better than last week`}
              {healthScore.trend === 'down' && `↓ ${healthScore.trendValue}% from last week`}
              {healthScore.trend === 'stable' && 'Stable this week'}
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
        {/* Personality Card */}
        <Animated.View entering={FadeInUp.delay(200).duration(400)} className="px-4 mb-4">
          <View
            className="rounded-2xl p-4"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: `${personality.color}40`,
            }}
          >
            <View className="flex-row items-center mb-3">
              <Text className="text-3xl mr-3">{personality.icon}</Text>
              <View className="flex-1">
                <Text className="text-white text-lg font-bold">{personality.title}</Text>
                <Text className="text-gray-400 text-sm" numberOfLines={2}>
                  {personality.description}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Score Breakdown */}
        <View className="px-4 mb-4">
          <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">SCORE BREAKDOWN</Text>

          {breakdownItems.map((item, idx) => (
            <Animated.View
              key={item.label}
              entering={FadeInUp.delay(300 + idx * 100).duration(400)}
            >
              <View
                className="rounded-xl p-4 mb-2"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                      style={{ backgroundColor: `${item.color}20` }}
                    >
                      <item.icon size={20} color={item.color} />
                    </View>
                    <View>
                      <Text className="text-white font-medium">{item.label}</Text>
                      <Text className="text-gray-500 text-xs">{item.value}</Text>
                    </View>
                  </View>
                  <Text className="text-white font-bold text-lg">
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
            <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">
              HOW TO IMPROVE YOUR SCORE
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
                  <Text className="text-gray-300 text-sm ml-3 flex-1">{suggestion}</Text>
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
              colors={['#7c3aed', '#a855f7']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: 16, padding: 16 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <View className="w-12 h-12 rounded-xl bg-white/20 items-center justify-center mr-3">
                    <Sparkles size={24} color="white" />
                  </View>
                  <View>
                    <Text className="text-white font-bold">Get Personalized Advice</Text>
                    <Text className="text-white/70 text-xs mt-0.5">
                      Chat with AI about your health score
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
