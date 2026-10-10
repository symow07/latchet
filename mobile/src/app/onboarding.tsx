import { View, Pressable, ScrollView, Keyboard } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  ChevronDown,
  CreditCard,
  PiggyBank,
  Target,
  Wallet,
} from '@/components/icons';
import { S, useC } from '@/lib/design';
import {
  ChoiceRow, Field, FormError, IconTile, PrimaryButton, Screen, StepProgress, Type,
} from '@/components/kit';
import * as Haptics from 'expo-haptics';
import { saveOnboardingData } from '@/lib/onboarding-storage';
import { updateSettings } from '@/lib/db';
import { scheduleCloudPush } from '@/lib/cloud-sync';
import { CURRENCIES, getPopularCurrencies, getDefaultCurrency, type Currency } from '@/lib/currencies';
import { t } from '@/lib/i18n/core';

const STEPS = ['currency', 'income', 'goal', 'style'] as const;

// Built per call, not at module scope: t() at module scope resolves
// once at import and freezes the startup language.
function SPENDING_STYLES() {
  return [
  { id: 'frugal', label: t('spendingStyle.frugalLabel'), desc: t('spendingStyle.frugalDesc'), icon: PiggyBank },
  { id: 'moderate', label: t('spendingStyle.moderateLabel'), desc: t('spendingStyle.moderateDesc'), icon: Wallet },
  { id: 'generous', label: t('spendingStyle.generousLabel'), desc: t('spendingStyle.generousDesc'), icon: CreditCard },
];
}

// Built per call, not at module scope: t() at module scope resolves
// once at import and freezes the startup language.
function PRIMARY_GOALS() {
  return [
  { id: 'save', label: t('goals.saveLabel'), desc: t('goals.saveDesc') },
  { id: 'track', label: t('goals.trackLabel'), desc: t('goals.trackDesc') },
  { id: 'reduce_debt', label: t('goals.debtLabel'), desc: t('goals.debtDesc') },
  { id: 'budget', label: t('goals.stickLabel'), desc: t('goals.stickDesc') },
];
}

