import { prisma } from "../prisma";
import { fetchWithTimeout } from "./fetch-timeout";
import { env } from "../env";
import {
  isPro,
  PRO_ENTITLEMENT_ID,
  FREE,
  type EntitlementState,
} from "./entitlement";

/**
 * Reading and writing a user's entitlement.
 *
 * Separate from lib/entitlement (which is pure) so the state machine stays
 * testable without a database.
 */

export async function loadEntitlement(userId: string): Promise<EntitlementState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { entitlement: true, entitlementExpiresAt: true },
  });
  if (!user) return FREE;
  return {
    tier: user.entitlement === "pro" ? "pro" : "free",
    expiresAt: user.entitlementExpiresAt,
  };
}

/** True when the user may use paid features right now. */
export async function userIsPro(userId: string): Promise<boolean> {
  return isPro(await loadEntitlement(userId));
}

export async function saveEntitlement(
  userId: string,
  state: EntitlementState
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { entitlement: state.tier, entitlementExpiresAt: state.expiresAt },
  });
}

/**
 * Resolve the account a webhook is about.
 *
 * RevenueCat's app_user_id is our User.id once the client has called setUserId,
 * so the direct lookup is the normal path; revenueCatUserId covers a purchase
 * made before the id was set and later aliased.
 */
export async function findUserForRevenueCatId(appUserId: string): Promise<string | null> {
  const direct = await prisma.user.findUnique({
    where: { id: appUserId },
    select: { id: true },
  });
  if (direct) return direct.id;

  // Oldest first, so the answer is the same on every call should two accounts
  // ever carry the same alias. Postgres has no implicit row order.
  const aliased = await prisma.user.findFirst({
    where: { revenueCatUserId: appUserId },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return aliased?.id ?? null;
}

interface SubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null }>;
  };
}

/**
 * Ask RevenueCat directly what a subscriber is entitled to.
 *
 * A purchase completes on device seconds before the webhook lands, and making
 * the user stare at a paywall they just paid to dismiss is not acceptable. The
 * client calls this immediately after purchasing; the webhook remains the
 * source of truth for renewals and expiries.
 */
export async function fetchEntitlementFromRevenueCat(
  appUserId: string
): Promise<EntitlementState | null> {
  if (!env.REVENUECAT_API_KEY) return null;

  const res = await fetchWithTimeout(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${env.REVENUECAT_API_KEY}`,
        Accept: "application/json",
      },
      timeoutMs: 8_000,
    }
  );
  if (!res.ok) {
    throw new Error(`RevenueCat subscribers ${res.status}`);
  }

  const json = (await res.json()) as SubscriberResponse;
  const entitlement = json.subscriber?.entitlements?.[PRO_ENTITLEMENT_ID];
  if (!entitlement) return FREE;

  // A null expires_date means a lifetime purchase.
  const expiresAt = entitlement.expires_date ? new Date(entitlement.expires_date) : null;
  return { tier: "pro", expiresAt };
}
