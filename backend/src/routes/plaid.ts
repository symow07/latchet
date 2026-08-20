import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { env } from "../env";
import { getProvider, DEFAULT_PROVIDER_ID } from "../lib/bank-providers";
import {
  persistConnection,
  syncConnectionTransactions,
  removeConnection,
} from "../lib/bank-sync";
import { ExpiringMap, OAUTH_STATE_TTL_MS, autoSweep } from "../lib/expiring-map";
import { userIsPro } from "../lib/user-entitlement";

/**
 * Bank linking routes.
 *
 * Provider protocol lives in lib/bank-providers, persistence in lib/bank-sync;
 * this file is routing and ownership checks only. Adding Salt Edge or TrueLayer
 * means a new provider module, not changes here.
 *
 * The path stays /api/plaid because the shipped mobile client is pinned to it.
 * It is a legacy name, not a statement about which provider serves a request.
 *
 * Flow:
 *   1. POST /link-token        → client opens the provider's link flow
 *   2. POST /exchange          → swap the public token for a durable one
 *   3. GET  /accounts          → list linked accounts
 *   4. POST /transactions/sync → incremental pull
 *   5. POST /webhook           → provider notifies us of new transactions
 *   6. DELETE /items/:id       → revoke + delete locally
 */

const provider = getProvider(DEFAULT_PROVIDER_ID);

// Maps a link token to the user who created it, so the completion webhook can
// exchange the resulting public token for the right account. Process-local
// (single-instance). Entries expire so an abandoned bank login does not leak
// one forever.
const pendingLinkSessions = autoSweep(
  new ExpiringMap<string, string>(OAUTH_STATE_TTL_MS)
);

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Webhook is unauthenticated (the provider calls it server-to-server); it is
// registered before the auth guard so it is not blocked. Authenticity comes
// from the provider's signature instead — without it anyone could POST a
// "transactions changed" body and drive unbounded syncs against our quota and
// our single SQLite writer.
router.post("/webhook", async (c) => {
  if (!provider.isConfigured()) {
    // No credentials means no way to verify a signature, so nothing here could
    // be trusted anyway.
    return c.json({ error: "Bank linking is not configured on this server." }, 503);
  }

  // Signatures cover the exact bytes, so hash the raw text — re-serialising
  // parsed JSON would not reproduce the same digest.
  const rawBody = await c.req.text();
  const verification = await provider.verifyWebhook(
    (name) => c.req.header(name),
    rawBody
  );
  if (!verification.ok) {
    console.warn(`[bank:webhook] rejected: ${verification.reason}`);
    return c.json({ error: "Invalid webhook signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Malformed body" }, 400);
  }

  const event = provider.parseWebhook(body);

  if (event.kind === "link-finished") {
    const userId = event.linkToken ? pendingLinkSessions.get(event.linkToken) : undefined;
    if (userId) {
      for (const publicToken of event.publicTokens) {
        await persistConnection(userId, provider, await provider.exchange(publicToken)).catch(
          (e) =>
            console.warn(
              "[bank:webhook] exchange failed:",
              e instanceof Error ? e.message : e
            )
        );
      }
      pendingLinkSessions.delete(event.linkToken);
    }
    return c.json({ received: true });
  }

  if (event.kind === "transactions-changed") {
    const item = await prisma.plaidItem.findUnique({
      where: { itemId: event.connectionExternalId },
    });
    if (item) await syncConnectionTransactions(item.id).catch(() => {});
  }

  return c.json({ received: true });
});

// Auth guard for the remaining (user-facing) routes.
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!provider.isConfigured()) {
    return c.json({ error: "Bank linking is not configured on this server." }, 503);
  }

  // Bank sync is a paid feature, and every sync costs Plaid quota. The tier
  // comes from the database — a client asserting Pro gets nothing.
  if (!(await userIsPro(user.id))) {
    return c.json(
      {
        error: "Bank sync is a Pro feature.",
        code: "upgrade_required",
        tier: "free",
      },
      402
    );
  }
  await next();
});

router.post("/link-token", async (c) => {
  const user = c.get("user")!;
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: { currency: true },
  });

  const session = await provider.createLinkSession({
    userId: user.id,
    currency: settings?.currency,
    webhookUrl: `${env.BACKEND_URL}/api/plaid/webhook`,
  });

  // Remember which user owns this session for the webhook exchange.
  pendingLinkSessions.set(session.linkToken, user.id);
  return c.json({
    linkToken: session.linkToken,
    hostedLinkUrl: session.hostedUrl,
    expiration: session.expiresAt,
  });
});

const exchangeSchema = z.object({ publicToken: z.string().min(1) });

router.post("/exchange", zValidator("json", exchangeSchema), async (c) => {
  const user = c.get("user")!;
  const { publicToken } = c.req.valid("json");

  const connection = await provider.exchange(publicToken);
  const item = await persistConnection(user.id, provider, connection);

  const accounts = await prisma.plaidAccount.findMany({ where: { itemId: item.id } });
  return c.json({ itemId: item.id, institutionName: item.institutionName, accounts });
});

router.get("/accounts", async (c) => {
  const user = c.get("user")!;
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id },
    include: { accounts: true },
  });
  return c.json({ items });
});

const toggleSchema = z.object({ isEnabled: z.boolean() });

// Enable/disable syncing for a single account. Disabled accounts are skipped by
// the sync. Ownership is enforced via the parent connection's userId.
router.patch("/accounts/:id", zValidator("json", toggleSchema), async (c) => {
  const user = c.get("user")!;
  const plaidAccountId = c.req.param("id");
  const { isEnabled } = c.req.valid("json");

  const account = await prisma.plaidAccount.findUnique({
    where: { plaidAccountId },
    include: { item: true },
  });
  if (!account || account.item.userId !== user.id) {
    return c.json({ error: "Not found" }, 404);
  }

  await prisma.plaidAccount.update({ where: { plaidAccountId }, data: { isEnabled } });
  return c.json({ success: true });
});

router.post("/transactions/sync", async (c) => {
  const user = c.get("user")!;
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id, status: "active" },
  });

  let added = 0;
  const errors: string[] = [];
  for (const item of items) {
    try {
      added += await syncConnectionTransactions(item.id);
    } catch (e) {
      errors.push(
        `${item.institutionName ?? item.itemId}: ${e instanceof Error ? e.message : e}`
      );
    }
  }
  return c.json({ added, errors });
});

router.delete("/items/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const item = await prisma.plaidItem.findFirst({ where: { id, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  await removeConnection(item.id);
  return c.json({ success: true });
});

export { router as plaidRouter };
