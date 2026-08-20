/**
 * Subscription entitlement, as the client sees it.
 *
 * The tier is always the server's answer. The client may show Pro
 * optimistically for the moment between a purchase completing and the webhook
 * landing, but every gate that costs money is enforced server-side — see
 * backend/src/lib/entitlement.ts.
 */
import { api } from './api/api';

export type Tier = 'free' | 'pro';

export interface Entitlement {
  tier: Tier;
  expiresAt: string | null;
}

export const FREE_ENTITLEMENT: Entitlement = { tier: 'free', expiresAt: null };

interface MeResponse {
  entitlement?: { tier?: string; expiresAt?: string | null };
}

/** The tier the server currently holds for this account. */
export async function fetchEntitlement(): Promise<Entitlement> {
  const res = await api.get<MeResponse>('/api/me');
  return {
    tier: res?.entitlement?.tier === 'pro' ? 'pro' : 'free',
    expiresAt: res?.entitlement?.expiresAt ?? null,
  };
}

/**
 * Ask the server to re-read RevenueCat now.
 *
 * Called straight after a purchase: the webhook can take seconds to arrive and
 * the user should not be looking at a paywall they have just paid to dismiss.
 */
export async function refreshEntitlement(): Promise<Entitlement> {
  const res = await api.post<{ tier?: string; expiresAt?: string | null }>(
    '/api/me/entitlement/refresh',
    {}
  );
  return {
    tier: res?.tier === 'pro' ? 'pro' : 'free',
    expiresAt: res?.expiresAt ?? null,
  };
}

/**
 * The server's answer when a free user reaches a paid feature.
 * Distinguishes "you need to upgrade" from a genuine error, so the client can
 * offer the paywall instead of a failure message.
 */
export function isUpgradeRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: number }).status;
  const body = (error as { body?: { code?: string } }).body;
  return status === 402 || body?.code === 'upgrade_required';
}
