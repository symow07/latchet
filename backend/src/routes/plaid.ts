import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { env } from "../env";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import { mapAccountType, mapCategory } from "../lib/plaid-mappers";
import { verifyPlaidWebhook, type PlaidJwk } from "../lib/plaid-webhook";

/**
 * Real bank linking via Plaid (replaces the former simulated mock). Uses the
 * Plaid REST API directly (no SDK dependency). All routes 503 until
 * PLAID_CLIENT_ID / PLAID_SECRET are configured.
 *
 * Flow:
 *   1. POST /link-token        → client opens Plaid Link with this token
 *   2. POST /exchange          → swap public_token for an access token (stored
 *                                encrypted), persist the Item + its accounts
 *   3. GET  /accounts          → list linked accounts
 *   4. POST /transactions/sync → incremental pull via Plaid /transactions/sync,
 *                                upsert into the user's Transactions
 *   5. POST /webhook           → Plaid notifies us of new transactions
 *   6. DELETE /items/:id       → remove an Item (revoke + delete locally)
 */

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

function plaidConfigured(): boolean {
  return !!env.PLAID_CLIENT_ID && !!env.PLAID_SECRET;
}

/** Call a Plaid endpoint with the shared credentials injected. */
async function plaid<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const host = PLAID_HOSTS[env.PLAID_ENV] ?? PLAID_HOSTS.sandbox;
  const res = await fetch(`${host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Plaid ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json as T;
}

// Maps a Hosted Link `link_token` to the user who created it, so the
// SESSION_FINISHED webhook can exchange the resulting public_token for the
// right account. Process-local (single-instance) — fine for this deployment.
const pendingLinkSessions = new Map<string, string>();

// Webhook verification keys, cached by key_id. A given key_id always maps to
// the same key, so this only ever grows by the handful of keys Plaid rotates
// through — and it keeps a burst of webhooks from becoming a burst of
// /webhook_verification_key/get calls.
const verificationKeys = new Map<string, PlaidJwk>();

async function getVerificationKey(keyId: string): Promise<PlaidJwk | null> {
  const cached = verificationKeys.get(keyId);
  if (cached) return cached;
  try {
    const res = await plaid<{ key: PlaidJwk }>("/webhook_verification_key/get", {
      key_id: keyId,
    });
    if (!res?.key) return null;
    // Never cache a key Plaid has already retired.
    if (!res.key.expired_at) verificationKeys.set(keyId, res.key);
    return res.key;
  } catch (e) {
    console.warn(
      "[plaid:webhook] key fetch failed:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Webhook is unauthenticated (Plaid calls it server-to-server); register it
// before the auth guard so it is not blocked. Authenticity comes from Plaid's
// ES256 signature instead — without it anyone could POST a
// SYNC_UPDATES_AVAILABLE body and drive unbounded /transactions/sync runs
// against our Plaid quota and our single SQLite writer.
router.post("/webhook", async (c) => {
  if (!plaidConfigured()) {
    // No credentials means no way to fetch verification keys, so nothing here
    // could be trusted anyway.
    return c.json({ error: "Bank linking is not configured on this server." }, 503);
  }

  // The signature covers the exact bytes, so hash the raw text — re-serializing
  // parsed JSON would not reproduce the same digest.
  const rawBody = await c.req.text();
  const verification = await verifyPlaidWebhook(
    c.req.header("Plaid-Verification"),
    rawBody,
    { getKey: getVerificationKey }
  );
  if (!verification.ok) {
    console.warn(`[plaid:webhook] rejected: ${verification.reason}`);
    return c.json({ error: "Invalid webhook signature" }, 401);
  }

  let body: any = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Malformed body" }, 400);
  }
  const webhookType = body?.webhook_type as string | undefined;
  const webhookCode = body?.webhook_code as string | undefined;

  // Hosted Link finished: exchange the returned public_token(s).
  if (webhookType === "LINK" && webhookCode === "SESSION_FINISHED" && body?.status === "SUCCESS") {
    const linkToken = body?.link_token as string | undefined;
    const publicTokens = (body?.public_tokens as string[] | undefined) ?? [];
    const userId = linkToken ? pendingLinkSessions.get(linkToken) : undefined;
    if (userId) {
      for (const pt of publicTokens) {
        await exchangeAndPersist(userId, pt).catch((e) =>
          console.warn("[plaid:webhook] exchange failed:", e instanceof Error ? e.message : e)
        );
      }
      if (linkToken) pendingLinkSessions.delete(linkToken);
    }
    return c.json({ received: true });
  }

  // New transactions available for an existing Item.
  const itemId = body?.item_id as string | undefined;
  if (itemId && (webhookCode === "SYNC_UPDATES_AVAILABLE" || webhookCode === "DEFAULT_UPDATE")) {
    const item = await prisma.plaidItem.findUnique({ where: { itemId } });
    if (item) await syncItemTransactions(item.id).catch(() => {});
  }
  return c.json({ received: true });
});

// Auth guard for the remaining (user-facing) routes.
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!plaidConfigured()) {
    return c.json({ error: "Bank linking is not configured on this server." }, 503);
  }
  await next();
});

router.post("/link-token", async (c) => {
  const user = c.get("user")!;
  const data = await plaid<{ link_token: string; expiration: string; hosted_link_url?: string }>(
    "/link/token/create",
    {
      user: { client_user_id: user.id },
      client_name: "Real Budget",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      webhook: `${env.BACKEND_URL}/api/plaid/webhook`,
      // Hosted Link lets the app open bank login in a browser (expo-web-browser)
      // without bundling the native Plaid Link SDK. Completion arrives via the
      // SESSION_FINISHED webhook above.
      hosted_link: {},
    }
  );
  // Remember which user owns this Link session for the webhook exchange.
  pendingLinkSessions.set(data.link_token, user.id);
  return c.json({
    linkToken: data.link_token,
    hostedLinkUrl: data.hosted_link_url ?? null,
    expiration: data.expiration,
  });
});

/** Exchange a public_token, persist the Item + accounts, run an initial sync. */
async function exchangeAndPersist(userId: string, publicToken: string) {
  const exchanged = await plaid<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: publicToken }
  );

  // Resolve institution metadata (best-effort).
  let institutionId: string | undefined;
  let institutionName: string | undefined;
  try {
    const itemInfo = await plaid<{ item: { institution_id?: string } }>("/item/get", {
      access_token: exchanged.access_token,
    });
    institutionId = itemInfo.item.institution_id ?? undefined;
    if (institutionId) {
      const inst = await plaid<{ institution: { name: string } }>("/institutions/get_by_id", {
        institution_id: institutionId,
        country_codes: ["US"],
      });
      institutionName = inst.institution.name;
    }
  } catch {
    /* institution lookup is non-fatal */
  }

  const item = await prisma.plaidItem.upsert({
    where: { itemId: exchanged.item_id },
    create: {
      userId,
      itemId: exchanged.item_id,
      accessTokenEnc: encryptSecret(exchanged.access_token),
      institutionId,
      institutionName,
    },
    update: {
      accessTokenEnc: encryptSecret(exchanged.access_token),
      status: "active",
    },
  });

  await refreshItemAccounts(item.id);
  await syncItemTransactions(item.id).catch(() => {});
  return item;
}

const exchangeSchema = z.object({ publicToken: z.string().min(1) });

router.post("/exchange", zValidator("json", exchangeSchema), async (c) => {
  const user = c.get("user")!;
  const { publicToken } = c.req.valid("json");
  const item = await exchangeAndPersist(user.id, publicToken);
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
// /transactions/sync. Ownership is enforced via the parent Item's userId.
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
  const items = await prisma.plaidItem.findMany({ where: { userId: user.id, status: "active" } });
  let added = 0;
  const errors: string[] = [];
  for (const item of items) {
    try {
      added += await syncItemTransactions(item.id);
    } catch (e) {
      errors.push(`${item.institutionName ?? item.itemId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return c.json({ added, errors });
});

