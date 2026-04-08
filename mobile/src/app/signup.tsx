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
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';

export default function SignUpScreen() {
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

      const result = await authClient.signUp.email({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
      });

      if (result.error) {
        throw new Error(result.error.message || 'Failed to create account');
      }

      return result.data;
    },
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateSession();
      router.replace('/account-type');
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err.message);
    },
  });

  return (
    <View className="flex-1 bg-[#0a0a0f]">
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
            <Text className="text-4xl font-bold text-white mb-2">Create Account</Text>
            <Text className="text-white/55 text-base">Start your financial journey</Text>
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
              <Text className="text-gray-400 text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                Full Name
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <User size={20} color="#6b7280" />
                <TextInput
                  value={name}
                  onChangeText={(t) => { setName(t); setError(''); }}
                  placeholder="John Doe"
                  placeholderTextColor="#4b5563"
                  autoCapitalize="words"
                  className="flex-1 ml-3 text-white text-base"
                  selectionColor="#a855f7"
                />
              </View>
            </View>

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
                  placeholder="your@email.com"
                  placeholderTextColor="#4b5563"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 ml-3 text-white text-base"
                  selectionColor="#a855f7"
                />
              </View>
            </View>

            {/* Password */}
            <View className="mb-4">
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
                  placeholder="At least 8 characters"
                  placeholderTextColor="#4b5563"
                  secureTextEntry={!showPassword}
                  className="flex-1 ml-3 text-white text-base"
                  selectionColor="#a855f7"
                />
                <Pressable onPress={() => setShowPassword(p => !p)} hitSlop={8}>
                  {showPassword ? <EyeOff size={20} color="#6b7280" /> : <Eye size={20} color="#6b7280" />}
                </Pressable>
              </View>
            </View>

            {/* Confirm Password */}
            <View className="mb-7">
              <Text className="text-gray-400 text-xs font-semibold mb-2.5 ml-1 tracking-wider uppercase">
                Confirm Password
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <Lock size={20} color="#6b7280" />
                <TextInput
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setError(''); }}
                  placeholder="Repeat password"
                  placeholderTextColor="#4b5563"
                  secureTextEntry={!showPassword}
                  className="flex-1 ml-3 text-white text-base"
                  selectionColor="#a855f7"
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
                colors={signUpMutation.isPending ? ['#374151', '#374151'] : ['#7c3aed', '#a855f7', '#c084fc']}
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
                    <Text className="text-white font-bold text-base mr-2">Create Account</Text>
                    <ArrowRight size={18} color="white" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {/* Login Link */}
            <View className="flex-row justify-center mt-7">
              <Text className="text-gray-500 text-sm">Already have an account? </Text>
              <Pressable onPress={() => router.push('/login')}>
                <Text className="text-purple-400 font-semibold text-sm">Sign In</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
