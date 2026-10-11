import {
  View, Pressable,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail, User } from '@/components/icons';
import { S, useC } from '@/lib/design';
import {
  Field, FormError, IconTile, PrimaryButton, Screen, Type,
} from '@/components/kit';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { t } from '@/lib/i18n/core';

// Probe the SecureStore keys expoClient may write under storagePrefix "realbudget".
// Both delimiters are checked because the prefix-key separator has varied across
// versions of @better-auth/expo.
const SECURE_STORE_PROBE_KEYS = [
  'realbudget.session_token',
  'realbudget.cookie',
  'realbudget_session_token',
  'realbudget_cookie',
];

function friendlyAuthError(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('timed out') || lower.includes('aborted')) {
    return t('auth.errorNetwork');
  }
  return raw;
}

async function probeSecureStore(label: string) {
  try {
    const probes = await Promise.all(
      SECURE_STORE_PROBE_KEYS.map(async (k) => {
        const v = await SecureStore.getItemAsync(k);
        return { k, present: v != null, len: v?.length ?? 0 };
      }),
    );
    console.log(`[mobile:signup:store:${label}] ${JSON.stringify(probes)}`);
  } catch (e) {
    console.warn(
      `[mobile:signup:storeProbeFailed:${label}] ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export default function SignUpScreen() {
  const C = useC();
  const router = useRouter();
  const invalidateSession = useInvalidateSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const signUpMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !email.trim() || !password) {
        throw new Error(t('auth.errorAllFields'));
      }
      if (password.length < 8) {
        throw new Error(t('auth.errorShortPassword'));
      }
      if (password !== confirmPassword) {
        throw new Error(t('auth.errorMismatch'));
      }

      const t0 = Date.now();
      const normEmail = email.trim().toLowerCase();
      console.log(
        `[mobile:signup:pre] ts=${t0} email=${normEmail} nameLen=${name.trim().length} pwdLen=${password.length}`,
      );
      await probeSecureStore('pre');

      let result: Awaited<ReturnType<typeof authClient.signUp.email>>;
      try {
        result = await authClient.signUp.email({
          email: normEmail,
          password,
          name: name.trim(),
        });
      } catch (err) {
        console.error(
          `[mobile:signup:throw] ms=${Date.now() - t0} err=${err instanceof Error ? err.message : String(err)} stack=${err instanceof Error ? err.stack : ''}`,
        );
        throw err;
      }

      const ms = Date.now() - t0;
      const errorKeys = result?.error ? Object.keys(result.error) : [];
      const dataKeys = result?.data ? Object.keys(result.data) : [];
      console.log(
        `[mobile:signup:post] ms=${ms} hasError=${!!result?.error} errorKeys=[${errorKeys.join(',')}] hasData=${!!result?.data} dataKeys=[${dataKeys.join(',')}]`,
      );

      if (result?.error) {
        console.warn(
          `[mobile:signup:errorBody] ${JSON.stringify(result.error)}`,
        );
      }
      if (result?.data) {
        const shape: Record<string, string> = {};
        for (const k of dataKeys) {
          const v = (result.data as Record<string, unknown>)[k];
          shape[k] = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
        }
        console.log(`[mobile:signup:dataShape] ${JSON.stringify(shape)}`);
      }

      await probeSecureStore('post');

      if (result.error) {
        throw new Error(friendlyAuthError(result.error.message, t('auth.errorCreateFailed')));
      }

      return result.data;
    },
    onSuccess: async () => {
      console.log('[mobile:signup:onSuccess] invalidating session…');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateSession();
      console.log('[mobile:signup:nav] target=/account-type invalidated=true');
      router.replace('/account-type');
    },
    onError: (err: Error) => {
      console.warn(`[mobile:signup:onError] ${err.message}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(friendlyAuthError(err.message, t('auth.errorCreateFailed')));
    },
  });

  return (
    <Screen pal={C}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 32, paddingBottom: 40 }}
        >
          {/* The plain page, a platinum tile with an ink glyph, and the
              espresso button below as the screen's one anchor — the same
              shape as sign-in. */}
          <IconTile pal={C} size={56} style={{ marginBottom: 24 }}>
            <User size={26} color={C.ink} strokeWidth={S.stroke} />
          </IconTile>

          <Type role="title" color={C.ink}>{t('auth.createAccount')}</Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: 36 }}>
            {t('auth.startJourney')}
          </Type>

          <Field
            pal={C}
            label={t('auth.fullName')}
            icon={<User size={19} color={C.inkDim} strokeWidth={S.stroke} />}
            value={name}
            onChangeText={(v) => { setName(v); setError(''); }}
            placeholder={t('fields.namePlaceholder')}
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="next"
          />

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
            returnKeyType="next"
            style={{ marginTop: 16 }}
          />

          <Field
            pal={C}
            label={t('auth.password')}
            icon={<Lock size={19} color={C.inkDim} strokeWidth={S.stroke} />}
            value={password}
            onChangeText={(v) => { setPassword(v); setError(''); }}
            placeholder={t('fields.passwordHint')}
            secureTextEntry={!showPassword}
            returnKeyType="next"
            style={{ marginTop: 16 }}
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
            label={t('auth.confirmPassword')}
            icon={<Lock size={19} color={C.inkDim} strokeWidth={S.stroke} />}
            value={confirmPassword}
            onChangeText={(v) => { setConfirmPassword(v); setError(''); }}
            placeholder={t('fields.repeatPassword')}
            secureTextEntry={!showPassword}
            returnKeyType="done"
            onSubmitEditing={() => signUpMutation.mutate()}
            style={{ marginTop: 16 }}
          />

          <FormError pal={C} message={error} />

          {signUpMutation.isPending ? (
            <View style={{ height: 56, marginTop: 24, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <PrimaryButton
              pal={C}
              label={t('auth.createAction')}
              onPress={() => signUpMutation.mutate()}
              style={{ marginTop: 24 }}
            />
          )}

          <Pressable
            onPress={() => router.push('/login')}
            hitSlop={10}
            accessibilityRole="link"
            style={{ marginTop: 24, alignItems: 'center' }}
          >
            <Type role="meta" color={C.inkDim}>
              {t('auth.haveAccount')}
              <Type role="meta" color={C.accent}>{t('auth.signInAction')}</Type>
            </Type>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
