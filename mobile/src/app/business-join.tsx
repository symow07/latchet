import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Users } from '@/components/icons';
import { Field, FormError, IconTile, PrimaryButton, Screen, SubHeader, Type } from '@/components/kit';
import { S, useC } from '@/lib/design';
import { t } from '@/lib/i18n/core';
import { joinBusiness } from '@/lib/businessApi';
import { useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';
import {
  inviteCodeProblem,
  joinErrorMessage,
  joinFailure,
  normalizeInviteCode,
} from '@/lib/onboarding-flow';

/**
 * Join a company with the invite code its owner or a manager shared — beside
 * "Create a business" on the profile picker.
 *
 * The code is checked for shape here and for truth on the server; each way it
 * can fail says what to do (lib/onboarding-flow.ts joinFailure): a code no
 * company has, too many tries (five a quarter hour), already a member, or no
 * connection. Once in, the account is a business one and lands on the
 * business tabs — without creating a business of its own, which is what the
 * picker's Business does.
 *
 * A modal with one field, and the espresso Join button as its anchor.
 */
export default function BusinessJoinScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const saveAccountType = useAccountTypeStore((s) => s.save);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const join = useMutation({
    mutationFn: async () => {
      const problem = inviteCodeProblem(code);
      if (problem) throw Object.assign(new Error(problem), { problem });
      return joinBusiness(normalizeInviteCode(code));
    },
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const userId = session?.user?.id;
      if (userId) await saveAccountType(userId, 'business');
      void qc.invalidateQueries();
      // Off the picker and this sheet, onto the company's tabs.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/(business-tabs)');
    },
    onError: (e: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const problem = (e as { problem?: unknown })?.problem;
      setError(
        t(
          joinErrorMessage(problem === 'empty' || problem === 'format' ? problem : joinFailure(e)).key,
        ),
      );
    },
  });

  return (
    <Screen pal={C}>
      <SubHeader pal={C} title={t('onboardingFlow.join.title')} onBack={() => router.back()} style={{ marginTop: 8 }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: S.section }}>
          <IconTile pal={C} size={56}>
            <Users size={26} color={C.ink} strokeWidth={S.stroke} />
          </IconTile>
          <Type role="body" color={C.inkDim} style={{ marginTop: S.group }}>
            {t('onboardingFlow.join.hint')}
          </Type>
          <Field
            pal={C}
            label={t('onboardingFlow.join.label')}
            value={code}
            onChangeText={(v) => {
              setCode(normalizeInviteCode(v));
              setError('');
            }}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={() => join.mutate()}
            style={{ marginTop: S.wide }}
          />
          <FormError pal={C} message={error} />
        </ScrollView>
        <View style={{ paddingHorizontal: S.screen, paddingTop: 12, paddingBottom: insets.bottom + S.group }}>
          <PrimaryButton
            pal={C}
            label={join.isPending ? t('onboardingFlow.join.joining') : t('onboardingFlow.join.submit')}
            onPress={() => join.mutate()}
            disabled={join.isPending}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
