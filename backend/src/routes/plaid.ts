import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { env } from "../env";
import {
  BankProviderError,
  getProvider,
  DEFAULT_PROVIDER_ID,
  type BankProvider,
  type LinkSessionResult,
} from "../lib/bank-providers";
import {
  ConnectionOwnedElsewhereError,
  persistConnection,
  removeConnection,
  syncConnectionTransactions,
  type TokenCipher,
} from "../lib/bank-sync";
import { cacheAdd, cacheDelete, cacheGet, cacheSet, cacheTake } from "../lib/distributed/cache";
import type { Db } from "../lib/distributed/clock";
import { userIsPro } from "../lib/user-entitlement";

/**
 * Bank linking routes.
 *
 * Provider protocol lives in lib/bank-providers, persistence in lib/bank-sync;
 * this file is routing, ownership checks and the link session. Adding Salt
 * Edge or TrueLayer means a new provider module, not changes here.
 *
 * The path stays /api/plaid because the shipped mobile client is pinned to it.
 * It is a legacy name, not a statement about which provider serves a request.
 *
 * Linking a bank (Plaid Hosted Link):
 *   1. POST /link-token          the phone gets a hosted URL and opens it in
 *                                the system browser session
 *   2. GET  /link/return/:state  Plaid sends the browser here when the user
 *                                finishes or gives up; we start the exchange
 *                                and send the browser back into the app
 *   3. POST /link/complete       the app asks how it went; exchanges whatever
 *                                is not exchanged yet
 *   4. POST /webhook             Plaid's SESSION_FINISHED / ITEM_ADD_RESULT,
 *                                the path that needs no app at all
 * Each public token is exchanged once, for the user who started the session,
 * however many of 2–4 deliver it and in whatever order.
 *
 * Then: GET /accounts, PATCH /accounts/:id, POST /transactions/sync,
 * DELETE /items/:id?data=keep|delete, and GET /config for the phone to decide
 * whether to offer bank linking at all.
 */

// ── Link sessions ────────────────────────────────────────────────────────────
// A link token maps to the user who created it, so whichever path finishes the
// link exchanges for the right account and nobody else's. It lives in
// CacheEntry, not in this process: the provider's webhook and the browser's
// return reach whichever instance the load balancer picks.

/**
 * How long a link session is remembered. Plaid keeps a finished session's
 * results for six hours; the hosted URL itself lasts 30 minutes.
 */
export const LINK_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long one exchange may hold its public token. Long enough for the
 * exchange and the first account pull, short enough that a crashed instance's
 * claim does not block the retry for long.
 */
export const EXCHANGE_CLAIM_TTL_MS = 3 * 60 * 1000;

/** Where the app is sent back to when it did not say. */
export const DEFAULT_RETURN_URL = "latchet://bank/linked";

interface LinkSessionRecord {
  userId: string;
  /** Where the browser goes back into the app. */
  returnUrl?: string;
}

const linkSessionKey = (linkToken: string) => `plaid:link-session:${linkToken}`;
const returnStateKey = (state: string) => `plaid:link-return:${state}`;
/** Public tokens are credentials; the key holds a digest, never the token. */
const publicTokenKey = (publicToken: string) =>
  `plaid:public-token:${createHash("sha256").update(publicToken).digest("hex")}`;

/** Remember that `userId` started the link session `linkToken`. */
export async function rememberLinkSession(
  linkToken: string,
  userId: string,
  db?: Db,
  extra: { returnUrl?: string } = {}
): Promise<void> {
  const record: LinkSessionRecord = { userId, ...extra };
  await cacheSet(linkSessionKey(linkToken), record, LINK_SESSION_TTL_MS, db);
}

/** The session `linkToken` names, if it is still live. */
export async function findLinkSession(linkToken: string, db?: Db): Promise<LinkSessionRecord | null> {
  return cacheGet<LinkSessionRecord>(linkSessionKey(linkToken), db);
}

/**
 * The user who started `linkToken`, consuming the session: a second call, on
 * this instance or any other, gets null. For a caller that must act at most
 * once per session; the link paths here are idempotent per public token
 * instead, so any of them can repeat.
 */
export async function consumeLinkSession(linkToken: string, db?: Db): Promise<string | null> {
  const session = await cacheTake<LinkSessionRecord>(linkSessionKey(linkToken), db);
  return session?.userId ?? null;
}

/**
 * Whether the app may be sent to `url` when the link ends: only the app's own
 * scheme in production; Expo Go's and the dev client's too elsewhere.
 */
