import { View, Text, Pressable, ScrollView, TextInput, Keyboard } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  ArrowRight,
  ArrowLeft,
  DollarSign,
  Target,
  Wallet,
  PiggyBank,
  CreditCard,
  ChevronDown,
  Check,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { saveOnboardingData } from '@/lib/onboarding-storage';
import { updateSettings } from '@/lib/db';
import { CURRENCIES, getPopularCurrencies, type Currency } from '@/lib/currencies';

const STEPS = ['currency', 'income', 'goal', 'style'] as const;

const SPENDING_STYLES = [
  { id: 'frugal', label: 'Frugal', desc: 'I save as much as possible', icon: PiggyBank },
  { id: 'moderate', label: 'Moderate', desc: 'I balance spending and saving', icon: Wallet },
  { id: 'generous', label: 'Generous', desc: 'I enjoy spending on experiences', icon: CreditCard },
];

const PRIMARY_GOALS = [
  { id: 'save', label: 'Save More', desc: 'Build emergency fund or savings' },
  { id: 'track', label: 'Track Spending', desc: 'Know where my money goes' },
  { id: 'reduce_debt', label: 'Reduce Debt', desc: 'Pay off loans and credit cards' },
  { id: 'budget', label: 'Stick to Budget', desc: 'Stay within spending limits' },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Form state
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]);
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [savingsGoal, setSavingsGoal] = useState('');
  const [spendingStyle, setSpendingStyle] = useState<'frugal' | 'moderate' | 'generous'>('moderate');
  const [primaryGoal, setPrimaryGoal] = useState<'save' | 'track' | 'reduce_debt' | 'budget'>('track');

  const popularCurrencies = getPopularCurrencies();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const income = parseFloat(monthlyIncome) || 0;
      const savings = parseFloat(savingsGoal) || 0;

      // Calculate suggested budget based on spending style
      let budgetMultiplier = 0.7; // default moderate
      if (spendingStyle === 'frugal') budgetMultiplier = 0.5;
      if (spendingStyle === 'generous') budgetMultiplier = 0.85;

      const suggestedBudget = income * budgetMultiplier;

      await saveOnboardingData({
        monthlyIncome: income,
        savingsGoal: savings,
        spendingStyle,
        primaryGoal,
        currency: currency.code,
        currencySymbol: currency.symbol,
        completed: true,
      });

      await updateSettings({
        currency: currency.code,
        currencySymbol: currency.symbol,
        monthlyIncome: income,
        savingsGoal: savings,
        spendingStyle,
        primaryGoal,
        monthlyBudget: suggestedBudget,
        startingBalance: 0,
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    },
    onError: (error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('[Onboarding] Failed to save:', error);
    },
  });

  const nextStep = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      saveMutation.mutate();
    }
  };

  const prevStep = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const renderStep = () => {
    switch (STEPS[step]) {
      case 'currency':
        return (
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white mb-2">Choose Your Currency</Text>
            <Text className="text-gray-400 mb-6">Select the currency you use most often</Text>

            {/* Selected Currency */}
            <Pressable
              onPress={() => setShowCurrencyPicker(!showCurrencyPicker)}
              className="mb-4"
            >
              <View
                className="rounded-2xl p-4 flex-row items-center justify-between"
                style={{ backgroundColor: 'rgba(168, 85, 247, 0.2)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.5)' }}
              >
                <View className="flex-row items-center">
                  <Text className="text-3xl mr-3">{currency.symbol}</Text>
                  <View>
                    <Text className="text-white font-semibold">{currency.code}</Text>
                    <Text className="text-gray-400 text-sm">{currency.name}</Text>
                  </View>
                </View>
                <ChevronDown size={20} color="#a855f7" />
              </View>
            </Pressable>

            {/* Currency List */}
            {showCurrencyPicker && (
              <ScrollView className="max-h-64 mb-4" showsVerticalScrollIndicator={false}>
                <Text className="text-gray-500 text-xs mb-2 ml-1">POPULAR</Text>
                {popularCurrencies.map((c) => (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setCurrency(c);
                      setShowCurrencyPicker(false);
                    }}
                    className="mb-2"
                  >
                    <View
                      className="rounded-xl p-3 flex-row items-center justify-between"
                      style={{
                        backgroundColor: currency.code === c.code ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <View className="flex-row items-center">
                        <Text className="text-xl mr-3 w-8">{c.symbol}</Text>
                        <Text className="text-white">{c.code} - {c.name}</Text>
                      </View>
                      {currency.code === c.code && <Check size={18} color="#a855f7" />}
                    </View>
                  </Pressable>
                ))}

                <Text className="text-gray-500 text-xs mb-2 mt-4 ml-1">ALL CURRENCIES</Text>
                {CURRENCIES.filter(c => !popularCurrencies.find(p => p.code === c.code)).map((c) => (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setCurrency(c);
                      setShowCurrencyPicker(false);
                    }}
                    className="mb-2"
                  >
                    <View
                      className="rounded-xl p-3 flex-row items-center justify-between"
                      style={{
                        backgroundColor: currency.code === c.code ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <View className="flex-row items-center">
                        <Text className="text-xl mr-3 w-8">{c.symbol}</Text>
                        <Text className="text-white text-sm">{c.code} - {c.name}</Text>
                      </View>
                      {currency.code === c.code && <Check size={18} color="#a855f7" />}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        );

      case 'income':
        return (
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white mb-2">Your Monthly Income</Text>
            <Text className="text-gray-400 mb-6">This helps us suggest a realistic budget</Text>

            <View className="mb-6">
              <Text className="text-gray-400 text-sm mb-2 ml-1">Monthly Income</Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <View className="w-10 h-10 rounded-xl bg-green-500/20 items-center justify-center mr-3">
                  <DollarSign size={20} color="#22c55e" />
                </View>
                <Text className="text-white text-xl mr-1">{currency.symbol}</Text>
                <TextInput
                  value={monthlyIncome}
                  onChangeText={setMonthlyIncome}
                  placeholder="5000"
                  placeholderTextColor="#555"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  blurOnSubmit
                  className="flex-1 text-white text-xl font-semibold"
                  selectionColor="#a855f7"
                />
              </View>
            </View>

            <View>
              <Text className="text-gray-400 text-sm mb-2 ml-1">Monthly Savings Goal (Optional)</Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <View className="w-10 h-10 rounded-xl bg-purple-500/20 items-center justify-center mr-3">
                  <Target size={20} color="#a855f7" />
                </View>
                <Text className="text-white text-xl mr-1">{currency.symbol}</Text>
                <TextInput
                  value={savingsGoal}
                  onChangeText={setSavingsGoal}
                  placeholder="500"
                  placeholderTextColor="#555"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  blurOnSubmit
                  className="flex-1 text-white text-xl font-semibold"
                  selectionColor="#a855f7"
                />
              </View>
            </View>
          </View>
        );

      case 'goal':
        return (
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white mb-2">Your Primary Goal</Text>
            <Text className="text-gray-400 mb-6">We'll customize your experience based on this</Text>

            <View className="gap-3">
              {PRIMARY_GOALS.map((goal) => (
                <Pressable
                  key={goal.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setPrimaryGoal(goal.id as typeof primaryGoal);
                  }}
                >
                  <View
                    className="rounded-2xl p-4 flex-row items-center"
                    style={{
                      backgroundColor: primaryGoal === goal.id ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                      borderWidth: primaryGoal === goal.id ? 1 : 0,
                      borderColor: 'rgba(168, 85, 247, 0.5)',
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-white font-semibold text-lg">{goal.label}</Text>
                      <Text className="text-gray-500 text-sm">{goal.desc}</Text>
                    </View>
                    {primaryGoal === goal.id && (
                      <View className="w-6 h-6 rounded-full bg-purple-500 items-center justify-center">
                        <Check size={14} color="white" />
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        );

      case 'style':
        return (
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white mb-2">Your Spending Style</Text>
            <Text className="text-gray-400 mb-6">How would you describe your spending habits?</Text>

            <View className="gap-3">
              {SPENDING_STYLES.map((style) => {
                const Icon = style.icon;
                return (
                  <Pressable
                    key={style.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSpendingStyle(style.id as typeof spendingStyle);
                    }}
                  >
                    <View
                      className="rounded-2xl p-4 flex-row items-center"
                      style={{
                        backgroundColor: spendingStyle === style.id ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                        borderWidth: spendingStyle === style.id ? 1 : 0,
                        borderColor: 'rgba(168, 85, 247, 0.5)',
                      }}
                    >
                      <View className="w-12 h-12 rounded-xl bg-purple-500/20 items-center justify-center mr-4">
                        <Icon size={24} color="#a855f7" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-white font-semibold text-lg">{style.label}</Text>
                        <Text className="text-gray-500 text-sm">{style.desc}</Text>
                      </View>
                      {spendingStyle === style.id && (
                        <View className="w-6 h-6 rounded-full bg-purple-500 items-center justify-center">
                          <Check size={14} color="white" />
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
    }
  };

  return (
    <View className="flex-1 bg-[#0d0d0f]">
      {/* Header */}
      <LinearGradient
        colors={['#7c3aed', '#a855f7', '#c084fc', '#1e1b2e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 20,
          paddingBottom: 24,
          paddingHorizontal: 24,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        }}
      >
        <Text className="text-white/70 text-sm">Step {step + 1} of {STEPS.length}</Text>
        <View className="flex-row mt-2 gap-2">
          {STEPS.map((_, idx) => (
            <View
              key={idx}
              className="flex-1 h-1 rounded-full"
              style={{ backgroundColor: idx <= step ? '#fff' : 'rgba(255,255,255,0.3)' }}
            />
          ))}
        </View>
      </LinearGradient>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        {/* Content */}
        <View className="px-6 pt-8">
          {renderStep()}
        </View>

        {/* Navigation */}
        <View className="px-6 pb-8" style={{ paddingBottom: insets.bottom + 24, paddingTop: 24 }}>
          {saveMutation.isError && (
            <View className="mb-3 px-4 py-3 rounded-xl" style={{ backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' }}>
              <Text className="text-red-400 text-sm text-center">Something went wrong. Please try again.</Text>
            </View>
          )}
          <View className="flex-row gap-3">
            {step > 0 && (
              <Pressable
                onPress={prevStep}
                className="flex-row items-center justify-center px-6 py-4 rounded-2xl"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <ArrowLeft size={20} color="#9ca3af" />
                <Text className="text-gray-400 font-semibold ml-2">Back</Text>
              </Pressable>
            )}

            <Pressable
              onPress={nextStep}
              disabled={saveMutation.isPending}
              className="flex-1 active:scale-98"
            >
              <LinearGradient
                colors={saveMutation.isPending ? ['#374151', '#374151'] : ['#7c3aed', '#a855f7']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 16,
                  paddingVertical: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text className="text-white font-bold text-lg mr-2">
                  {step === STEPS.length - 1
                    ? saveMutation.isPending
                      ? 'Setting up...'
                      : 'Get Started'
                    : 'Continue'}
                </Text>
                {!saveMutation.isPending && <ArrowRight size={20} color="white" />}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
