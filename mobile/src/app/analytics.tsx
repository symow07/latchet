import {
  View,
  Text,
  ScrollView,
  Pressable,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Calendar,
  Zap,
  ChevronRight,
  AlertCircle,
  Lightbulb,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { getTransactions, getSettings } from '@/lib/db';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/category-meta';
import {
  generateAnalyticsSummary,
  type AnalyticsSummary,
  type DetectedSubscription,
  type WasteCategory,
  type UnusualTransaction,
  type SpendingPattern,
} from '@/lib/behavior-detection';

type TabType = 'overview' | 'subscriptions' | 'insights' | 'alerts';

export default function AnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  // Analyze spending when data loads - use length to avoid unnecessary re-runs
  const transactionsLength = transactions.length;
  useEffect(() => {
    if (transactionsLength > 0) {
      const summary = generateAnalyticsSummary(transactions);
      setAnalytics(summary);
    }
  }, [transactionsLength, transactions]);

  const formatCurrency = (amount: number) => {
    const symbol = settings?.currencySymbol || '$';
    return `${symbol}${amount.toFixed(2)}`;
  };

  const tabs: { id: TabType; label: string; icon: typeof TrendingUp }[] = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'subscriptions', label: 'Subscriptions', icon: RefreshCw },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
  ];

  return (
    <View className="flex-1 bg-[#0c0716]">
      {/* Header */}
      <LinearGradient
        colors={['#f59e0b', '#d97706', '#b45309']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 20,
          paddingHorizontal: 16,
        }}
      >
        <View className="flex-row items-center justify-between">
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
            <Text className="text-white text-lg font-bold">{t('analytics.title')}</Text>
            <Text className="text-white/70 text-xs mt-1">{t('analytics.behaviorDetection')}</Text>
          </View>
          <View className="w-10" />
        </View>

        {/* Quick Stats */}
        {analytics && (
          <View className="flex-row mt-4 gap-3">
            <View className="flex-1 bg-white/20 rounded-xl p-3">
              <Text className="text-white/70 text-xs">{t('analytics.potentialSavings')}</Text>
              <Text className="text-white text-xl font-bold">
                {formatCurrency(analytics.potentialMonthlySavings)}
              </Text>
            </View>
            <View className="flex-1 bg-white/20 rounded-xl p-3">
              <Text className="text-white/70 text-xs">{t('analytics.activeAlerts')}</Text>
              <Text className="text-white text-xl font-bold">{analytics.alertCount}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {/* Tab Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="border-b border-gray-800"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        style={{ flexGrow: 0 }}
      >
        {tabs.map(tab => (
          <Pressable
            key={tab.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(tab.id);
            }}
            className="mr-3"
          >
            <View
              className={`flex-row items-center px-4 py-2 rounded-full ${
                activeTab === tab.id ? 'bg-amber-500' : 'bg-gray-800'
              }`}
            >
              <tab.icon size={16} color={activeTab === tab.id ? 'white' : '#9ca3af'} />
              <Text
                className={`ml-2 text-sm font-medium ${
                  activeTab === tab.id ? 'text-white' : 'text-gray-400'
                }`}
              >
                {tab.label}
              </Text>
              {tab.id === 'alerts' && analytics && analytics.alertCount > 0 && (
                <View className="ml-2 bg-red-500 rounded-full w-5 h-5 items-center justify-center">
                  <Text className="text-white text-xs font-bold">{analytics.alertCount}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Overview Tab */}
        {activeTab === 'overview' && analytics && (
          <Animated.View entering={FadeInUp.duration(400)} className="px-4 pt-4">
            {/* Top Waste Categories */}
            <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">
              TOP WASTE CATEGORIES THIS MONTH
            </Text>
            {analytics.wasteCategories.map((waste, idx) => (
              <WasteCategoryCard key={idx} waste={waste} formatCurrency={formatCurrency} index={idx} />
            ))}

            {/* Spending Patterns */}
            {analytics.spendingPatterns.length > 0 && (
              <>
                <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1 mt-6">
                  SPENDING PATTERNS DETECTED
                </Text>
                {analytics.spendingPatterns.map((pattern, idx) => (
                  <SpendingPatternCard key={idx} pattern={pattern} formatCurrency={formatCurrency} />
                ))}
              </>
            )}

            {/* Monthly Subscriptions Total */}
            <View className="mt-6">
              <View
                className="rounded-2xl p-4"
                style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)' }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 rounded-xl bg-purple-500/20 items-center justify-center mr-3">
                      <RefreshCw size={20} color="#a855f7" />
                    </View>
                    <View>
                      <Text className="text-gray-400 text-xs">{t('analytics.monthlySubscriptions')}</Text>
                      <Text className="text-white text-xl font-bold">
                        {formatCurrency(analytics.totalMonthlySubscriptions)}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setActiveTab('subscriptions');
                    }}
                  >
                    <ChevronRight size={20} color="#a855f7" />
                  </Pressable>
                </View>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Subscriptions Tab */}
        {activeTab === 'subscriptions' && analytics && (
          <Animated.View entering={FadeInUp.duration(400)} className="px-4 pt-4">
            <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">
              DETECTED RECURRING CHARGES ({analytics.subscriptions.length})
            </Text>
            {analytics.subscriptions.length === 0 ? (
              <View
                className="rounded-2xl p-6 items-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <RefreshCw size={32} color="#6b7280" />
                <Text className="text-gray-400 mt-3 text-center">
                  No recurring subscriptions detected yet.{'\n'}Keep tracking to find patterns.
                </Text>
              </View>
            ) : (
              analytics.subscriptions.map((sub, idx) => (
                <SubscriptionCard key={idx} subscription={sub} formatCurrency={formatCurrency} />
              ))
            )}
          </Animated.View>
        )}

        {/* Insights Tab */}
        {activeTab === 'insights' && analytics && (
          <Animated.View entering={FadeInUp.duration(400)} className="px-4 pt-4">
            {/* Waste Category Tips */}
            <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">
              PERSONALIZED SAVINGS TIPS
            </Text>
            {analytics.wasteCategories.map((waste, idx) => (
              <Animated.View
                key={idx}
                entering={FadeInUp.delay(100 * idx).duration(300)}
                className="mb-3"
              >
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  <View className="flex-row items-start">
                    <View className="w-8 h-8 rounded-lg bg-amber-500/20 items-center justify-center mr-3">
                      <Lightbulb size={16} color="#f59e0b" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-medium">{categoryLabel(waste.category)}</Text>
                      <Text className="text-gray-400 text-sm mt-1">{waste.tip}</Text>
                      <Text className="text-amber-400 text-xs mt-2">
                        Potential savings: {formatCurrency(waste.potentialSavings)}/month
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>
            ))}

            {/* Spending Patterns Insights */}
            {analytics.spendingPatterns.length > 0 && (
              <>
                <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1 mt-6">
                  BEHAVIORAL INSIGHTS
                </Text>
                {analytics.spendingPatterns.map((pattern, idx) => (
                  <View
                    key={idx}
                    className="rounded-xl p-4 mb-3"
                    style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                  >
                    <View className="flex-row items-start">
                      <View className="w-8 h-8 rounded-lg bg-blue-500/20 items-center justify-center mr-3">
                        {pattern.type === 'weekend' ? (
                          <Calendar size={16} color="#3b82f6" />
                        ) : (
                          <TrendingUp size={16} color="#3b82f6" />
                        )}
                      </View>
                      <View className="flex-1">
                        <Text className="text-white font-medium">
                          {pattern.type === 'weekend' ? 'Weekend Spending' : 'Seasonal Trend'}
                        </Text>
                        <Text className="text-gray-400 text-sm mt-1">{pattern.insight}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </>
            )}
          </Animated.View>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && analytics && (
          <Animated.View entering={FadeInUp.duration(400)} className="px-4 pt-4">
            {/* Duplicate Charges */}
            {analytics.duplicateCharges.length > 0 && (
              <>
                <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">
                  POSSIBLE DUPLICATE CHARGES
                </Text>
                {analytics.duplicateCharges.map((dup, idx) => (
                  <View
                    key={idx}
                    className="rounded-xl p-4 mb-3"
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' }}
                  >
                    <View className="flex-row items-center mb-2">
                      <AlertCircle size={16} color="#ef4444" />
                      <Text className="text-red-400 font-medium ml-2">{t('analytics.duplicateDetected')}</Text>
                    </View>
                    <Text className="text-white">{dup.description}</Text>
                    <Text className="text-gray-400 text-sm">
                      {dup.transactions.length} charges of {formatCurrency(dup.amount)} on {dup.date}
                    </Text>
                    <Text className="text-amber-400 text-xs mt-2">
                      Potential refund: {formatCurrency(dup.potentialRefund)}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {/* Unusual Transactions */}
            {analytics.unusualTransactions.length > 0 && (
              <>
                <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1 mt-4">
                  UNUSUAL TRANSACTIONS
                </Text>
                {analytics.unusualTransactions.map((unusual, idx) => (
                  <UnusualTransactionCard
                    key={idx}
                    unusual={unusual}
                    formatCurrency={formatCurrency}
                  />
                ))}
              </>
            )}

            {/* No Alerts */}
            {analytics.alertCount === 0 && (
              <View
                className="rounded-2xl p-6 items-center"
                style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}
              >
                <View className="w-12 h-12 rounded-full bg-green-500/20 items-center justify-center mb-3">
                  <Zap size={24} color="#22c55e" />
                </View>
                <Text className="text-green-400 font-semibold text-lg">{t('analytics.allClear')}</Text>
                <Text className="text-gray-400 text-center mt-2">
                  No suspicious activity or duplicate charges detected.
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

// Component Cards
function WasteCategoryCard({
  waste,
  formatCurrency,
  index,
}: {
  waste: WasteCategory;
  formatCurrency: (n: number) => string;
  index: number;
}) {
  const colors = ['#ef4444', '#f59e0b', '#eab308'];
  const color = colors[index] || '#6b7280';

  return (
    <Animated.View
      entering={FadeInUp.delay(100 * index).duration(300)}
      className="mb-3"
    >
      <View
        className="rounded-xl p-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center">
            <View
              className="w-8 h-8 rounded-lg items-center justify-center mr-3"
              style={{ backgroundColor: `${color}20` }}
            >
              <Text style={{ color, fontWeight: 'bold' }}>#{index + 1}</Text>
            </View>
            <Text className="text-white font-semibold">{categoryLabel(waste.category)}</Text>
          </View>
          <Text className="text-white font-bold">{formatCurrency(waste.totalSpent)}</Text>
        </View>

        <View className="flex-row justify-between">
          <View>
            <Text className="text-gray-500 text-xs">{t('importExtra.impulse')}</Text>
            <Text className="text-pink-400 font-medium">
              {formatCurrency(waste.impulseSpent)} ({Math.round(waste.impulsePercentage)}%)
            </Text>
          </View>
          <View>
            <Text className="text-gray-500 text-xs">{t('analytics.transactions')}</Text>
            <Text className="text-gray-300 font-medium">{waste.transactionCount}</Text>
          </View>
          <View>
            <Text className="text-gray-500 text-xs">Avg</Text>
            <Text className="text-gray-300 font-medium">
              {formatCurrency(waste.averageTransaction)}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function SubscriptionCard({
  subscription,
  formatCurrency,
}: {
  subscription: DetectedSubscription;
  formatCurrency: (n: number) => string;
}) {
  return (
    <View
      className="rounded-xl p-4 mb-3"
      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-white font-semibold flex-1" numberOfLines={1}>
          {subscription.description}
        </Text>
        <View className="bg-purple-500/20 rounded-full px-2 py-0.5 ml-2">
          <Text className="text-purple-400 text-xs capitalize">{subscription.frequency}</Text>
        </View>
      </View>

      <View className="flex-row justify-between items-center">
        <View>
          <Text className="text-gray-500 text-xs">{t('analytics.amount')}</Text>
          <Text className="text-white font-bold text-lg">
            {formatCurrency(subscription.amount)}
          </Text>
        </View>
        <View>
          <Text className="text-gray-500 text-xs">{t('analytics.totalSpent')}</Text>
          <Text className="text-gray-300">{formatCurrency(subscription.totalSpent)}</Text>
        </View>
        <View>
          <Text className="text-gray-500 text-xs">{t('analytics.nextDue')}</Text>
          <Text className="text-amber-400">{subscription.nextExpected}</Text>
        </View>
      </View>
    </View>
  );
}

function SpendingPatternCard({
  pattern,
  formatCurrency,
}: {
  pattern: SpendingPattern;
  formatCurrency: (n: number) => string;
}) {
  return (
    <View
      className="rounded-xl p-4 mb-3"
      style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)' }}
    >
      <View className="flex-row items-center mb-2">
        {pattern.type === 'weekend' ? (
          <Calendar size={16} color="#3b82f6" />
        ) : (
          <TrendingUp size={16} color="#3b82f6" />
        )}
        <Text className="text-blue-400 font-medium ml-2">
          {pattern.type === 'weekend' ? 'Weekend Spike' : 'Seasonal Change'}
        </Text>
      </View>
      <Text className="text-gray-300 text-sm">{pattern.insight}</Text>
      <View className="flex-row mt-2">
        {pattern.topCategories.map((cat, idx) => (
          <View key={idx} className="bg-blue-500/20 rounded-full px-2 py-1 mr-2">
            <Text className="text-blue-300 text-xs">
              {categoryLabel(cat.category)}: {formatCurrency(cat.amount)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function UnusualTransactionCard({
  unusual,
  formatCurrency,
}: {
  unusual: UnusualTransaction;
  formatCurrency: (n: number) => string;
}) {
  const severityColors = {
    low: { bg: 'rgba(234, 179, 8, 0.1)', border: 'rgba(234, 179, 8, 0.2)', text: '#eab308' },
    medium: { bg: 'rgba(249, 115, 22, 0.1)', border: 'rgba(249, 115, 22, 0.2)', text: '#f97316' },
    high: { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.2)', text: '#ef4444' },
  };

  const colors = severityColors[unusual.severity];

  return (
    <View
      className="rounded-xl p-4 mb-3"
      style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <AlertTriangle size={16} color={colors.text} />
          <Text style={{ color: colors.text }} className="font-medium ml-2 capitalize">
            {unusual.severity} Priority
          </Text>
        </View>
        <Text className="text-white font-bold">
          {formatCurrency(unusual.transaction.amount)}
        </Text>
      </View>
      <Text className="text-white" numberOfLines={1}>
        {unusual.transaction.note || unusual.transaction.category}
      </Text>
      <Text className="text-gray-400 text-sm mt-1">{unusual.reason}</Text>
      <Text className="text-gray-500 text-xs mt-1">
        Avg for {unusual.transaction.category}: {formatCurrency(unusual.averageForCategory)}
      </Text>
    </View>
  );
}
