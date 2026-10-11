/**
 * The React and network half of an explicit sign-out.
 *
 * user-session.ts signOutAndClear owns the order of the steps and is tested
 * without a device; this supplies what it calls — the flush, the server
 * sign-out, the query cache, the account-type store and the confirmation —
 * from inside the app. Personal settings, business settings and the
 * delete-account flow all build their sign-out from useSignOutDeps().
 */
import { useMemo } from 'react';
import { Alert } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { SESSION_QUERY_KEY, useSession } from './auth/use-session';
import { endServerSession } from './auth/server-sign-out';
import { useAccountTypeStore } from './account-type-store';
import { flushBeforeSignOut } from './cloud-sync';
import { drainPendingCaptures } from './pending-drain';
import { t } from './i18n/core';
import type { PendingChanges, SignOutDeps } from './user-session';

/**
 * Forget every cached query that belongs to a user — all of them except the
 * session itself. Used on sign-out, and by the root layout whenever the
 * signed-in user changes, so nothing one user loaded is shown to the next.
 */
export function clearUserQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] });
}

/**
 * The last step of a sign-out that reaches React: drop the user's queries and
 * record that there is no session, which sends the root layout to the login
 * screen without waiting for a network round trip it no longer needs (the
 * session cookie is already gone from the device).
 */
export function markSignedOut(queryClient: QueryClient): void {
  clearUserQueries(queryClient);
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
}

/** Ask before a sign-out deletes changes the server does not have. */
export function confirmDiscardUnsynced(pending: PendingChanges): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t('signOutFlow.unsyncedTitle'),
      pending.flushFailed
        ? t('signOutFlow.flushFailedBody')
        : t('signOutFlow.unsyncedBody', { count: pending.unsynced }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('signOutFlow.signOutAnyway'), style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** What signOutAndClear needs for the signed-in user; null while nobody is. */
export function useSignOutDeps(): SignOutDeps | null {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const resetAccountType = useAccountTypeStore((s) => s.reset);
  const userId = session?.user?.id ?? null;

  return useMemo<SignOutDeps | null>(
    () =>
      userId
        ? {
            userId,
            // Siri captures spoken before signing out are this user's: land
            // them in this ledger, so the flush sends them, before it is deleted.
            drainPending: () => drainPendingCaptures(userId),
            flush: flushBeforeSignOut,
            confirmDiscard: confirmDiscardUnsynced,
            signOut: endServerSession,
            clearQueryCache: () => markSignedOut(queryClient),
            resetAccountType,
          }
        : null,
    [userId, queryClient, resetAccountType],
  );
}