export default function OnboardingScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Form state
  const [currency, setCurrency] = useState<Currency>(getDefaultCurrency());
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
      // First upload of the account's settings and any starter data.
      scheduleCloudPush(0);
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

  /**
   * One question per step, in the same shape every time: a headline, a
   * sentence, then the choice. The old version wrapped each step in a purple
   * gradient header and hard-coded `rgba(168, 85, 247, …)` selection washes,
   * which is why it stayed purple through the retheme — none of it read a
   * token.
   */
  const renderStep = () => {
    switch (STEPS[step]) {
      case 'currency':
        return (
          <View>
            <Type role="title" color={C.ink}>{t('onboarding.chooseCurrency')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: 24 }}>
              {t('onboarding.chooseCurrencyHint')}
            </Type>

            <ChoiceRow
              pal={C}
              selected
              title={`${currency.code} · ${currency.symbol}`}
              body={currency.name}
              onPress={() => setShowCurrencyPicker((open) => !open)}
              icon={
                <IconTile pal={C}>
                  <Wallet size={20} color={C.accent} strokeWidth={S.stroke} />
                </IconTile>
              }
            />
            <Pressable
              onPress={() => setShowCurrencyPicker((open) => !open)}
              hitSlop={10}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 }}
            >
              <Type role="meta" color={C.accent}>{t('onboarding.changeCurrency')}</Type>
              <ChevronDown size={15} color={C.accent} strokeWidth={S.stroke} />
            </Pressable>

            {/* 75 currencies in a short box with the indicator off showed four
                rows and no sign the rest existed. Taller, and the indicator is
                the only cue that it scrolls at all. */}
            {showCurrencyPicker && (
              <ScrollView
                style={{ maxHeight: 360, marginTop: 16 }}
                showsVerticalScrollIndicator
              >
                <Type role="meta" color={C.inkDim} style={{ marginBottom: 8 }}>
                  {t('onboarding.popular')}
                </Type>
                {popularCurrencies.map((c) => (
                  <ChoiceRow
                    key={c.code}
                    pal={C}
                    title={`${c.code} · ${c.symbol}`}
                    body={c.name}
                    selected={currency.code === c.code}
                    onPress={() => { setCurrency(c); setShowCurrencyPicker(false); }}
                    style={{ marginBottom: 8 }}
                  />
                ))}

                <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
                  {t('onboarding.allCurrencies')}
                </Type>
                {CURRENCIES.filter((c) => !popularCurrencies.find((pc) => pc.code === c.code)).map((c) => (
                  <ChoiceRow
                    key={c.code}
                    pal={C}
                    title={`${c.code} · ${c.symbol}`}
                    body={c.name}
                    selected={currency.code === c.code}
                    onPress={() => { setCurrency(c); setShowCurrencyPicker(false); }}
                    style={{ marginBottom: 8 }}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        );

      case 'income':
        return (
          <View>
            <Type role="title" color={C.ink}>{t('onboarding.yourIncome')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: 24 }}>
              {t('onboarding.incomeHint')}
            </Type>

            <Field
              pal={C}
              label={t('onboarding.monthlyIncome')}
              icon={<Type role="cardTitle" color={C.inkDim}>{currency.symbol}</Type>}
              value={monthlyIncome}
              onChangeText={setMonthlyIncome}
              placeholder="5000"
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              blurOnSubmit
            />

            <Field
              pal={C}
              label={t('onboarding.savingsGoal')}
              icon={<Target size={19} color={C.inkDim} strokeWidth={S.stroke} />}
              value={savingsGoal}
              onChangeText={setSavingsGoal}
              placeholder="500"
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              blurOnSubmit
              style={{ marginTop: 16 }}
            />
          </View>
        );

      case 'goal':
        return (
          <View>
            <Type role="title" color={C.ink}>{t('onboarding.primaryGoal')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: 24 }}>
              {t('onboarding.primaryGoalHint')}
            </Type>
            <View style={{ gap: 12 }}>
              {PRIMARY_GOALS().map((goal) => (
                <ChoiceRow
                  key={goal.id}
                  pal={C}
                  title={goal.label}
                  body={goal.desc}
                  selected={primaryGoal === goal.id}
                  onPress={() => setPrimaryGoal(goal.id as typeof primaryGoal)}
                />
              ))}
            </View>
          </View>
        );

      case 'style':
        return (
          <View>
            <Type role="title" color={C.ink}>{t('onboarding.spendingStyle')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: 24 }}>
              {t('onboarding.spendingStyleHint')}
            </Type>
            <View style={{ gap: 12 }}>
              {SPENDING_STYLES().map((style) => {
                const Icon = style.icon;
                return (
                  <ChoiceRow
                    key={style.id}
                    pal={C}
                    title={style.label}
                    body={style.desc}
                    selected={spendingStyle === style.id}
                    onPress={() => setSpendingStyle(style.id as typeof spendingStyle)}
                    icon={
                      <IconTile pal={C}>
                        <Icon size={20} color={C.accent} strokeWidth={S.stroke} />
                      </IconTile>
                    }
                  />
                );
              })}
            </View>
          </View>
        );
    }
  };

  return (
    <Screen pal={C}>
      <View style={{ paddingHorizontal: S.screen, paddingTop: 16 }}>
        <Type role="meta" color={C.inkDim} style={{ marginBottom: 12 }}>
          {t('onboarding.stepCounter', { step: step + 1, total: STEPS.length })}
        </Type>
        <StepProgress pal={C} total={STEPS.length} current={step} />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        {/* The step absorbs the slack, rather than `space-between` sharing it
            out. Under KeyboardAwareScrollView the container is taller than the
            viewport by the space it reserves for a keyboard, so "distribute
            the gap between the two children" left the button floating well
            above the bottom of the screen with a band of empty bone under it.
            Making the top child grow puts the button on the floor whatever the
            container decides its own height is. */}
        <View style={{ flexGrow: 1, paddingHorizontal: S.screen, paddingTop: S.section }}>
          {renderStep()}
        </View>

        <View style={{ paddingHorizontal: S.screen, paddingTop: 24, paddingBottom: insets.bottom + 24 }}>
          {saveMutation.isError ? (
            <FormError pal={C} message={t('onboarding.failed')} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
            {step > 0 ? (
              <PrimaryButton
                pal={C}
                variant="secondary"
                label={t('common.back')}
                onPress={prevStep}
                style={{ flex: 1 }}
              />
            ) : null}
            <PrimaryButton
              pal={C}
              label={
                step === STEPS.length - 1
                  ? saveMutation.isPending
                    ? t('onboarding.settingUp')
                    : t('onboarding.getStarted')
                  : t('common.continue')
              }
              onPress={nextStep}
              disabled={saveMutation.isPending}
              style={{ flex: step > 0 ? 1.4 : 1 }}
            />
          </View>
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  );
}
