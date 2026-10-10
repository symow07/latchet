import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ShieldCheck } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import { pullCloudDataToLocal } from '@/lib/cloud-sync';
import { F, R, S, useC } from '@/lib/design';
import { CircleAction, FormError, IconTile, Screen, Type, mirror } from '@/components/kit';
import { t } from '@/lib/i18n/core';

const OTP_LENGTH = 6;

/**
 * The code from the email.
 *
 * Same shape as login and signup: content at the top, the bottom left open,
 * one icon tile, a headline in sentence case. The old version opened on a
 * `#0f0c29 → #302b63 → #24243e` gradient with 40px scalloped corners — the
 * last surviving piece of the dark direction in the sign-in flow, and it never
 * read a token, so the retheme went straight past it.
 *
 * The six boxes were `rgba(255,255,255,0.06)` fills holding white digits.
 * After the ground turned bone, that was a white digit on a white box: the
 * code you had just typed was invisible.
 */
export default function VerifyOTPScreen() {
  const C = useC();
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
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

    const result = await authClient.signIn.emailOtp({ email: email.trim(), otp: code });

    if (result.error) {
      setIsLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // The server's message is more specific when there is one; the fallback
      // used to be an English sentence in a four-language app.
      setError(result.error.message || t('auth.errorInvalidCode'));
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
    if (digits.length === OTP_LENGTH) handleVerify(digits);
  };

  const handleResend = async () => {
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: 'sign-in',
    });
    if (!result.error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResent(true);
      setOtp('');
      setTimeout(() => setResent(false), 4000);
    }
  };

  return (
    <Screen pal={C}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 12, paddingBottom: 40 }}
        >
          <CircleAction pal={C} label={t('auth.checkEmail')} onPress={() => router.back()}>
            <ChevronLeft size={20} color={C.ink} strokeWidth={S.stroke} style={mirror} />
          </CircleAction>

          <IconTile pal={C} size={56} style={{ marginTop: 24, marginBottom: 24 }}>
            <ShieldCheck size={26} color={C.accent} strokeWidth={S.stroke} />
          </IconTile>

          <Type role="title" color={C.ink}>
            {t('auth.checkEmail')}
          </Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
            {t('auth.codeSentTo')}
          </Type>
          <Type role="cardTitle" color={C.ink} style={{ marginTop: 2, marginBottom: 32 }}>
            {email}
          </Type>

          {/* The six boxes. A filled digit sits on a sunk well; the box
              waiting for the next digit carries an ink hairline, which is the
              only place on this screen a border earns its keep. */}
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="button"
            accessibilityLabel={t('auth.checkEmail')}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}
          >
            {Array.from({ length: OTP_LENGTH }).map((_, i) => {
              const char = otp[i] ?? '';
              const isNext = otp.length === i;
              return (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 58,
                    borderRadius: R.sm,
                    backgroundColor: C.groundSunk,
                    borderWidth: isNext ? 1.5 : 0,
                    borderColor: C.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText
                    style={{
                      ...F.bold,
                      fontSize: 22,
                      color: C.ink,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {char}
                  </RNText>
                </View>
              );
            })}
          </Pressable>

          {/* The field the keyboard actually talks to. */}
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={handleOtpChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            autoFocus
          />

          <FormError pal={C} message={error} />

          {resent ? (
            <Type role="meta" color={C.positive} style={{ marginTop: 12 }}>
              {t('auth.codeSent')}
            </Type>
          ) : null}

          {isLoading ? (
            <View style={{ alignItems: 'center', marginTop: 32, gap: 12 }}>
              <ActivityIndicator color={C.accent} />
              <Type role="meta" color={C.inkDim}>
                {t('auth.verifying')}
              </Type>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              marginTop: 32,
            }}
          >
            <Type role="meta" color={C.inkDim}>
              {t('auth.didntGet')}
            </Type>
            <Pressable
              onPress={handleResend}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('auth.resend')}
            >
              <Type role="meta" color={C.accent}>
                {t('auth.resend')}
              </Type>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
