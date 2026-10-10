import {
  View, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Eye, EyeOff, Lock, Mail, Wallet } from '@/components/icons';
import { S, useC } from '@/lib/design';
import {
  Field, FormError, IconTile, PrimaryButton, Screen, Type,
} from '@/components/kit';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { t } from '@/lib/i18n/core';

const SECURE_STORE_PROBE_KEYS = [
  'realbudget.session_token',
  'realbudget.cookie',
  'realbudget_session_token',
  'realbudget_cookie',
];

/**
 * Turn an auth failure into a sentence.
 *
 * The network cases were the only ones translated before, and only into
 * English — a French user hit a connection problem and was told about it in a
 * language they had not chosen. The server's own message is still preferred
 * when there is one, because it is more specific than any fallback here.
 */
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
    console.log(`[mobile:signin:store:${label}] ${JSON.stringify(probes)}`);
  } catch (e) {
    console.warn(
      `[mobile:signin:storeProbeFailed:${label}] ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export default function LoginScreen() {
  const C = useC();
  const router = useRouter();
  const invalidateSession = useInvalidateSession();
  const loadAccountType = useAccountTypeStore(s => s.load);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.errorMissing'));
      return;
    }
    setError('');
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const t0 = Date.now();
    const normEmail = email.trim().toLowerCase();
    console.log(
      `[mobile:signin:pre] ts=${t0} email=${normEmail} pwdLen=${password.length}`,
    );
    await probeSecureStore('pre');

    let result: Awaited<ReturnType<typeof authClient.signIn.email>>;
    try {
      result = await authClient.signIn.email({ email: normEmail, password });
    } catch (err) {
      setIsLoading(false);
      console.error(
        `[mobile:signin:throw] ms=${Date.now() - t0} err=${err instanceof Error ? err.message : String(err)} stack=${err instanceof Error ? err.stack : ''}`,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(friendlyAuthError(err instanceof Error ? err.message : null, t('auth.errorFailed')));
      return;
    }

    setIsLoading(false);

    const ms = Date.now() - t0;
    const errorKeys = result?.error ? Object.keys(result.error) : [];
    const dataKeys = result?.data ? Object.keys(result.data) : [];
    console.log(
      `[mobile:signin:post] ms=${ms} hasError=${!!result?.error} errorKeys=[${errorKeys.join(',')}] hasData=${!!result?.data} dataKeys=[${dataKeys.join(',')}]`,
    );
    if (result?.error) {
      console.warn(`[mobile:signin:errorBody] ${JSON.stringify(result.error)}`);
    }
    await probeSecureStore('post');

    if (result.error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(friendlyAuthError(result.error.message, t('auth.errorInvalid')));
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    console.log('[mobile:signin:onSuccess] invalidating session…');
    await invalidateSession();

    const userId = result.data?.user?.id;
    if (!userId) {
      console.warn('[mobile:signin:noUserId] result.data.user.id missing — staying on screen');
      return;
    }

    console.log(`[mobile:signin:loadAccountType] start userId=${userId}`);
    const lt0 = Date.now();
    try {
      await loadAccountType(userId);
    } catch (e) {
      console.warn(
        `[mobile:signin:loadAccountType:error] ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const { accountType } = useAccountTypeStore.getState();
    console.log(
      `[mobile:signin:loadAccountType] done in ${Date.now() - lt0}ms accountType=${accountType ?? 'null'}`,
    );

    let target: string;
    if (!accountType) {
      target = '/account-type';
    } else if (accountType === 'business') {
      target = '/(business-tabs)';
    } else {
      target = '/(tabs)';
    }
    console.log(`[mobile:signin:nav] target=${target} accountType=${accountType ?? 'null'}`);
    router.replace(target as never);
  };

  return (
    <Screen pal={C}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 32, paddingBottom: 40 }}
        >
          {/* Content sits at the top and the bottom stays open (§1.4). The
              old header was a hard-coded #0f0c29 → #302b63 gradient, which is
              why this screen stayed purple through the retheme: it never read
              a token. */}
          <IconTile pal={C} size={56} style={{ marginBottom: 24 }}>
            <Wallet size={26} color={C.accent} strokeWidth={S.stroke} />
          </IconTile>

          <Type role="title" color={C.ink}>{t('auth.welcomeBack')}</Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: 36 }}>
            {t('auth.signInSubtitle')}
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
            returnKeyType="next"
          />

          <Field
            pal={C}
            label={t('auth.password')}
            icon={<Lock size={19} color={C.inkDim} strokeWidth={S.stroke} />}
            value={password}
            onChangeText={(v) => { setPassword(v); setError(''); }}
            placeholder={t('fields.yourPassword')}
            secureTextEntry={!showPassword}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
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

          <FormError pal={C} message={error} />

          {isLoading ? (
            <View style={{ height: 56, marginTop: 24, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <PrimaryButton
              pal={C}
              label={t('auth.signInAction')}
              onPress={handleLogin}
              style={{ marginTop: 24 }}
            />
          )}

          <Pressable
            onPress={() => router.push('/signup')}
            hitSlop={10}
            accessibilityRole="link"
            style={{ marginTop: 24, alignItems: 'center' }}
          >
            <Type role="meta" color={C.inkDim}>
              {t('auth.noAccount')}
              <Type role="meta" color={C.accent}>{t('auth.createOne')}</Type>
            </Type>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
