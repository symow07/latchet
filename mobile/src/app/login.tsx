import { ScreenBackground } from '@/components/ui';
import { useC } from '@/lib/design';
import {
  View, Text, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Wallet } from 'lucide-react-native';
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
  const insets = useSafeAreaInsets();
  const invalidateSession = useInvalidateSession();
  const loadAccountType = useAccountTypeStore(s => s.load);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your email and password');
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
      setError(friendlyAuthError(err instanceof Error ? err.message : null, 'Sign-in failed'));
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
      setError(friendlyAuthError(result.error.message, 'Invalid email or password'));
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
    <ScreenBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <LinearGradient
            colors={['#0f0c29', '#302b63', '#24243e']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              paddingTop: insets.top + 52,
              paddingBottom: 60,
              paddingHorizontal: 28,
              borderBottomLeftRadius: 48,
              borderBottomRightRadius: 48,
            }}
          >
            <View
              style={{
                width: 64, height: 64, borderRadius: 22,
                backgroundColor: 'rgba(168,85,247,0.18)',
                borderWidth: 1.5, borderColor: 'rgba(168,85,247,0.35)',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 24,
              }}
            >
              <Wallet size={30} color={C.p500} />
            </View>
            <Text className="text-4xl font-bold text-white mb-2">{t('auth.welcomeBack')}</Text>
            <Text className="text-white/55 text-base leading-6">
              Sign in to your Budget account
            </Text>
          </LinearGradient>

          {/* Form */}
          <View className="px-6 pt-9 pb-10">
            {error ? (
              <View className="bg-red-500/15 border border-red-500/25 rounded-2xl p-4 mb-5">
                <Text className="text-red-400 text-sm text-center">{error}</Text>
              </View>
            ) : null}

            {/* Email */}
            <View className="mb-4">
              <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                Email
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
              >
                <Mail size={20} color="#6b7280" />
                <TextInput
                  value={email}
                  onChangeText={(t) => { setEmail(t); setError(''); }}
                  placeholder="you@example.com"
                  placeholderTextColor="#4b5563"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  className="flex-1 ml-3 text-base"
                  selectionColor={C.p500}
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Password */}
            <View className="mb-7">
              <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                Password
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
              >
                <Lock size={20} color="#6b7280" />
                <TextInput
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  placeholder="Your password"
                  placeholderTextColor="#4b5563"
                  secureTextEntry={!showPassword}
                  className="flex-1 ml-3 text-base"
                  selectionColor={C.p500}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable onPress={() => setShowPassword(p => !p)} hitSlop={8}>
                  {showPassword
                    ? <EyeOff size={20} color="#6b7280" />
                    : <Eye size={20} color="#6b7280" />
                  }
                </Pressable>
              </View>
            </View>

            {/* CTA */}
            <Pressable onPress={handleLogin} disabled={isLoading} className="active:opacity-80">
              <LinearGradient
                colors={isLoading ? ['#374151', '#374151'] : [C.p600, C.p500, C.p400]}
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
                {isLoading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Text className="text-white font-bold text-base mr-2">{t('auth.signIn')}</Text>
                    <ArrowRight size={18} color="white" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {/* Sign up link */}
            <View className="flex-row justify-center mt-7">
              <Text style={{ color: C.textFaint }} className="text-sm">{t('auth.noAccount')}</Text>
              <Pressable onPress={() => router.push('/signup')}>
                <Text className="text-purple-400 font-semibold text-sm">{t('auth.createOne')}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}