export function isAllowedReturnUrl(url: string, production: boolean): boolean {
  if (/^latchet:\/\/[^\s]*$/.test(url)) return true;
  return !production && /^exp(\+[a-z0-9-]+)?:\/\/[^\s]+$/i.test(url);
}

/** `url` with `params` appended, whatever query it already has. */
function withQuery(url: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

/** A public token whose exchange succeeded but could not be stored; never retried. */
class LinkAlreadyFailedError extends Error {
  constructor() {
    super("this bank link could not be stored");
    this.name = "LinkAlreadyFailedError";
  }
}

/**
 * Where Plaid sends the browser when Hosted Link ends. Over https, our own
 * route, which starts finishing the link server-side and sends the browser
 * back into the app. A development server without https gets the app's
 * address directly instead — Plaid documents custom schemes as allowed there,
 * and plain http as reserved — and the app finishes the link itself.
 */
export function completionRedirectFor(backendUrl: string, state: string, returnUrl: string): string {
  return /^https:\/\//i.test(backendUrl) ? `${backendUrl}/api/plaid/link/return/${state}` : returnUrl;
}

// ── The router ───────────────────────────────────────────────────────────────

export interface PlaidRouteDeps {
  provider: BankProvider;
  /** The Pro guard: the tier from the database, or the development override. */
  isPro(userId: string): Promise<boolean>;
  /** Encrypts access tokens at rest. The process's keys unless a test passes its own. */
  cipher?: TokenCipher;
  /** This server's public base URL, for the webhook and the completion redirect. */
  backendUrl: string;
  /** Production allows only the app's own return scheme. */
  production: boolean;
  /**
   * Runs work that must not hold up a response (finishing a link while the
   * browser goes back to the app). Tests pass one that lets them wait for it.
   */
  runInBackground?: (task: Promise<unknown>) => void;
}

/** How a link ended, as the app is told. */
export interface LinkCompletion {
  status: LinkSessionResult["status"];
  /** Institutions this call exchanged, or found already exchanged. */
  linked: number;
  /** Institutions another path is exchanging right now. */
  inProgress: number;
  exit: LinkSessionResult["exit"];
}

type Vars = {
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
};

export function createPlaidRouter(deps: PlaidRouteDeps) {
  const { provider } = deps;
  const cipher = deps.cipher;
  const runInBackground = deps.runInBackground ?? ((task: Promise<unknown>) => void task);
  const router = new Hono<Vars>();

  /** The injected provider for a connection it owns, else the connection's own. */
  const providerFor = (item: { provider: string }) =>
    item.provider === provider.id ? provider : undefined;

  /**
   * Exchange one public token for `userId`, once. Whoever claims the token
   * first does the work; a concurrent or later caller learns it is in hand or
   * done. A failed exchange releases the claim so a retry can have it.
   *
   * The claim covers the exchange and the account pull only. The first
   * transaction sync runs after it, in the background: it can be long for a
   * two-year history, and it is also what subscribes the connection to the
   * provider's "new transactions" webhooks.
   */
  async function exchangeOnce(
    userId: string,
    publicToken: string
  ): Promise<{ state: "exchanged" | "already" | "in-progress"; itemRowId: string | null }> {
    const key = publicTokenKey(publicToken);
    if (!(await cacheAdd(key, { state: "exchanging" }, EXCHANGE_CLAIM_TTL_MS))) {
      const held = await cacheGet<{ state: string; itemRowId?: string }>(key);
      if (held?.state === "done") return { state: "already", itemRowId: held.itemRowId ?? null };
      if (held?.state === "failed") throw new LinkAlreadyFailedError();
      return { state: "in-progress", itemRowId: null };
    }

    let connection;
    try {
      connection = await provider.exchange(publicToken);
    } catch (e) {
      await cacheDelete(key).catch(() => {});
      throw e;
    }

    // From here the provider has issued a live access token: the public token
    // cannot be exchanged again, so the claim is never released.
    let itemRowId: string;
    try {
      itemRowId = (await persistConnection(userId, provider, connection, { cipher, initialSync: false })).id;
    } catch (e) {
      const stored = await prisma.plaidItem
        .findUnique({ where: { itemId: connection.externalId }, select: { id: true, userId: true } })
        .catch(() => null);
      if (stored && stored.userId === userId) {
        // The row is stored; only the account pull failed, and the next sync
        // retries it.
        await cacheSet(key, { state: "done", itemRowId: stored.id }, LINK_SESSION_TTL_MS);
        return { state: "exchanged", itemRowId: stored.id };
      }
      // Nothing stored means nobody could ever revoke this token: revoke it
      // now rather than leave a live grant at the bank.
      if (!(e instanceof ConnectionOwnedElsewhereError)) {
        await provider.removeConnection(connection.accessToken).catch(() => {});
      }
      await cacheSet(key, { state: "failed" }, LINK_SESSION_TTL_MS);
      throw e;
    }
    await cacheSet(key, { state: "done", itemRowId }, LINK_SESSION_TTL_MS);
    runInBackground(
      syncConnectionTransactions(itemRowId, { provider, cipher }).catch((e) =>
        console.warn("[bank] first sync failed:", e instanceof Error ? e.message : e)
      )
    );
    return { state: "exchanged", itemRowId };
  }

  /** Exchange every public token the session produced, for `userId`. */
  async function finishLink(linkToken: string, userId: string): Promise<LinkCompletion> {
    if (!provider.getLinkSessionResult) {
      // A provider that cannot be asked relies on its webhook alone.
      return { status: "pending", linked: 0, inProgress: 0, exit: null };
    }
    const result = await provider.getLinkSessionResult(linkToken);
    let linked = 0;
    let inProgress = 0;
    let firstError: unknown = null;
    for (const token of result.publicTokens) {
      try {
        const r = await exchangeOnce(userId, token);
        if (r.state === "in-progress") inProgress++;
        else linked++;
      } catch (e) {
        firstError ??= e;
      }
    }
    if (firstError && linked === 0 && inProgress === 0) throw firstError;
    return { status: result.status, linked, inProgress, exit: result.exit };
  }

  /** A provider failure as an answer the phone can explain. */
  function providerFailure(c: Context, e: unknown, what: string) {
    if (!(e instanceof BankProviderError)) throw e;
    console.warn(`[bank] ${what} failed: ${e.message}`);
    const code =
      e.kind === "config"
        ? "provider_config"
        : e.kind === "unavailable"
          ? "provider_unavailable"
          : "provider_rejected";
    return c.json(
      {
        error: e.displayMessage ?? "The bank connection service could not complete the request.",
        code,
        providerCode: e.providerCode,
      },
      502
    );
  }

  // Webhook is unauthenticated (the provider calls it server-to-server); it is
  // registered before the auth guard so it is not blocked. Authenticity comes
  // from the provider's signature instead — without it anyone could POST a
  // "transactions changed" body and drive unbounded syncs against our quota and
  // our database.
  router.post("/webhook", async (c) => {
    if (!provider.isConfigured()) {
      // No credentials means no way to verify a signature, so nothing here could
      // be trusted anyway.
      return c.json({ error: "Bank linking is not configured on this server.", code: "not_configured" }, 503);
    }

    // Signatures cover the exact bytes, so hash the raw text — re-serialising
    // parsed JSON would not reproduce the same digest.
    const rawBody = await c.req.text();
    const verification = await provider.verifyWebhook((name) => c.req.header(name), rawBody);
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
      // Bound to whoever started the session; a link token we never issued
      // (or one long expired) exchanges nothing.
      const session = await findLinkSession(event.linkToken);
      if (!session) return c.json({ received: true });
      let retry = false;
      for (const token of event.publicTokens) {
        try {
          await exchangeOnce(session.userId, token);
        } catch (e) {
          console.warn("[bank:webhook] exchange failed:", e instanceof Error ? e.message : e);
          // A refusal will be refused again; an outage, ours or theirs, may not.
          retry ||=
            !(e instanceof LinkAlreadyFailedError) &&
            (!(e instanceof BankProviderError) || e.kind === "unavailable");
        }
      }
      // Failing the delivery makes the provider retry it, and a failed
      // exchange released its claim, so the retry can have it.
      if (retry) return c.json({ error: "Exchange failed; retry" }, 503);
      return c.json({ received: true });
    }

    if (event.kind === "transactions-changed") {
      const item = await prisma.plaidItem.findUnique({ where: { itemId: event.connectionExternalId } });
      if (item) {
        await syncConnectionTransactions(item.id, { provider: providerFor(item), cipher }).catch((e) =>
          console.warn("[bank:webhook] sync failed:", e instanceof Error ? e.message : e)
        );
      }
    }

    return c.json({ received: true });
  });

  // Where the hosted flow sends the browser when it ends. Unauthenticated —
  // the browser session carries no cookie of ours — so the unguessable state
  // in the path is what names the session, and the session names the user.
  router.get("/link/return/:state", async (c) => {
    const state = c.req.param("state");
    const ret = /^[A-Za-z0-9_-]{16,64}$/.test(state)
      ? await cacheGet<{ linkToken: string }>(returnStateKey(state))
      : null;
    const session = ret ? await findLinkSession(ret.linkToken) : null;
    if (!ret || !session) {
      return c.redirect(withQuery(DEFAULT_RETURN_URL, { result: "expired" }), 302);
    }

    // The exchange runs on without holding the browser: the app asks how it
    // went next, and polls until the bank appears. If the app never comes
    // back, the bank is linked all the same.
    runInBackground(
      finishLink(ret.linkToken, session.userId).catch((e) =>
        console.warn("[bank:return] finishing the link failed:", e instanceof Error ? e.message : e)
      )
    );
    return c.redirect(withQuery(session.returnUrl ?? DEFAULT_RETURN_URL, { result: "done" }), 302);
  });

  // Every route below needs a signed-in user.
  router.use("*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });

  // What this server can link, for the phone to decide what to offer. Open to
  // every signed-in user, Pro or not, configured or not; nothing secret.
  router.get("/config", (c) => {
    const configured = provider.isConfigured();
    const described = provider.describe?.() ?? { countries: [], environment: "unknown" };
    return c.json({
      configured,
      countries: configured ? described.countries : [],
      env: described.environment,
    });
  });

  // The rest needs a configured provider and Pro.
  router.use("*", async (c, next) => {
    const user = c.get("user")!;
    if (!provider.isConfigured()) {
      return c.json({ error: "Bank linking is not configured on this server.", code: "not_configured" }, 503);
    }

    // Bank sync is a paid feature, and every sync costs Plaid quota. The tier
    // comes from the database — a client asserting Pro gets nothing.
    if (!(await deps.isPro(user.id))) {
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

  const linkTokenSchema = z
    .object({
      /** The phone's region, ISO 3166-1 alpha-2. */
      region: z.string().trim().max(8).nullish(),
      /** The app's currency. */
      currency: z.string().trim().max(8).nullish(),
      /** The app's language. */
      language: z.string().trim().max(16).nullish(),
      /** Where the browser goes back into the app when the link ends. */
      returnUrl: z.string().trim().max(512).optional(),
    })
    .default({});

  router.post("/link-token", zValidator("json", linkTokenSchema), async (c) => {
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const returnUrl = body.returnUrl || DEFAULT_RETURN_URL;
    if (!isAllowedReturnUrl(returnUrl, deps.production)) {
      return c.json({ error: "That return address is not this app's.", code: "invalid_return_url" }, 400);
    }

    let currency = body.currency ?? null;
    if (!currency) {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
        select: { currency: true },
      });
      currency = settings?.currency ?? null;
    }

    const state = randomBytes(24).toString("base64url");
    let session;
    try {
      session = await provider.createLinkSession({
        userId: user.id,
        region: body.region ?? null,
        currency,
        language: body.language ?? null,
        webhookUrl: `${deps.backendUrl}/api/plaid/webhook`,
        completionRedirectUri: completionRedirectFor(deps.backendUrl, state, returnUrl),
      });
    } catch (e) {
      return providerFailure(c, e, "link-token");
    }

    // Remember which user owns this session, for every path that finishes it.
    await rememberLinkSession(session.linkToken, user.id, undefined, { returnUrl });
    await cacheSet(returnStateKey(state), { linkToken: session.linkToken }, LINK_SESSION_TTL_MS);
    return c.json({
      linkToken: session.linkToken,
      hostedLinkUrl: session.hostedUrl,
      expiration: session.expiresAt,
      returnUrl,
    });
  });

  const completeSchema = z.object({ linkToken: z.string().min(1).max(512) });

  // The app, back from the browser: how did it go? Exchanges what is not yet
  // exchanged, so a link finishes even when no webhook can reach this server.
  router.post("/link/complete", zValidator("json", completeSchema), async (c) => {
    const user = c.get("user")!;
    const { linkToken } = c.req.valid("json");
    const session = await findLinkSession(linkToken);
    // Another user's session is indistinguishable from none.
    if (!session || session.userId !== user.id) {
      return c.json({ error: "No such link session.", code: "link_session_not_found" }, 404);
    }
    try {
      return c.json(await finishLink(linkToken, user.id));
    } catch (e) {
      return providerFailure(c, e, "link completion");
    }
  });

  const exchangeSchema = z.object({
    linkToken: z.string().min(1).max(512),
    publicToken: z.string().min(1).max(512),
  });

  // For a client running the provider's own SDK, which hands it the public
  // token. The token must have come from a session this user started:
  // otherwise one user could attach a bank another user linked.
  router.post("/exchange", zValidator("json", exchangeSchema), async (c) => {
    const user = c.get("user")!;
    const { linkToken, publicToken } = c.req.valid("json");
    const session = await findLinkSession(linkToken);
    if (!session || session.userId !== user.id || !provider.getLinkSessionResult) {
      return c.json({ error: "No such link session.", code: "link_session_not_found" }, 404);
    }

    let r;
    try {
      const result = await provider.getLinkSessionResult(linkToken);
      if (!result.publicTokens.includes(publicToken)) {
        return c.json({ error: "That token is not from this link session.", code: "public_token_mismatch" }, 403);
      }
      r = await exchangeOnce(user.id, publicToken);
    } catch (e) {
      return providerFailure(c, e, "exchange");
    }
    if (!r.itemRowId) return c.json({ status: "pending" }, 202);

    const item = await prisma.plaidItem.findFirst({ where: { id: r.itemRowId, userId: user.id } });
    if (!item) return c.json({ status: "pending" }, 202);
    // Ordered explicitly: Postgres has no implicit row order. Ids are cuids,
    // which sort in creation order, i.e. the order the provider listed them.
    const accounts = await prisma.plaidAccount.findMany({
      where: { itemId: item.id },
      orderBy: { id: "asc" },
    });
    return c.json({ itemId: item.id, institutionName: item.institutionName, accounts });
  });

  router.get("/accounts", async (c) => {
    const user = c.get("user")!;
    const items = await prisma.plaidItem.findMany({
      where: { userId: user.id },
      include: { accounts: { orderBy: { id: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // The encrypted token never leaves the server, encrypted or not.
    return c.json({ items: items.map(({ accessTokenEnc: _token, cursor: _cursor, ...item }) => item) });
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
      return c.json({ error: "Not found", code: "not_found" }, 404);
    }

    await prisma.plaidAccount.update({ where: { plaidAccountId }, data: { isEnabled } });
    return c.json({ success: true });
  });

  router.post("/transactions/sync", async (c) => {
    const user = c.get("user")!;
    const items = await prisma.plaidItem.findMany({
      where: { userId: user.id, status: "active" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    let added = 0;
    const errors: string[] = [];
    const failed: { itemId: string; institutionName: string | null; code: string }[] = [];
    for (const item of items) {
      try {
        added += await syncConnectionTransactions(item.id, { provider: providerFor(item), cipher });
      } catch (e) {
        const code =
          e instanceof BankProviderError ? (e.providerCode ?? `provider_${e.kind}`) : "sync_failed";
        console.warn(`[bank] sync of ${item.id} failed: ${e instanceof Error ? e.message : e}`);
        failed.push({ itemId: item.id, institutionName: item.institutionName, code });
        errors.push(`${item.institutionName ?? item.itemId}: ${code}`);
      }
    }
    return c.json({ added, errors, failed });
  });

  const disconnectSchema = z.object({
    /** keep: the bank's accounts and transactions stay as ordinary data; delete: they go. */
    data: z.enum(["keep", "delete"]).optional(),
  });

  router.delete("/items/:id", zValidator("query", disconnectSchema), async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const keepData = c.req.valid("query").data !== "delete";
    const item = await prisma.plaidItem.findFirst({ where: { id, userId: user.id } });
    if (!item) return c.json({ error: "Not found", code: "not_found" }, 404);

    try {
      const removed = await removeConnection(item.id, { provider: providerFor(item), cipher, keepData });
      return c.json({ success: true, kept: keepData, removed });
    } catch (e) {
      // Not revoked, so nothing was deleted: the user can try again.
      return providerFailure(c, e, "disconnect");
    }
  });

  return router;
}

const router = createPlaidRouter({
  provider: getProvider(DEFAULT_PROVIDER_ID),
  isPro: (userId) => userIsPro(userId),
  backendUrl: env.BACKEND_URL.replace(/\/+$/, ""),
  production: env.NODE_ENV === "production",
});

export { router as plaidRouter };
