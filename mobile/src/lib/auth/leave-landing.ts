import { useMemo } from 'react';
import { useRouter } from 'expo-router';

/**
 * Leaving an auth screen that may sit on top of others — reset-password and
 * verify-email (opened by a link, on top of whatever was showing) and
 * forgot-password.
 *
 * Both exits clear the stack first instead of replacing just the top screen.
 * A link opened from Forgot password leaves sign-in → forgot-password →
 * reset-password; replacing only the top put sign-in back on a stack that
 * still held forgot-password, and the app was left on "Check your email"
 * after the next sign-in.
 */
export function useLeaveAuthScreen() {
  const router = useRouter();
  return useMemo(
    () => ({
      /** To sign-in, with nothing beneath it. Only while nobody is signed in: the route exists only then. */
      toSignIn(notice?: 'password-reset') {
        if (router.canDismiss()) router.dismissAll();
        router.replace(notice ? { pathname: '/login', params: { notice } } : '/login');
      },
      /**
       * To Forgot password, over sign-in so that its back control lands there.
       * Signed-out only, like sign-in.
       */
      toForgotPassword() {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/login');
        router.push('/forgot-password');
      },
      /**
       * Into the app: back down to the first screen beneath, which signed in
       * is the account's home; or, opened cold with nothing beneath, to the
       * tabs (the root layout moves a business account on to its own).
       */
      toApp() {
        if (router.canDismiss()) router.dismissAll();
        else router.replace('/(tabs)');
      },
    }),
    [router],
  );
}
