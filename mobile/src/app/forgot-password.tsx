import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View,
} from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { KeyRound, Mail, Send } from '@/components/icons';
import { S, useC } from '@/lib/design';
import {
  Field, FormError, IconTile, PrimaryButton, Screen, SubHeader, Type,
} from '@/components/kit';
import { authClient, RESET_PASSWORD_REDIRECT } from '@/lib/auth/auth-client';
import { authErrorMessage } from '@/lib/auth/auth-errors';
import { looksLikeEmail } from '@/lib/auth/auth-links';
import { useResendCooldown } from '@/lib/auth/use-resend-cooldown';
import { t } from '@/lib/i18n/core';

/**
 * Forgot password: ask for a reset link by email.
 *
 * The confirmation is the same whether or not the address has an account.
 * The server answers both alike and sends in the background, and this screen
 * says the same thing for both, so it cannot be used to find out who has an
 * account. Only a real failure — no connection, too many attempts — is
 * reported, and those do not depend on the address either.
 *
 * The emailed link goes through the backend and lands on reset-password.tsx.
 *
 * Signed-out only: declared with sign-in in the root layout's public group,
 * so signing in closes it. Reached from sign-in, or from an expired reset
 * link (which puts sign-in beneath it first).
 */
export default function ForgotPasswordScreen() {
  const C = useC();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState<string>(typeof params.email === 'string' ? params.email : '');
  const [sent, setSent] = useState<{ to: string; at: number } | null>(null);
  const [editing, setEditing] = useState(true);
  const [error, setError] = useState('');
  const secondsLeft = useResendCooldown(sent?.at ?? null);

  const request = useMutation<void, unknown, string>({
    mutationFn: async (address) => {
      const result = await authClient.requestPasswordReset({ email: address, redirectTo: RESET_PASSWORD_REDIRECT });
      if (result.error) throw result.error;
    },
    onSuccess: (_data, address) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent({ to: address, at: Date.now() });
      setEditing(false);
      setError('');
    },
    onError: (e) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(authErrorMessage(e, 'forgotPassword.failed'));
    },
  });

  const submit = (address: string) => {
    const normalized = address.trim().toLowerCase();
    if (!looksLikeEmail(normalized)) {
      setError(t('auth.errorInvalidEmail'));
      return;
    }
    if (request.isPending) return;
    // The same address again inside the cooldown: the link is already on its
    // way, so show that rather than send a second one.
    if (sent && sent.to === normalized && secondsLeft > 0) {
      setEditing(false);
      return;
    }
    setError('');
    request.mutate(normalized);
  };

  // Back to sign-in, which is normally beneath; a cold start may have put
  // nothing there.
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/login');
  };

  return (
    <Screen pal={C}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SubHeader pal={C} title={t('forgotPassword.title')} onBack={leave} style={{ marginTop: 8 }} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: S.wide, paddingBottom: 40 }}
        >
          {editing || !sent ? (
            <>
              <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
                <KeyRound size={26} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
              <Type role="title" color={C.ink}>{t('forgotPassword.heading')}</Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: S.section }}>
                {t('forgotPassword.body')}
              </Type>

              <Field
                pal={C}
                label={t('auth.email')}
                icon={<Mail size={19} color={C.inkDim} strokeWidth={S.stroke} />}
                value={email}
                onChangeText={(v) => { setEmail(v); setError(''); }}
                placeholder={t('fields.emailPlaceholder2')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                autoFocus={!email}
                returnKeyType="send"
                onSubmitEditing={() => submit(email)}
              />

              <FormError pal={C} message={error} />

              {request.isPending ? (
                <View style={{ height: 56, marginTop: S.wide, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={C.accent} />
                </View>
              ) : (
                <PrimaryButton
                  pal={C}
                  label={t('forgotPassword.send')}
                  onPress={() => submit(email)}
                  style={{ marginTop: S.wide }}
                />
              )}
            </>
          ) : (
            <>
              <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
                <Send size={26} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
              <Type role="title" color={C.ink}>{t('forgotPassword.sentTitle')}</Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                {t('forgotPassword.sentBody', { email: sent.to })}
              </Type>
              <Type role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
                {t('forgotPassword.spamHint')}
              </Type>

              <PrimaryButton
                pal={C}
                label={t('forgotPassword.backToSignIn')}
                onPress={leave}
                style={{ marginTop: S.section }}
              />

              <FormError pal={C} message={error} />

              <PrimaryButton
                pal={C}
                variant="secondary"
                label={secondsLeft > 0
                  ? t('forgotPassword.resendIn', { seconds: secondsLeft })
                  : t('forgotPassword.resend')}
                disabled={secondsLeft > 0 || request.isPending}
                onPress={() => submit(sent.to)}
                style={{ marginTop: S.group }}
              />

              <Pressable
                onPress={() => { setEditing(true); setError(''); }}
                hitSlop={10}
                accessibilityRole="button"
                style={{ marginTop: S.wide, alignItems: 'center' }}
              >
                <Type role="meta" color={C.accent}>{t('forgotPassword.useDifferent')}</Type>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
