/**
 * Subscription entitlement, as the client sees it.
 *
 * The tier is always the server's answer. The client may show Pro
 * optimistically for the moment between a purchase completing and the webhook
 * landing, but every gate that costs money is enforced server-side — see
 * backend/src/lib/entitlement.ts.
 */
import { request } from './api-errors';

// The client is imported where it is used, so the pure parts of this module
// (devProOverrideActive) are testable without a device.
async function client() {
  return (await import('./api/api')).api;
}

export type Tier = 'free' | 'pro';

export interface Entitlement {
  tier: Tier;
  expiresAt: string | null;
}

export const FREE_ENTITLEMENT: Entitlement = { tier: 'free', expiresAt: null };

/** What the development override reports: Pro, with no end. */
export const DEV_PRO_ENTITLEMENT: Entitlement = { tier: 'pro', expiresAt: null };

/**
 * Whether this build shows every Pro feature as unlocked, so bank linking can
 * be tried in development without a purchase: a development build (__DEV__)
 * with EXPO_PUBLIC_DEV_PRO=true. A release build ignores the variable — and
 * the server, which enforces the tier, has its own override (DEV_PRO_OVERRIDE)
 * that production ignores in turn.
 */
export function devProOverrideActive(build: { isDev: boolean | undefined; flag: string | undefined }): boolean {
  return build.isDev === true && (build.flag ?? '').trim().toLowerCase() === 'true';
}

interface MeResponse {
  entitlement?: { tier?: string; expiresAt?: string | null };
}

// Both calls reject with an ApiFailure (lib/api-errors), whose message is
// already in the reader's language. It keeps the status and the body, so
// isUpgradeRequired below reads it as it read the client's own error.

/** The tier the server currently holds for this account. */
export async function fetchEntitlement(): Promise<Entitlement> {
  const api = await client();
  const res = await request(() => api.get<MeResponse>('/api/me'));
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
  const api = await client();
  const res = await request(() =>
    api.post<{ tier?: string; expiresAt?: string | null }>('/api/me/entitlement/refresh', {}),
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
