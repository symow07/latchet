import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Field, FormError, PrimaryButton, Screen, SubHeader, Type } from '@/components/kit';
import { S, useC } from '@/lib/design';
import { getSettings, updateSettings } from '@/lib/db';
import { t } from '@/lib/i18n/core';
import { parseAmountInput, profileEdit } from '@/lib/onboarding-flow';

/**
 * Monthly income, on its own: what comes in each month after tax. The advisor
 * reads it to work out what can be saved, and Home sets it against the
 * savings goal. Writes the income and nothing else (profileEdit) — never the
 * starting balance, never the currency.
 */
export default function IncomeScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!settings || loaded) return;
    setLoaded(true);
    if (settings.monthlyIncome > 0) setText(String(settings.monthlyIncome));
  }, [settings, loaded]);

  const save = useMutation({
    mutationFn: async (value: number | null) => updateSettings(profileEdit('income', value)),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      router.back();
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(t('onboardingFlow.incomeEditor.failed'));
    },
  });

  const submit = () => {
    const value = parseAmountInput(text);
    if (value === null || value <= 0) {
      setError(t('onboardingFlow.incomeEditor.invalid'));
      return;
    }
    save.mutate(value);
  };

  const hasIncome = (settings?.monthlyIncome ?? 0) > 0;

  return (
    <Screen pal={C}>
      <SubHeader pal={C} title={t('onboardingFlow.incomeEditor.title')} onBack={() => router.back()} style={{ marginTop: 8 }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: S.section }}>
          <Type role="body" color={C.inkDim}>
            {t('onboardingFlow.incomeEditor.hint')}
          </Type>
          <Field
            pal={C}
            label={t('onboardingFlow.incomeEditor.label')}
            icon={<Type role="cardTitle" color={C.inkDim}>{settings?.currencySymbol ?? ''}</Type>}
            value={text}
            onChangeText={(v) => {
              setText(v);
              setError('');
            }}
            placeholder="2500"
            keyboardType="decimal-pad"
            autoFocus
            style={{ marginTop: S.wide }}
          />
          <FormError pal={C} message={error} />
        </ScrollView>
        <View style={{ paddingHorizontal: S.screen, paddingTop: 12, paddingBottom: insets.bottom + S.group, gap: 12 }}>
          <PrimaryButton pal={C} label={t('onboardingFlow.incomeEditor.save')} onPress={submit} disabled={save.isPending} />
          {hasIncome ? (
            <PrimaryButton
              pal={C}
              variant="secondary"
              label={t('onboardingFlow.incomeEditor.remove')}
              onPress={() => save.mutate(null)}
              disabled={save.isPending}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
