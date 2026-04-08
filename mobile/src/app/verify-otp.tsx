import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { pullCloudDataToLocal } from '@/lib/cloud-sync';

const OTP_LENGTH = 6;

export default function VerifyOTPScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const invalidateSession = useInvalidateSession();
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleVerify = async (code: string) => {
    if (code.length !== OTP_LENGTH) return;
    setError('');
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await authClient.signIn.emailOtp({
      email: email.trim(),
      otp: code,
    });

    if (result.error) {
      setIsLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(result.error.message || 'Invalid code. Please try again.');
      setOtp('');
    } else {
      // Pull cloud data into local DB for returning users
      await pullCloudDataToLocal().catch(() => {});
      await invalidateSession();
      // Stack.Protected handles navigation automatically
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleOtpChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(digits);
    setError('');
    if (digits.length === OTP_LENGTH) {
      handleVerify(digits);
    }
  };

  const handleResend = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: 'sign-in',
    });
    if (!result.error) {
      setResent(true);
      setOtp('');
      setTimeout(() => setResent(false), 4000);
    }
  };

  // Render OTP boxes
  const renderBoxes = () => {
    return Array.from({ length: OTP_LENGTH }).map((_, i) => {
      const char = otp[i] || '';
      const isActive = otp.length === i;
      return (
        <Pressable
          key={i}
          onPress={() => inputRef.current?.focus()}
          style={{
            width: 48,
            height: 58,
            borderRadius: 14,
            backgroundColor: char ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.06)',
            borderWidth: isActive ? 2 : 1,
            borderColor: isActive ? '#a855f7' : char ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255,255,255,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'white', fontSize: 22, fontWeight: '700' }}>{char}</Text>
        </Pressable>
      );
    });
  };

  return (
    <View className="flex-1 bg-[#0d0d0f]">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <LinearGradient
          colors={['#0f0c29', '#302b63', '#24243e']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + 20,
            paddingBottom: 48,
            paddingHorizontal: 24,
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            className="mb-6 self-start"
          >
            <View className="w-10 h-10 rounded-xl bg-white/10 items-center justify-center">
              <ArrowLeft size={18} color="white" />
            </View>
          </Pressable>

          <View className="w-14 h-14 rounded-2xl bg-purple-500/20 items-center justify-center mb-4">
            <ShieldCheck size={28} color="#a855f7" />
          </View>
          <Text className="text-3xl font-bold text-white mb-2">Check your email</Text>
          <Text className="text-white/60 text-sm leading-5">
            We sent a 6-digit code to{'\n'}
            <Text className="text-purple-300 font-semibold">{email}</Text>
          </Text>
        </LinearGradient>

        <View className="flex-1 px-6 pt-10">
          {/* OTP Boxes */}
          <View className="flex-row justify-between mb-2">
            {renderBoxes()}
          </View>

          {/* Hidden real input */}
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={handleOtpChange}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            autoFocus
          />

          {/* Error */}
          {error ? (
            <View className="bg-red-500/15 border border-red-500/25 rounded-xl p-3 mt-4">
              <Text className="text-red-400 text-sm text-center">{error}</Text>
            </View>
          ) : null}

          {resent ? (
            <View className="bg-green-500/15 border border-green-500/25 rounded-xl p-3 mt-4">
              <Text className="text-green-400 text-sm text-center">Code sent again!</Text>
            </View>
          ) : null}

          {/* Loading */}
          {isLoading && (
            <View className="items-center mt-8">
              <ActivityIndicator color="#a855f7" size="large" />
              <Text className="text-gray-500 text-sm mt-3">Verifying...</Text>
            </View>
          )}

          {/* Resend */}
          <View className="flex-row justify-center mt-8">
            <Text className="text-gray-500 text-sm">Didn't get it? </Text>
            <Pressable onPress={handleResend}>
              <Text className="text-purple-400 text-sm font-semibold">Resend code</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
