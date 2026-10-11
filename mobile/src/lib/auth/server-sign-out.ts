import { authClient } from './auth-client';

/**
 * End the session on the server.
 *
 * The one place outside the auth client that signs out: every explicit
 * sign-out goes through user-session.ts signOutAndClear, which calls this
 * between flushing the user's changes and deleting their data.
 *
 * The expo client drops the stored session cookie before the request is even
 * sent (@better-auth/expo's fetch plugin, on any /sign-out URL), so after this
 * the phone is signed out whether or not the server answered. A failure is
 * still reported, for the log.
 */
export async function endServerSession(): Promise<void> {
  const result = await authClient.signOut();
  if (result?.error) {
    throw new Error(`Server sign-out failed: ${result.error.message ?? result.error.status}`);
  }
}
