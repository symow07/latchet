import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { hitWindow } from "../lib/distributed/counter";
import { secretsMatch } from "../lib/secrets";
import { decodeBase64Message, legacyPayloadToMime } from "../lib/inbound-email";
import type { AiExtractor } from "../lib/email-parse";
import { cappedAi } from "../lib/email-providers/ai-cap";
import { redirectUriFor, type EmailConfig } from "../lib/email-providers/config";
import { findingsPage } from "../lib/email-providers/findings";
import { latestConfirmationCode, receiveForwarded } from "../lib/email-providers/forwarding";
import type { ProviderHttp } from "../lib/email-providers/http";
import { MANUAL_SYNC_WINDOW_MS } from "../lib/email-providers/limits";
import {
  codeChallengeFor,
  DEFAULT_RETURN_URL,
  gmailCapFor,
  isAllowedReturnUrl,
  newCodeVerifier,
  newOAuthState,
  recordGrant,
  rememberConnect,
  takeConnect,
  withQuery,
} from "../lib/email-providers/oauth";
import { syncWhenFree, type SyncDeps } from "../lib/email-providers/sync";
import {
  ProviderError,
  type MailProvider,
  type ProviderName,
  type ProviderSet,
  type TokenCipher,
  type TokenGrant,
} from "../lib/email-providers/types";
import { emailServicesFromEnv, revokeConnection } from "../lib/email-providers";

/**
 * Email: reading the user's own mailbox for billing mail (Gmail and Outlook
 * over OAuth), and forwarding as the backup for every other provider.
 * I-EMAIL-API in .unlazy/phase6/PLAN.md.
 *
 *   GET    /connections                → the user's mailboxes and what each provider offers
 *   POST   /connect/:provider          → { authUrl } to open in a browser session
 *   GET    /oauth/:provider/callback   → (public) the provider's redirect; back to the app
 *   POST   /sync                       → sync every mailbox now (202)
 *   POST   /connections/:id/sync       → sync one (202), once a minute at most
 *   DELETE /connections/:id            → revoke at the provider, delete it and its findings
 *   GET    /findings?after=<ISO>       → findings stored since, for the phone's detector
 *   GET    /inbox-address              → the private forwarding address (created once)
 *   POST   /inbound                    → (public, shared secret) a forwarded message, raw
 *
 * The server reads mail; the phone detects (Decision 2). A finding holds the
 * extracted fields only; the message itself is never stored or logged.
 */

type Vars = {
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
};

export interface EmailRouteDeps {
  config: EmailConfig;
  providers: ProviderSet;
  /** HTTP to the providers (revocation works even for an unconfigured client). */
  http: ProviderHttp;
  cipher: TokenCipher;
  sync: SyncDeps;
  /** The AI fallback for forwarded mail (capped per user), or null. */
  aiFor?: (userId: string) => AiExtractor | null;
  /** Runs work that must not hold up a response; tests pass one they can await. */
  runInBackground?: (task: Promise<unknown>) => void;
  /** How long a requested sync waits for a running one to finish. */
  syncWaitMs?: number;
}

const PROVIDERS: readonly ProviderName[] = ["gmail", "outlook"];
const isProviderName = (p: string): p is ProviderName => (PROVIDERS as readonly string[]).includes(p);

/** Paths that must not go through the session middleware (index.ts): no session, ever. */
export function isPublicEmailPath(path: string): boolean {
  return /^\/api(?:\/v1)?\/email\/(?:oauth\/[^/]+\/callback|inbound)\/?$/.test(path);
}

/** Starts a connection per user per hour, at most: each leaves an OAuth state behind. */
const CONNECT_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
/** The worker sends the raw message base64-encoded; Cloudflare accepts up to 25 MiB. */
const INBOUND_MAX_BODY_BYTES = 36 * 1024 * 1024;

const connectSchema = z.object({ returnUrl: z.string().min(1).max(500) });
const findingsQuery = z.object({ after: z.string().max(64).optional() });
/**
 * What the worker posts: the raw message, base64-encoded. A worker deployed
 * before that format sent the decoded fields instead; those still work.
 */
