/**
 * Subscription entitlement.
 *
 * The tier a user is on is decided here, on the server, and nowhere else.
 * Client-side gating is bypassed in minutes, and the Pro features are exactly
 * the ones that spend money per call — an unguarded /ai/chat is someone else's
 * OpenAI bill.
 *
 * Pure and dependency-free so the webhook state machine can be tested without
 * RevenueCat or a database.
 */

export type Tier = "free" | "pro";

export interface EntitlementState {
  tier: Tier;
  /** null means "no known expiry" — treated as active for a pro tier. */
  expiresAt: Date | null;
}

export const FREE: EntitlementState = { tier: "free", expiresAt: null };

/**
 * Free tier gets a taste of the AI advisor rather than a wall — five calls a
 * day converts better than zero, and the spend is bounded.
 */
export const FREE_AI_CALLS_PER_DAY = 5;
export const PRO_AI_BURST_MAX = 20;
export const PRO_AI_BURST_WINDOW_MS = 5 * 60_000;
export const PRO_AI_DAILY_MAX = 200;

/**
 * Is this entitlement currently worth anything?
 *
 * An expiry in the past means the row is stale — the EXPIRATION webhook may not
 * have arrived, or may have been missed entirely. Reading the date rather than
 * trusting the tier means a missed webhook cannot leave someone on Pro forever.
 */
export function isPro(state: EntitlementState, now: Date = new Date()): boolean {
  if (state.tier !== "pro") return false;
  if (state.expiresAt === null) return true;
  return state.expiresAt.getTime() > now.getTime();
}

/** RevenueCat webhook event types we act on. */
export type WebhookEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "PRODUCT_CHANGE"
  | "UNCANCELLATION"
  | "CANCELLATION"
  | "EXPIRATION"
  | "BILLING_ISSUE";

export interface WebhookEvent {
  type: string;
  /** RevenueCat's app_user_id — equals our User.id when the client sets it. */
  appUserId: string | null;
  /** Epoch ms, when present. */
  expiresAtMs: number | null;
  entitlementIds: string[];
}

/** The entitlement this app sells. Configured under this name in RevenueCat. */
export const PRO_ENTITLEMENT_ID = "pro";

/** Pull the fields we care about out of a raw webhook body. */
export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  const event = (body as { event?: Record<string, unknown> })?.event;
  if (!event || typeof event !== "object") return null;

  const type = typeof event.type === "string" ? event.type : "";
  if (!type) return null;

  const ids = Array.isArray(event.entitlement_ids)
    ? (event.entitlement_ids as unknown[]).filter((i): i is string => typeof i === "string")
    : typeof event.entitlement_id === "string"
      ? [event.entitlement_id]
      : [];

  return {
    type,
    appUserId:
      typeof event.app_user_id === "string" && event.app_user_id ? event.app_user_id : null,
    expiresAtMs:
      typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null,
    entitlementIds: ids,
  };
}

/**
 * The entitlement state an event implies.
 *
 * Returns null when the event says nothing about our entitlement — an unknown
 * type, or one scoped to a different entitlement id — so the caller leaves the
 * row alone rather than guessing.
 *
 * The subtlety worth stating: CANCELLATION does NOT revoke access. It means
 * auto-renew was switched off, and the user has paid through the end of the
 * period. Revoking there would take away time they bought. EXPIRATION is the
 * event that actually ends access. BILLING_ISSUE likewise is a warning during
 * the grace period, not the end of it.
 */
export function applyWebhookEvent(
  event: WebhookEvent,
  current: EntitlementState,
  now: Date = new Date()
): EntitlementState | null {
  // Events carrying entitlement ids must mention ours to be relevant.
  if (event.entitlementIds.length > 0 && !event.entitlementIds.includes(PRO_ENTITLEMENT_ID)) {
    return null;
  }

  const expiresAt = event.expiresAtMs !== null ? new Date(event.expiresAtMs) : null;

  switch (event.type as WebhookEventType) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION":
      return { tier: "pro", expiresAt };

    case "CANCELLATION":
    case "BILLING_ISSUE":
      // Access continues to the end of the paid period.
      return { tier: "pro", expiresAt: expiresAt ?? current.expiresAt };

    case "EXPIRATION":
      return FREE;

    default:
      return null;
  }
}

/** AI allowance for a tier. */
export function aiAllowance(pro: boolean): {
  burstMax: number;
  burstWindowMs: number;
  dailyMax: number;
} {
  return pro
    ? {
        burstMax: PRO_AI_BURST_MAX,
        burstWindowMs: PRO_AI_BURST_WINDOW_MS,
        dailyMax: PRO_AI_DAILY_MAX,
      }
    : {
        // The daily cap is what bounds a free user; the burst window just
        // stops a single tap-storm from spending it in one second.
        burstMax: FREE_AI_CALLS_PER_DAY,
        burstWindowMs: PRO_AI_BURST_WINDOW_MS,
        dailyMax: FREE_AI_CALLS_PER_DAY,
      };
}
