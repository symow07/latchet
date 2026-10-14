import {
  View, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, Wallet } from '@/components/icons';
import { R, S, useC } from '@/lib/design';
import {
  Field, FormError, IconTile, PrimaryButton, Screen, Type,
} from '@/components/kit';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { authClient } from '@/lib/auth/auth-client';
import { authErrorMessage } from '@/lib/auth/auth-errors';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { t } from '@/lib/i18n/core';

const SECURE_STORE_PROBE_KEYS = [
  'latchet.session_token',
  'latchet.cookie',
  'latchet_session_token',
  'latchet_cookie',
];

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
  // Arriving from a completed password reset (reset-password.tsx).
  const { notice } = useLocalSearchParams<{ notice?: string }>();

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
      setError(authErrorMessage(err, 'auth.errorFailed'));
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
      setError(authErrorMessage(result.error, 'auth.errorFailed'));
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    console.log('[mobile:signin:onSuccess] invalidating session…');
    await invalidateSession();

    // No navigation from here. The session change makes the root layout open
    // this user's own database, and the signed-in screens only exist once it
    // is open; the layout then sends the account to its profile's screens
    // (profile-route.ts). Navigating from here would race that opening.
    console.log(`[mobile:signin:done] userId=${result.data?.user?.id ?? 'missing'}`);
  };

  return (
    <Screen pal={C}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 32, paddingBottom: 40 }}
        >
          {/* Content sits at the top and the bottom stays open (§1.4), on the
              plain page: no gradient, no wash. The old header was a hard-coded
              navy-to-violet gradient, which is why this screen stayed purple
              through the retheme: it never read a token. The mark is the
              identity's platinum tile with an ink glyph; the espresso button
              below is the screen's one anchor. */}
          <IconTile pal={C} size={56} style={{ marginBottom: 24 }}>
            <Wallet size={26} color={C.ink} strokeWidth={S.stroke} />
          </IconTile>

          <Type role="title" color={C.ink}>{t('auth.welcomeBack')}</Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6, marginBottom: notice === 'password-reset' ? S.group : 36 }}>
            {t('auth.signInSubtitle')}
          </Type>

          {notice === 'password-reset' ? (
            <View
              accessibilityRole="alert"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                padding: S.group, marginBottom: S.wide,
                borderRadius: R.control, borderCurve: 'continuous', backgroundColor: C.groundSunk,
              }}
            >
              <ShieldCheck size={19} color={C.ink} strokeWidth={S.stroke} />
              <Type role="meta" color={C.ink} style={{ flex: 1 }}>{t('auth.passwordResetNotice')}</Type>
            </View>
          ) : null}

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

          {/* With the address typed so far, so it need not be typed twice. */}
          <Pressable
            onPress={() => router.push({
              pathname: '/forgot-password',
              params: email.trim() ? { email: email.trim().toLowerCase() } : {},
            })}
            hitSlop={10}
            accessibilityRole="link"
            style={{ alignSelf: 'flex-end', marginTop: S.group }}
          >
            <Type role="meta" color={C.accent}>{t('auth.forgotLink')}</Type>
          </Pressable>

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