const inboundSchema = z.object({
  to: z.string().min(1).max(1000),
  raw: z.string().min(1).optional(),
  from: z.string().max(2000).optional(),
  subject: z.string().max(2000).optional(),
  text: z.string().max(2_000_000).optional(),
  html: z.string().max(2_000_000).optional(),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const retryAfterSeconds = (resetAt: Date) => Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

export function createEmailRouter(deps: EmailRouteDeps) {
  const { config, providers, cipher } = deps;
  const runInBackground = deps.runInBackground ?? ((task: Promise<unknown>) => void task.catch(() => {}));
  const router = new Hono<Vars>();

  const startSync = (connectionId: string, accessToken: string | null = null) =>
    runInBackground(
      syncWhenFree(connectionId, deps.sync, { accessToken, waitMs: deps.syncWaitMs }).catch((e) =>
        console.warn(`[email-sync] connection ${connectionId}: could not start (${e instanceof ProviderError ? e.code : "error"})`)
      )
    );

  // ── OAuth callback (public: a top-level browser redirect; the state names the user) ──
  router.get("/oauth/:provider/callback", async (c) => {
    const param = c.req.param("provider");
    const name = isProviderName(param) ? param : null;
    const state = c.req.query("state") ?? "";
    const pending = state ? await takeConnect(state).catch(() => null) : null;
    const returnUrl = pending && isAllowedReturnUrl(pending.returnUrl, config.production) ? pending.returnUrl : DEFAULT_RETURN_URL;
    const back = (params: Record<string, string>) =>
      c.redirect(withQuery(returnUrl, { provider: name ?? "unknown", ...params }), 302);

    if (!name || !pending || pending.provider !== name) return back({ result: "error", reason: "invalid_state" });
    // Never echo the provider's error text: it goes into a URL the app may show.
    const providerError = c.req.query("error");
    if (providerError) return back(providerError === "access_denied" ? { result: "denied" } : { result: "error", reason: "provider_error" });
    const provider = providers[name];
    if (!provider) return back({ result: "error", reason: "not_configured" });
    const code = c.req.query("code");
    if (!code || code.length > 2048) return back({ result: "error", reason: "missing_code" });

    let grant: TokenGrant | null = null;
    let saved = false;
    try {
      grant = await provider.exchangeCode({ code, codeVerifier: pending.codeVerifier, redirectUri: redirectUriFor(config, name) });
      if (!provider.grantsMailRead(grant.scope)) throw new ProviderError("scope_denied");
      // Google counted this user the moment they granted Gmail access, whatever
      // happens next; so does our ledger.
      if (name === "gmail") await recordGrant("gmail", pending.userId);
      if (!grant.refreshToken) throw new ProviderError("no_refresh_token");
      const address = await provider.mailboxAddress(grant);
      const connectionId = await saveConnection(pending.userId, name, address, grant, cipher);
      saved = true;
      startSync(connectionId, grant.accessToken);
      return back({ result: "success" });
    } catch (e) {
      const reason = e instanceof ProviderError ? e.code : "server_error";
      console.warn(`[email:oauth] ${name} callback failed: ${reason}`);
      // A grant we will not keep is given back rather than left live at Google.
      if (!saved && grant?.refreshToken) await giveBack(provider, grant.refreshToken);
      return back({ result: "error", reason });
    }
  });

  // ── Forwarded mail (public; the worker's shared secret) ──
  // The secret is checked before the body is read: nobody else gets to make us parse 36 MB.
  router.use("/inbound", async (c, next) => {
    if (!config.inbound) return c.json({ error: "not_configured" }, 503);
    if (!secretsMatch(c.req.header("x-inbound-secret"), config.inbound.secret)) return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  router.use("/inbound", bodyLimit({ maxSize: INBOUND_MAX_BODY_BYTES, onError: (c) => c.json({ error: "too_large" }, 413) }));
  router.post(
    "/inbound",
    zValidator("json", inboundSchema),
    async (c) => {
      const body = c.req.valid("json");
      const raw =
        body.raw !== undefined
          ? decodeBase64Message(body.raw)
          : body.text !== undefined || body.html !== undefined
            ? legacyPayloadToMime({ from: body.from, subject: body.subject, text: body.text ?? body.html })
            : null;
      if (!raw) return c.json({ error: "invalid_payload" }, 400);
      let outcome;
      try {
        outcome = await receiveForwarded(body.to, raw, { aiFor: deps.aiFor });
      } catch (e) {
        // Ours, not the sender's: the worker retries and keeps the message.
        // Logged by code only; an error's text could carry what was being stored.
        console.error(`[email:inbound] failed (${e instanceof Prisma.PrismaClientKnownRequestError ? e.code : e instanceof Error ? e.name : "error"})`);
        return c.json({ error: "unavailable" }, 503);
      }
      // The worker refuses mail for an address that is not (or no longer) ours.
      if (outcome === "unknown_recipient") return c.json({ error: "unknown_recipient" }, 404);
      return c.json({ received: true });
    }
  );

  // ── Everything else needs a session ──
  router.use("*", async (c: Context<Vars>, next: Next) => {
    if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });

  router.get("/connections", async (c) => {
    const user = c.get("user")!;
    const [rows, cap] = await Promise.all([
      prisma.emailConnection.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, provider: true, email: true, inboundToken: true, forwardingVerified: true, status: true,
          syncState: true, lastSyncedAt: true, backfillDoneAt: true, messagesScanned: true, findingsCount: true,
          lastError: true,
        },
      }),
      gmailCapFor(user.id, config),
    ]);
    return c.json({
      connections: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        address:
          r.provider === "forwarding"
            ? r.inboundToken && config.inbound ? `u_${r.inboundToken}@${config.inbound.domain}` : ""
            : r.email,
        status: r.status,
        syncState: r.syncState,
        lastSyncedAt: iso(r.lastSyncedAt),
        backfillDoneAt: iso(r.backfillDoneAt),
        messagesScanned: r.messagesScanned,
        findingsCount: r.findingsCount,
        lastError: r.lastError,
        ...(r.provider === "forwarding" ? { forwardingVerified: r.forwardingVerified } : {}),
      })),
      providers: {
        gmail: { configured: !!providers.gmail, verified: config.gmailVerified, capReached: cap.capReached },
        outlook: { configured: !!providers.outlook },
        forwarding: { configured: !!config.inbound },
      },
    });
  });

  router.post("/connect/:provider", zValidator("json", connectSchema), async (c) => {
    const user = c.get("user")!;
    const param = c.req.param("provider");
    if (!isProviderName(param)) return c.json({ error: "unknown_provider" }, 404);
    const provider = providers[param];
    if (!provider) return c.json({ error: "not_configured" }, 503);
    const { returnUrl } = c.req.valid("json");
    if (!isAllowedReturnUrl(returnUrl, config.production)) return c.json({ error: "invalid_return_url" }, 400);
    if (param === "gmail" && (await gmailCapFor(user.id, config)).capReached) {
      return c.json({ error: "cap_reached" }, 409);
    }
    const hit = await hitWindow(`email-connect:${user.id}`, CONNECT_LIMIT, HOUR_MS);
    if (!hit.allowed) return c.json({ error: "rate_limited", retryAfter: retryAfterSeconds(hit.resetAt) }, 429);

    const state = newOAuthState();
    const codeVerifier = newCodeVerifier();
    await rememberConnect(state, { userId: user.id, provider: param, codeVerifier, returnUrl });
    const authUrl = provider.authorizeUrl({
      state,
      codeChallenge: codeChallengeFor(codeVerifier),
      redirectUri: redirectUriFor(config, param),
    });
    return c.json({ authUrl });
  });

  /** One manual sync per connection per minute, across instances. */
  const allowManualSync = (connectionId: string) => hitWindow(`email-sync:${connectionId}`, 1, MANUAL_SYNC_WINDOW_MS);

  router.post("/sync", async (c) => {
    const user = c.get("user")!;
    const conns = await prisma.emailConnection.findMany({
      where: { userId: user.id, provider: { in: [...PROVIDERS] }, status: { not: "needs_reauth" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, provider: true },
    });
    const syncable = conns.filter((cn) => isProviderName(cn.provider) && providers[cn.provider]);
    let started = 0;
    let soonest: Date | null = null;
    for (const conn of syncable) {
      const hit = await allowManualSync(conn.id);
      if (hit.allowed) {
        started++;
        startSync(conn.id);
      } else if (!soonest || hit.resetAt < soonest) {
        soonest = hit.resetAt;
      }
    }
    if (started === 0 && soonest) return c.json({ error: "rate_limited", retryAfter: retryAfterSeconds(soonest) }, 429);
    return c.json({ started }, 202);
  });

  router.post("/connections/:id/sync", async (c) => {
    const user = c.get("user")!;
    const conn = await prisma.emailConnection.findFirst({
      where: { id: c.req.param("id"), userId: user.id },
      select: { id: true, provider: true, status: true },
    });
    if (!conn) return c.json({ error: "not_found" }, 404);
    if (!isProviderName(conn.provider)) return c.json({ error: "not_syncable" }, 400);
    if (!providers[conn.provider]) return c.json({ error: "not_configured" }, 503);
    if (conn.status === "needs_reauth") return c.json({ error: "reauth_required" }, 409);
    const hit = await allowManualSync(conn.id);
    if (!hit.allowed) return c.json({ error: "rate_limited", retryAfter: retryAfterSeconds(hit.resetAt) }, 429);
    startSync(conn.id);
    return c.json({ started: 1 }, 202);
  });

  router.delete("/connections/:id", async (c) => {
    const user = c.get("user")!;
    const conn = await prisma.emailConnection.findFirst({
      where: { id: c.req.param("id"), userId: user.id },
      select: { id: true, provider: true, refreshTokenEnc: true },
    });
    if (!conn) return c.json({ error: "not_found" }, 404);
    // Revoke first, while the token still exists; the connection is deleted
    // either way (the user asked us to stop reading), and a grant we could not
    // revoke is named with the page where they can remove it.
    const revoke = await revokeConnection(conn, { http: deps.http, cipher });
    // Its findings go with it (InboxEmail.connectionId cascades).
    await prisma.emailConnection.deleteMany({ where: { id: conn.id, userId: user.id } });
    return c.json({ ok: true, revoked: revoke.revoked, ...(revoke.revoked ? {} : { manualRevokeUrl: revoke.manualRevokeUrl }) });
  });

  router.get("/findings", zValidator("query", findingsQuery), async (c) => {
    const user = c.get("user")!;
    const { after } = c.req.valid("query");
    let afterDate: Date | null = null;
    if (after) {
      const t = Date.parse(after);
      if (!Number.isFinite(t)) return c.json({ error: "invalid_after" }, 400);
      afterDate = new Date(t);
    }
    return c.json(await findingsPage(user.id, afterDate));
  });

  /** Provision (once) and return this user's private forwarding address. */
  router.get("/inbox-address", async (c) => {
    const user = c.get("user")!;
    if (!config.inbound) return c.json({ error: "not_configured" }, 503);
    let conn = await prisma.emailConnection.findFirst({
      where: { userId: user.id, inboundToken: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, inboundToken: true, forwardingVerified: true },
    });
    if (!conn) {
      try {
        conn = await prisma.emailConnection.create({
          data: {
            userId: user.id,
            provider: "forwarding",
            // A synthetic address: the [userId, email] unique key then stops a
            // second inbox being created if two first requests race.
            email: `forwarding:${user.id}`,
            inboundToken: randomBytes(9).toString("hex"),
          },
          select: { id: true, inboundToken: true, forwardingVerified: true },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        conn = await prisma.emailConnection.findFirstOrThrow({
          where: { userId: user.id, inboundToken: { not: null } },
          select: { id: true, inboundToken: true, forwardingVerified: true },
        });
      }
    }
    return c.json({
      address: `u_${conn.inboundToken}@${config.inbound.domain}`,
      verified: conn.forwardingVerified,
      // Gmail's code for confirming this address as a forwarding target.
      confirmationCode: await latestConfirmationCode(conn.id),
    });
  });

  return router;
}

/**
 * Store a granted mailbox: one row per user and address, the refresh token
 * encrypted. Reconnecting the same address replaces the token and clears a
 * needs_reauth; the sync resumes where it was.
 */
async function saveConnection(
  userId: string,
  provider: ProviderName,
  address: string,
  grant: TokenGrant,
  cipher: TokenCipher
): Promise<string> {
  const refreshTokenEnc = cipher.encrypt(grant.refreshToken!);
  const fresh = { refreshTokenEnc, scope: grant.scope, status: "active", lastError: null };
  const update = async () => {
    const existing = await prisma.emailConnection.findUniqueOrThrow({
      where: { userId_email: { userId, email: address } },
      select: { id: true, provider: true },
    });
    // The same address under another provider (a Microsoft account named by a
    // Gmail address): a different mailbox, so its reading starts over.
    const restart =
      existing.provider === provider
        ? {}
        : { provider, syncCursor: null, backfillCursor: null, backfillDoneAt: null, lastSyncedAt: null, syncState: "idle" };
    await prisma.emailConnection.update({ where: { id: existing.id }, data: { ...fresh, ...restart } });
    return existing.id;
  };
  const existing = await prisma.emailConnection.findUnique({
    where: { userId_email: { userId, email: address } },
    select: { id: true },
  });
  if (existing) return update();
  try {
    const created = await prisma.emailConnection.create({
      data: { userId, provider, email: address, ...fresh },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    // Two callbacks for the same mailbox at once: the other created it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return update();
    throw e;
  }
}

/** Best effort: revoke a grant we are not keeping. */
async function giveBack(provider: MailProvider, refreshToken: string): Promise<void> {
  await provider.revoke(refreshToken).catch(() => {});
}

const services = emailServicesFromEnv();
const router = createEmailRouter({
  config: services.config,
  providers: services.providers,
  http: services.http,
  cipher: services.cipher,
  sync: services.sync,
  aiFor: (userId) => cappedAi(userId, { apiKey: services.config.openAiKey }),
});

export { router as emailRouter };
