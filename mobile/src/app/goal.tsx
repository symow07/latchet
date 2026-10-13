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
 * The savings goal, on its own.
 *
 * Home's "Set a goal" used to open onboarding again, which wrote the currency
 * and a zero starting balance over the account's own. This writes the goal
 * and nothing else (profileEdit), and is reached from Home's insight, its
 * getting-started checklist and Settings.
 */
export default function GoalScreen() {
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
    if (settings.savingsGoal > 0) setText(String(settings.savingsGoal));
  }, [settings, loaded]);

  const save = useMutation({
    mutationFn: async (value: number | null) => updateSettings(profileEdit('goal', value)),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      router.back();
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(t('onboardingFlow.goal.failed'));
    },
  });

  const submit = () => {
    const value = parseAmountInput(text);
    if (value === null || value <= 0) {
      setError(t('onboardingFlow.goal.invalid'));
      return;
    }
    save.mutate(value);
  };

  const hasGoal = (settings?.savingsGoal ?? 0) > 0;

  return (
    <Screen pal={C}>
      <SubHeader pal={C} title={t('onboardingFlow.goal.title')} onBack={() => router.back()} style={{ marginTop: 8 }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: S.section }}>
          <Type role="body" color={C.inkDim}>
            {t('onboardingFlow.goal.hint')}
          </Type>
          <Field
            pal={C}
            label={t('onboardingFlow.goal.label')}
            icon={<Type role="cardTitle" color={C.inkDim}>{settings?.currencySymbol ?? ''}</Type>}
            value={text}
            onChangeText={(v) => {
              setText(v);
              setError('');
            }}
            placeholder="250"
            keyboardType="decimal-pad"
            autoFocus
            style={{ marginTop: S.wide }}
          />
          <FormError pal={C} message={error} />
        </ScrollView>
        <View style={{ paddingHorizontal: S.screen, paddingTop: 12, paddingBottom: insets.bottom + S.group, gap: 12 }}>
          <PrimaryButton pal={C} label={t('onboardingFlow.goal.save')} onPress={submit} disabled={save.isPending} />
          {hasGoal ? (
            <PrimaryButton
              pal={C}
              variant="secondary"
              label={t('onboardingFlow.goal.remove')}
              onPress={() => save.mutate(null)}
              disabled={save.isPending}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
