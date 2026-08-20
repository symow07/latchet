/**
 * Entitlement state and the paywall, for screens.
 *
 * Gating in the UI is a courtesy — it saves a round trip and shows the paywall
 * at the right moment. It is not the enforcement; that lives on the server, and
 * a client that lied about its tier would simply get a 402.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import {
  fetchEntitlement,
  refreshEntitlement,
  isUpgradeRequired,
  FREE_ENTITLEMENT,
  type Entitlement,
} from './entitlementApi';
import { isRevenueCatEnabled, restorePurchases } from './revenuecatClient';

export const ENTITLEMENT_QUERY_KEY = ['entitlement'] as const;

export function useEntitlement() {
  const queryClient = useQueryClient();

  const query = useQuery<Entitlement>({
    queryKey: ENTITLEMENT_QUERY_KEY,
    queryFn: fetchEntitlement,
    // Entitlement changes rarely and a stale read only ever costs one 402.
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const entitlement = query.data ?? FREE_ENTITLEMENT;

  /** Pull the server's view again — after a purchase, or a 402. */
  const refresh = useCallback(async () => {
    const fresh = await refreshEntitlement().catch(() => null);
    if (fresh) queryClient.setQueryData(ENTITLEMENT_QUERY_KEY, fresh);
    else await queryClient.invalidateQueries({ queryKey: ENTITLEMENT_QUERY_KEY });
  }, [queryClient]);

  /**
   * Show the paywall. Returns true if the user came back entitled.
   *
   * RevenueCat's own paywall is used rather than a hand-built one: it carries
   * the store-specific legal copy Apple requires, and it is configured from the
   * dashboard, so pricing and copy change without an app release.
   */
  const presentPaywall = useCallback(async (): Promise<boolean> => {
    if (!isRevenueCatEnabled()) return false;

    try {
      const result = await RevenueCatUI.presentPaywall({ displayCloseButton: true });
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        // The webhook may not have landed yet, so ask the server to look now.
        await refresh();
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[entitlement] paywall failed:', e);
      return false;
    }
  }, [refresh]);

  /** Apple requires a restore path for previously-purchased subscriptions. */
  const restore = useCallback(async (): Promise<boolean> => {
    const result = await restorePurchases();
    // Whatever the SDK reports, the server decides — re-read rather than trust.
    await refresh();
    return result.ok;
  }, [refresh]);

  /**
   * Turn a 402 into a paywall.
   *
   * The server answers `upgrade_required` precisely so a paid feature can offer
   * the upgrade at the moment it is wanted, rather than surfacing "request
   * failed". Returns true if the user came back entitled, so the caller can
   * retry what they were doing.
   */
  const handleUpgradeRequired = useCallback(
    async (error: unknown): Promise<boolean> => {
      if (!isUpgradeRequired(error)) return false;
      return presentPaywall();
    },
    [presentPaywall]
  );

  return {
    entitlement,
    isPro: entitlement.tier === 'pro',
    handleUpgradeRequired,
    isLoading: query.isLoading,
    refresh,
    presentPaywall,
    restore,
  };
}
