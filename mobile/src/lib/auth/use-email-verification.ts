import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authClient, VERIFY_EMAIL_CALLBACK } from './auth-client';
import { authErrorCode, authErrorMessage } from './auth-errors';
import { refreshSession, useSession } from './use-session';
import { useResendCooldown } from './use-resend-cooldown';

/**
 * The signed-in account's email, whether it is verified, and a resend.
 *
 * Both Settings screens show this. Verification is offered, never required
 * (the server leaves requireEmailVerification off): the link goes out at
 * sign-up, and this is where someone who missed it gets another.
 *
 * Verifying happens outside the app — the link opens in a browser and the
 * server redirects to latchet://verify-email — so the state is re-read
 * from the server whenever the screen using this comes back into focus while
 * the address is still unverified. Quietly: a failed read changes nothing.
 */
export function useEmailVerification() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const email = session?.user?.email ?? '';
  const emailVerified = session?.user?.emailVerified === true;

  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const secondsLeft = useResendCooldown(sentAt);

  const send = useMutation<void, unknown, void>({
    mutationFn: async () => {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: VERIFY_EMAIL_CALLBACK });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      setSentAt(Date.now());
      setError('');
    },
    onError: (e) => {
      // Verified somewhere else since this screen last looked: say so by
      // showing it, not by reporting an error.
      if (authErrorCode(e) === 'EMAIL_ALREADY_VERIFIED') {
        setError('');
        void refreshSession(queryClient);
        return;
      }
      setError(authErrorMessage(e, 'emailVerification.failed'));
    },
  });

  useFocusEffect(
    useCallback(() => {
      if (email && !emailVerified) void refreshSession(queryClient);
    }, [email, emailVerified, queryClient]),
  );

  const { mutate, isPending } = send;
  const sendVerificationEmail = useCallback(() => {
    if (!email || isPending || secondsLeft > 0) return;
    mutate();
  }, [email, isPending, secondsLeft, mutate]);

  return {
    email,
    emailVerified,
    sendVerificationEmail,
    sending: isPending,
    /** A link went out from this screen. */
    sent: sentAt !== null,
    /** Seconds before another send is allowed. */
    secondsLeft,
    error,
  };
}
