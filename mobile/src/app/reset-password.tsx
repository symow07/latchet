import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { AlertCircle, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from '@/components/icons';
import { S, useC } from '@/lib/design';
import {
  Field, FormError, IconTile, PrimaryButton, Screen, Type,
} from '@/components/kit';
import { authClient } from '@/lib/auth/auth-client';
import { authErrorCode, authErrorMessage } from '@/lib/auth/auth-errors';
import { checkNewPassword, readResetLink, type NewPasswordProblem } from '@/lib/auth/auth-links';
import { useLeaveAuthScreen } from '@/lib/auth/leave-landing';
import { refreshSession, useSession } from '@/lib/auth/use-session';
import { t } from '@/lib/i18n/core';

const PROBLEM_KEY: Record<NewPasswordProblem, string> = {
  missing: 'auth.errorAllFields',
  short: 'auth.errorShortPassword',
  long: 'auth.errorLongPassword',
  mismatch: 'auth.errorMismatch',
};

type Stage = 'form' | 'invalid' | 'done';

/**
 * Where the emailed reset link lands.
 *
 * The link goes to the backend, which checks the token and redirects here as
 * realbudget://reset-password?token=…, or ?error=INVALID_TOKEN once it has
 * expired or been used. The new password is posted with that token; the server
 * ends every session of the account with it.
 *
 * Reachable signed in or out — registered outside both guards in _layout.tsx
 * and left alone by profile-route.ts — because a link can be opened on a phone
 * that is signed in, even as someone else:
 *   - signed out: success goes to sign-in, with a notice;
 *   - signed in as the same account: the reset just ended this phone's session
 *     too, so it is signed out and goes to sign-in the same way;
 *   - signed in as another account: that session is untouched; the screen
 *     says whose password changed and carries on into the app.
 * Going to sign-in clears the stack first (useLeaveAuthScreen): a link opened
 * from Forgot password sits on top of it, and it must not outlive the reset.
 * An expired link offers a new one only while signed out — Forgot password is
 * a signed-out screen — and otherwise says how to get one.
 *
 * Terminal by design (back-navigation.test.ts): a deep link has nothing
 * beneath it, so every state leads on instead of back.
 */
export default function ResetPasswordScreen() {
  const C = useC();
  const leave = useLeaveAuthScreen();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const link = readResetLink(params);
  const linkKey = link.kind === 'ready' ? link.token : '';
  const { data: session } = useSession();
  const signedIn = !!session?.user;

  const [stage, setStage] = useState<Stage>(link.kind === 'ready' ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [goSignIn, setGoSignIn] = useState(false);

  // A second link opened while this screen is up arrives as new params.
  useEffect(() => {
    setStage(linkKey ? 'form' : 'invalid');
    setPassword('');
    setConfirm('');
    setError('');
  }, [linkKey]);

  // Sign-in exists only while nobody is signed in (the public group in
  // _layout.tsx), so wait for the session to say so before going there.
  useEffect(() => {
    if (goSignIn && !signedIn) leave.toSignIn('password-reset');
  }, [goSignIn, signedIn, leave]);

  const save = useMutation<void, unknown, { token: string; newPassword: string }>({
    mutationFn: async ({ token, newPassword }) => {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      setPassword('');
      setConfirm('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!signedIn) {
        setGoSignIn(true);
        return;
      }
      // Whose password was it? If this phone's session ended with the reset,
      // it was this account's.
      const after = await refreshSession(queryClient, { allowSignOut: true });
      if (after === 'signed-out') setGoSignIn(true);
      else setStage('done');
    },
    onError: (e) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (authErrorCode(e) === 'INVALID_TOKEN') {
        setStage('invalid');
        return;
      }
      setError(authErrorMessage(e, 'resetPassword.failed'));
    },
  });

  const submit = () => {
    if (link.kind !== 'ready' || save.isPending) return;
    const problem = checkNewPassword(password, confirm);
    if (problem) {
      setError(t(PROBLEM_KEY[problem]));
      return;
    }
    setError('');
    save.mutate({ token: link.token, newPassword: password });
  };

  const exit = () => (signedIn ? leave.toApp() : leave.toSignIn());

  const quietLink = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      style={{ marginTop: S.wide, alignItems: 'center' }}
    >
      <Type role="meta" color={C.accent}>{label}</Type>
    </Pressable>
  );

  return (
    <Screen pal={C}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 32, paddingBottom: 40 }}
        >
          {stage === 'invalid' ? (
            <>
              <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
                <AlertCircle size={26} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
              <Type role="title" color={C.ink}>{t('resetPassword.invalidTitle')}</Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                {t('resetPassword.invalidBody')}
              </Type>
              {signedIn ? (
                <>
                  <Type role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
                    {t('resetPassword.invalidSignedInHint')}
                  </Type>
                  <PrimaryButton
                    pal={C}
                    label={t('resetPassword.continue')}
                    onPress={exit}
                    style={{ marginTop: S.section }}
                  />
                </>
              ) : (
                <>
                  <PrimaryButton
                    pal={C}
                    label={t('resetPassword.requestNew')}
                    onPress={leave.toForgotPassword}
                    style={{ marginTop: S.section }}
                  />
                  {quietLink(t('resetPassword.backToSignIn'), exit)}
                </>
              )}
            </>
          ) : stage === 'done' ? (
            <>
              <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
                <ShieldCheck size={26} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
              <Type role="title" color={C.ink}>{t('resetPassword.doneTitle')}</Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                {t('resetPassword.doneBody')}
              </Type>
              <PrimaryButton
                pal={C}
                label={t('resetPassword.continue')}
                onPress={exit}
                style={{ marginTop: S.section }}
              />
            </>
          ) : (
            <>
              <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
                <KeyRound size={26} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
              <Type role="title" color={C.ink}>{t('resetPassword.title')}</Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                {t('resetPassword.body')}
              </Type>
              {session?.user?.email ? (
                <Type role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
                  {t('resetPassword.signedInNote', { email: session.user.email })}
                </Type>
              ) : null}

              <Field
                pal={C}
                label={t('resetPassword.newPassword')}
                icon={<Lock size={19} color={C.inkDim} strokeWidth={S.stroke} />}
                value={password}
                onChangeText={(v) => { setPassword(v); setError(''); }}
                placeholder={t('fields.passwordHint')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                style={{ marginTop: S.section }}
                trailing={
                  <Pressable
                    onPress={() => setShowPassword((prev) => !prev)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.password')}
                  >
                    {showPassword
                      ? <EyeOff size={19} color={C.inkDim} strokeWidth={S.stroke} />
                      : <Eye size={19} color={C.inkDim} strokeWidth={S.stroke} />}
                  </Pressable>
                }
              />
              <Field
                pal={C}
                label={t('resetPassword.confirmPassword')}
                icon={<Lock size={19} color={C.inkDim} strokeWidth={S.stroke} />}
                value={confirm}
                onChangeText={(v) => { setConfirm(v); setError(''); }}
                placeholder={t('fields.repeatPassword')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={submit}
                style={{ marginTop: S.group }}
              />

              <FormError pal={C} message={error} />

              {save.isPending ? (
                <View style={{ height: 56, marginTop: S.wide, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={C.accent} />
                </View>
              ) : (
                <PrimaryButton
                  pal={C}
                  label={t('resetPassword.save')}
                  onPress={submit}
                  style={{ marginTop: S.wide }}
                />
              )}
              {quietLink(signedIn ? t('resetPassword.notNow') : t('resetPassword.backToSignIn'), exit)}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
