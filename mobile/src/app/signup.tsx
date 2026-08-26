import { ScreenBackground } from '@/components/ui';
import { useC } from '@/lib/design';
import {
  View, Text, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User } from 'lucide-react-native';
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
    return "Couldn't reach the server. Check your connection and try again.";
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
  const insets = useSafeAreaInsets();
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
        throw new Error('Please fill in all fields');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
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
        throw new Error(friendlyAuthError(result.error.message, 'Failed to create account'));
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
      setError(friendlyAuthError(err.message, 'Failed to create account'));
    },
  });

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <LinearGradient
            colors={['#1a0533', '#3b1070', '#1a0533']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              paddingTop: insets.top + 40,
              paddingBottom: 56,
              paddingHorizontal: 28,
              borderBottomLeftRadius: 48,
              borderBottomRightRadius: 48,
            }}
          >
            <Text className="text-4xl font-bold text-white mb-2">{t('auth.createAccount')}</Text>
            <Text className="text-white/55 text-base">{t('auth.startJourney')}</Text>
          </LinearGradient>

          {/* Form */}
          <View className="flex-1 px-6 pt-8 pb-10">
            {error ? (
              <View className="bg-red-500/15 border border-red-500/25 rounded-2xl p-4 mb-5">
                <Text className="text-red-400 text-sm text-center">{error}</Text>
              </View>
            ) : null}

            {/* Name */}
            <View className="mb-4">
              <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                {t('auth.fullName')}
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
              >
                <User size={20} color="#6b7280" />
                <TextInput
                  value={name}
                  onChangeText={(t) => { setName(t); setError(''); }}
                  placeholder={t('fields.namePlaceholder')}
                  placeholderTextColor="#4b5563"
                  autoCapitalize="words"
                  className="flex-1 ml-3 text-base"
                  selectionColor={C.p500}
                />
              </View>
            </View>

            {/* Email */}
            <View className="mb-4">
              <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                {t('auth.email')}
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
              >
                <Mail size={20} color="#6b7280" />
                <TextInput
                  value={email}
                  onChangeText={(t) => { setEmail(t); setError(''); }}
                  placeholder={t('fields.emailPlaceholder')}
                  placeholderTextColor="#4b5563"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 ml-3 text-base"
                  selectionColor={C.p500}
                />
              </View>
            </View>

            {/* Password */}
            <View className="mb-4">
              <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                {t('auth.password')}
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
              >
                <Lock size={20} color="#6b7280" />
                <TextInput
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  placeholder={t('fields.passwordHint')}
                  placeholderTextColor="#4b5563"
                  secureTextEntry={!showPassword}
                  className="flex-1 ml-3 text-base"
                  selectionColor={C.p500}
                />
                <Pressable onPress={() => setShowPassword(p => !p)} hitSlop={8}>
                  {showPassword ? <EyeOff size={20} color="#6b7280" /> : <Eye size={20} color="#6b7280" />}
                </Pressable>
              </View>
            </View>

            {/* Confirm Password */}
            <View className="mb-7">
              <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                {t('auth.confirmPassword')}
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
              >
                <Lock size={20} color="#6b7280" />
                <TextInput
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setError(''); }}
                  placeholder={t('fields.repeatPassword')}
                  placeholderTextColor="#4b5563"
                  secureTextEntry={!showPassword}
                  className="flex-1 ml-3 text-base"
                  selectionColor={C.p500}
                  returnKeyType="done"
                  onSubmitEditing={() => signUpMutation.mutate()}
                />
              </View>
            </View>

            {/* CTA */}
            <Pressable
              onPress={() => signUpMutation.mutate()}
              disabled={signUpMutation.isPending}
              className="active:opacity-80"
            >
              <LinearGradient
                colors={signUpMutation.isPending ? ['#374151', '#374151'] : [C.p600, C.p500, C.p400]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 18,
                  paddingVertical: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {signUpMutation.isPending ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Text className="text-white font-bold text-base mr-2">{t('auth.createAccount')}</Text>
                    <ArrowRight size={18} color="white" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {/* Login Link */}
            <View className="flex-row justify-center mt-7">
              <Text style={{ color: C.textFaint }} className="text-sm">{t('auth.haveAccount')}</Text>
              <Pressable onPress={() => router.push('/login')}>
                <Text className="text-purple-400 font-semibold text-sm">{t('auth.signIn')}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}