router.delete("/items/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const item = await prisma.plaidItem.findFirst({ where: { id, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);
  try {
    await plaid("/item/remove", { access_token: decryptSecret(item.accessTokenEnc) });
  } catch {
    /* still delete locally even if revoke fails */
  }
  await prisma.plaidItem.delete({ where: { id: item.id } });
  return c.json({ success: true });
});

/** Pull the latest balances/accounts for an Item and mirror them locally. */
async function refreshItemAccounts(itemRowId: string): Promise<void> {
  const item = await prisma.plaidItem.findUnique({ where: { id: itemRowId } });
  if (!item) return;
  const data = await plaid<{
    accounts: Array<{
      account_id: string;
      name: string;
      mask?: string;
      type?: string;
      subtype?: string;
      balances: { current?: number; iso_currency_code?: string };
    }>;
  }>("/accounts/get", { access_token: decryptSecret(item.accessTokenEnc) });

  for (const a of data.accounts) {
    await prisma.plaidAccount.upsert({
      where: { plaidAccountId: a.account_id },
      create: {
        itemId: item.id,
        plaidAccountId: a.account_id,
        name: a.name,
        type: mapAccountType(a.type, a.subtype),
        mask: a.mask,
        balance: a.balances.current ?? 0,
        currency: a.balances.iso_currency_code ?? "USD",
      },
      update: {
        name: a.name,
        balance: a.balances.current ?? 0,
        currency: a.balances.iso_currency_code ?? "USD",
      },
    });
  }
}

/**
 * Incrementally pull transactions for an Item via /transactions/sync and upsert
 * them into the user's Transactions. Returns the number of added transactions.
 */
async function syncItemTransactions(itemRowId: string): Promise<number> {
  const item = await prisma.plaidItem.findUnique({ where: { id: itemRowId } });
  if (!item) return 0;
  const accessToken = decryptSecret(item.accessTokenEnc);

  // Accounts the user has disabled syncing for — their transactions are skipped.
  const disabled = new Set(
    (await prisma.plaidAccount.findMany({ where: { itemId: item.id, isEnabled: false } })).map(
      (a) => a.plaidAccountId
    )
  );

  let cursor = item.cursor ?? undefined;
  let added = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await plaid<{
      added: Array<any>;
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", { access_token: accessToken, cursor });

    for (const t of page.added) {
      if (disabled.has(t.account_id)) continue;
      // Plaid: positive amount = money out (expense), negative = money in.
      const isExpense = t.amount >= 0;
      await prisma.transaction.upsert({
        where: { id: `plaid_${t.transaction_id}` },
        create: {
          id: `plaid_${t.transaction_id}`,
          userId: item.userId,
          amount: Math.abs(t.amount),
          category: mapCategory(t.category),
          type: isExpense ? "Expense" : "Income",
          note: t.name ?? t.merchant_name ?? "",
          dateISO: t.date,
          currency: t.iso_currency_code ?? "USD",
        },
        update: {},
      });
      added++;
    }

    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  await prisma.plaidItem.update({
    where: { id: item.id },
    data: { cursor, updatedAt: new Date() },
  });
  await refreshItemAccounts(item.id).catch(() => {});
  return added;
}

export { router as plaidRouter };
