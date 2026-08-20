import { Hono } from "hono";
import { env } from "../env";
import { secretsMatch } from "../lib/secrets";
import { parseWebhookEvent, applyWebhookEvent } from "../lib/entitlement";
import {
  loadEntitlement,
  saveEntitlement,
  findUserForRevenueCatId,
} from "../lib/user-entitlement";

/**
 * RevenueCat webhook.
 *
 * Registered before the auth guard — RevenueCat calls it server-to-server, so
 * there is no session. Authenticity comes from the shared Authorization header
 * configured in the RevenueCat dashboard, compared in constant time.
 *
 * This is the source of truth for renewals, cancellations and expiries. The
 * client can only ever *ask* for a refresh (see /api/me/entitlement/refresh);
 * it can never assert what tier it is on.
 */

const router = new Hono();

router.post("/webhook", async (c) => {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    // Nothing to verify against, so nothing here could be trusted.
    return c.json({ error: "Subscriptions are not configured on this server." }, 503);
  }

  // RevenueCat sends the configured value verbatim in Authorization.
  if (!secretsMatch(c.req.header("Authorization"), env.REVENUECAT_WEBHOOK_SECRET)) {
    console.warn("[revenuecat:webhook] rejected: bad authorization header");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const event = parseWebhookEvent(body);
  if (!event) return c.json({ error: "Malformed event" }, 400);

  if (!event.appUserId) {
    // Nothing to attribute the purchase to. Acknowledge so RevenueCat stops
    // retrying an event we can never act on.
    console.warn(`[revenuecat:webhook] ${event.type} with no app_user_id`);
    return c.json({ received: true, applied: false });
  }

  const userId = await findUserForRevenueCatId(event.appUserId);
  if (!userId) {
    console.warn(
      `[revenuecat:webhook] ${event.type} for unknown app_user_id ${event.appUserId}`
    );
    return c.json({ received: true, applied: false });
  }

  const next = applyWebhookEvent(event, await loadEntitlement(userId));
  if (!next) {
    // The event says nothing about our entitlement — leave the row alone.
    return c.json({ received: true, applied: false });
  }

  await saveEntitlement(userId, next);
  console.log(
    `[revenuecat:webhook] ${event.type} → ${next.tier} for user ${userId}` +
      (next.expiresAt ? ` until ${next.expiresAt.toISOString()}` : "")
  );
  return c.json({ received: true, applied: true });
});

export { router as revenueCatRouter };
