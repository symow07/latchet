import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AlertCircle, ShieldCheck } from '@/components/icons';
import { S, useC } from '@/lib/design';
import { FormError, IconTile, PrimaryButton, Screen, Type } from '@/components/kit';
import { readVerifyLink } from '@/lib/auth/auth-links';
import { useEmailVerification } from '@/lib/auth/use-email-verification';
import { useLeaveAuthScreen } from '@/lib/auth/leave-landing';
import { useSession } from '@/lib/auth/use-session';
import { t } from '@/lib/i18n/core';

/**
 * Where the emailed verification link lands.
 *
 * The link goes to the backend, which marks the address verified and
 * redirects here as realbudget://verify-email — or with ?error=TOKEN_EXPIRED
 * (after 24 hours) or another code when the link is no good. Verification is
 * offered, not required, so nothing here blocks anyone: it says what happened
 * and leads on.
 *
 * Reachable signed in or out (outside both guards in _layout.tsx, left alone
 * by profile-route.ts). Signed in, useEmailVerification re-reads the session
 * as the screen comes into focus: the one the app holds predates the server's
 * change, and Settings shows emailVerified from it.
 *
 * Terminal by design (back-navigation.test.ts): a deep link has nothing
 * beneath it, so the buttons lead on instead of back.
 */
export default function VerifyEmailScreen() {
  const C = useC();
  const params = useLocalSearchParams<{ error?: string }>();
  const outcome = readVerifyLink(params);
  const { data: session } = useSession();
  const signedIn = !!session?.user;
  const verification = useEmailVerification();

  const exit = useLeaveAuthScreen();
  const leave = () => (signedIn ? exit.toApp() : exit.toSignIn());

  if (outcome === 'verified') {
    return (
      <Screen pal={C}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 32, paddingBottom: 40 }}
        >
          <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
            <ShieldCheck size={26} color={C.ink} strokeWidth={S.stroke} />
          </IconTile>
          <Type role="title" color={C.ink}>{t('verifyEmail.verifiedTitle')}</Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
            {t('verifyEmail.verifiedBody')}
          </Type>
          <PrimaryButton
            pal={C}
            label={signedIn ? t('verifyEmail.continue') : t('verifyEmail.signIn')}
            onPress={leave}
            style={{ marginTop: S.section }}
          />
        </ScrollView>
      </Screen>
    );
  }

  // The link failed. Signed in to an account that still needs verifying, a new
  // link can go out from here; otherwise say where to get one.
  const canResend = signedIn && !!verification.email && !verification.emailVerified;
  const waiting = verification.secondsLeft > 0;
  const hint = !signedIn
    ? t('verifyEmail.signedOutHint')
    : verification.emailVerified
      ? t('verifyEmail.alreadyVerified')
      : verification.sent
        ? t('emailVerification.sent')
        : null;

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: S.screen, paddingTop: 32, paddingBottom: 40 }}
      >
        <IconTile pal={C} size={56} style={{ marginBottom: S.wide }}>
          <AlertCircle size={26} color={C.ink} strokeWidth={S.stroke} />
        </IconTile>
        <Type role="title" color={C.ink}>
          {outcome === 'expired' ? t('verifyEmail.expiredTitle') : t('verifyEmail.invalidTitle')}
        </Type>
        <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
          {outcome === 'expired' ? t('verifyEmail.expiredBody') : t('verifyEmail.invalidBody')}
        </Type>
        {hint ? (
          <Type role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
            {hint}
          </Type>
        ) : null}

        {canResend ? (
          <>
            {verification.sending ? (
              <View style={{ height: 56, marginTop: S.section, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={C.accent} />
              </View>
            ) : (
              <PrimaryButton
                pal={C}
                label={waiting
                  ? t('forgotPassword.resendIn', { seconds: verification.secondsLeft })
                  : t('verifyEmail.sendNew')}
                disabled={waiting}
                onPress={verification.sendVerificationEmail}
                style={{ marginTop: S.section }}
              />
            )}
            <FormError pal={C} message={verification.error} />
            <Pressable
              onPress={leave}
              hitSlop={10}
              accessibilityRole="button"
              style={{ marginTop: S.wide, alignItems: 'center' }}
            >
              <Type role="meta" color={C.accent}>{t('verifyEmail.continue')}</Type>
            </Pressable>
          </>
        ) : (
          <PrimaryButton
            pal={C}
            label={signedIn ? t('verifyEmail.continue') : t('verifyEmail.signIn')}
            onPress={leave}
            style={{ marginTop: S.section }}
          />
        )}
      </ScrollView>
    </Screen>
  );
}
