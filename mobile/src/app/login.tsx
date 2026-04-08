import {
  View, Text, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';

export default function LoginScreen() {
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

    const result = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    });

    setIsLoading(false);

    if (result.error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(result.error.message || 'Invalid email or password');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await invalidateSession();

    // Load accountType and redirect accordingly
    const userId = result.data?.user?.id;
    if (userId) {
      await loadAccountType(userId);
      const { accountType } = useAccountTypeStore.getState();
      if (!accountType) {
        router.replace('/account-type');
      } else if (accountType === 'business') {
        router.replace('/(business-tabs)');
      } else {
        router.replace('/(tabs)');
      }
    }
  };

  return (
    <View className="flex-1 bg-[#0a0a0f]">
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
              <Text style={{ fontSize: 32 }}>💰</Text>
            </View>
            <Text className="text-4xl font-bold text-white mb-2">Welcome back</Text>
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
              <Text className="text-gray-400 text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                Email
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
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
                  className="flex-1 ml-3 text-white text-base"
                  selectionColor="#a855f7"
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Password */}
            <View className="mb-7">
              <Text className="text-gray-400 text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                Password
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <Lock size={20} color="#6b7280" />
                <TextInput
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  placeholder="Your password"
                  placeholderTextColor="#4b5563"
                  secureTextEntry={!showPassword}
                  className="flex-1 ml-3 text-white text-base"
                  selectionColor="#a855f7"
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
                colors={isLoading ? ['#374151', '#374151'] : ['#7c3aed', '#a855f7', '#c084fc']}
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
                    <Text className="text-white font-bold text-base mr-2">Sign In</Text>
                    <ArrowRight size={18} color="white" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {/* Sign up link */}
            <View className="flex-row justify-center mt-7">
              <Text className="text-gray-500 text-sm">Don't have an account? </Text>
              <Pressable onPress={() => router.push('/signup')}>
                <Text className="text-purple-400 font-semibold text-sm">Create one</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
