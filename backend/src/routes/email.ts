import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { env } from "../env";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import { allowUsage, allowUsageTiered } from "../lib/usage-limit";
import { parseInboundToken, isGmailForwardConfirm, extractConfirmationCode, sanitizeSubjectLabel, senderDomain } from "../lib/inbound-email";
import { GmailProvider } from "../lib/email-providers/gmail";
import type { RawEmail } from "../lib/email-providers/types";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { safeReturnUrl } from "../lib/return-url";
import { ExpiringMap, OAUTH_STATE_TTL_MS, autoSweep } from "../lib/expiring-map";
import { secretsMatch } from "../lib/secrets";

/**
 * Gmail-based subscription scanner.
 *
 * Flow (mirrors the OAuth + encrypted-secret pattern of routes/plaid.ts):
 *   1. GET    /auth-url   → app gets a Google consent URL; we remember the
 *                           requesting user (+ app return URL) keyed by `state`.
 *   2. GET    /callback   → Google redirects here with ?code&state; we exchange
 *                           the code, store the encrypted refresh token, then
 *                           redirect back into the app via its deep link.
 *   3. GET    /status     → is an inbox connected? which one? last scan?
 *   4. POST   /scan       → pull receipt emails, extract subscriptions via
 *                           OpenAI, return them (stateless; the app persists).
 *   5. DELETE /disconnect → revoke + remove the connection.
 *
 * All routes 503 until GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI
 * are configured. /scan additionally needs OPENAI_API_KEY.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_SCOPE = "openid email https://www.googleapis.com/auth/gmail.readonly";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const EXTRACT_MODEL = "gpt-4o-mini";

function googleConfigured(): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET && !!env.GOOGLE_REDIRECT_URI;
}

function inboundConfigured(): boolean {
  return !!env.INBOUND_EMAIL_DOMAIN && !!env.INBOUND_EMAIL_SECRET;
}

// Maps an OAuth `state` to the user who started the flow and the app deep link
// to return to. Process-local (single-instance) — same approach as Plaid's
// pendingLinkSessions. Entries expire: consumed on callback, swept otherwise,
// so an abandoned consent screen no longer leaks an entry for the process's
// lifetime.
const pendingEmailSessions = autoSweep(
  new ExpiringMap<string, { userId: string; returnUrl: string }>(OAUTH_STATE_TTL_MS)
);

/** Where the callback is allowed to send the browser back to. */
const DEFAULT_RETURN_URL = "realbudget://email-connected";

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// ── /callback is unauthenticated (top-level browser redirect from Google). It
// resolves the user via the `state` map, so it must be registered BEFORE the
// auth guard below. ────────────────────────────────────────────────────────
router.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const pending = state ? pendingEmailSessions.get(state) : undefined;
  // Already validated when the flow started, but re-check on the way out:
  // this value ends up in a redirect carrying the user's email address.
  const returnUrl = safeReturnUrl(pending?.returnUrl, DEFAULT_RETURN_URL);

  const fail = (reason: string) => c.redirect(`${returnUrl}?status=error&reason=${encodeURIComponent(reason)}`);

  if (!googleConfigured()) return fail("not_configured");
  if (!code || !pending) return fail("invalid_state");
  if (state) pendingEmailSessions.delete(state);

  try {
    // Exchange the authorization code for tokens.
    const tokenRes = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as {
      refresh_token?: string;
      access_token?: string;
      id_token?: string;
    };
    if (!tokenRes.ok || !tokens.refresh_token) {
      // No refresh_token usually means the user previously consented without
      // prompt=consent; we force prompt=consent in /auth-url to avoid this.
      console.error("[email:callback] token exchange:", JSON.stringify(tokens).slice(0, 200));
      return fail("token_exchange_failed");
    }

    // Resolve the connected inbox address from the id_token, falling back to the
    // userinfo endpoint.
    let email = decodeIdTokenEmail(tokens.id_token);
    if (!email && tokens.access_token) {
      const infoRes = await fetchWithTimeout("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (infoRes.ok) email = ((await infoRes.json()) as { email?: string }).email ?? "";
    }
    if (!email) return fail("no_email");

    await prisma.emailConnection.upsert({
      where: { userId_email: { userId: pending.userId, email } },
      create: {
        userId: pending.userId,
        email,
        provider: "gmail",
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
      },
      update: {
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        status: "active",
      },
    });

    return c.redirect(`${returnUrl}?status=success&email=${encodeURIComponent(email)}`);
  } catch (e) {
    console.error("[email:callback]", e instanceof Error ? e.message : e);
    return fail("server_error");
  }
});

// ── Inbound email webhook (unauthenticated; shared-secret guarded). The user's
// email provider forwards billing emails to u_<token>@INBOUND_EMAIL_DOMAIN; an
// inbound provider (Cloudflare Email Worker / SendGrid / Mailgun) POSTs them
// here as JSON { to, from, subject, text }. Registered before the auth guard. ─
router.post("/inbound", async (c) => {
  if (!inboundConfigured()) return c.json({ error: "not configured" }, 503);
  if (!secretsMatch(c.req.header("x-inbound-secret"), env.INBOUND_EMAIL_SECRET)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = String(body.to ?? "");
  const from = String(body.from ?? "");
  const subject = String(body.subject ?? "");
  const text = String(body.text ?? body.bodyText ?? body.html ?? "");

  // Route to the owning user via the token in the recipient address.
  const token = parseInboundToken(to);
  if (!token) return c.json({ received: true }); // unroutable — ack to stop retries
  const conn = await prisma.emailConnection.findUnique({ where: { inboundToken: token } });
  if (!conn) return c.json({ received: true });

  // Gmail's forwarding-confirmation email → capture the numeric code for the app
  // to display (the user enters it back in Gmail's settings to finish setup).
  if (isGmailForwardConfirm(from, subject)) {
    const code = extractConfirmationCode(subject, text);
    await prisma.inboxEmail.create({
      data: {
        userId: conn.userId,
        senderDomain: senderDomain(from),
        label: sanitizeSubjectLabel(subject),
        merchant: code,
        status: "confirmation",
        isSubscription: false,
      },
    });
    return c.json({ received: true });
  }

  // A real forwarded email confirms the pipeline works.
  await prisma.emailConnection.update({
    where: { id: conn.id },
    data: { forwardingVerified: true, lastScanAt: new Date() },
  });

  // Spend cap: at most 60 OpenAI parses per user per day (a mail-bomb of
  // forwards should not become an OpenAI bill). Over-cap emails are still
  // stored, just unparsed — a later /scan can pick them up.
  const mayParse = env.OPENAI_API_KEY && allowUsage("inbound-parse", conn.userId, 60, 24 * 60 * 60 * 1000);
  const parsed = mayParse ? await parseInboundEmail(subject, from, text).catch(() => null) : null;
  await prisma.inboxEmail.create({
    data: {
      userId: conn.userId,
      // The raw sender and subject are deliberately not stored — only the
      // sender's domain and a digit-stripped label. See lib/inbound-email.
      senderDomain: senderDomain(from),
      label: sanitizeSubjectLabel(subject),
      merchant: parsed?.merchant ?? null,
      amount: parsed?.amount ?? null,
      currency: parsed?.currency ?? "USD",
      cadence: parsed?.cadence ?? "unknown",
      chargedISO: parsed?.lastChargedISO ?? null,
      isSubscription: parsed?.isSubscription ?? false,
      status: "parsed",
    },
  });
  return c.json({ received: true });
});

// ── Auth guard for the remaining user-facing routes. (Google-specific routes
// add their own 503 below; forwarding routes only need INBOUND_* config.) ────
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

router.get("/auth-url", async (c) => {
  if (!googleConfigured()) return c.json({ error: "Gmail connect is not configured on this server." }, 503);
  const user = c.get("user")!;
  // Attacker-supplied: without an allowlist, the callback would redirect to
  // any host with ?email=<the user's address> attached.
  const returnUrl = safeReturnUrl(c.req.query("returnUrl"), DEFAULT_RETURN_URL);
  const state = randomBytes(16).toString("hex");
  pendingEmailSessions.set(state, { userId: user.id, returnUrl });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-consent
    include_granted_scopes: "true",
    state,
  });
  return c.json({ authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

router.get("/status", async (c) => {
  const user = c.get("user")!;
  const oauth = await prisma.emailConnection.findFirst({
    where: { userId: user.id, provider: "gmail", status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  const fwd = await prisma.emailConnection.findFirst({
    where: { userId: user.id, inboundToken: { not: null } },
  });
  const inboxCount = await prisma.inboxEmail.count({
    where: { userId: user.id, status: "parsed", isSubscription: true },
  });
  return c.json({
    connected: !!oauth,
    email: oauth?.email ?? null,
    lastScanAt: oauth?.lastScanAt ?? null,
    forwarding:
      fwd && env.INBOUND_EMAIL_DOMAIN
        ? { address: `u_${fwd.inboundToken}@${env.INBOUND_EMAIL_DOMAIN}`, verified: fwd.forwardingVerified }
        : null,
    inboxConfigured: inboundConfigured(),
    inboxCount,
  });
});

// ── Forward-to-inbox endpoints (authed) ──────────────────────────────────────

/** Provision (once) and return this user's private inbound forwarding address. */
router.get("/inbox-address", async (c) => {
  const user = c.get("user")!;
  if (!inboundConfigured()) {
    return c.json({ error: "Email forwarding is not configured on this server." }, 503);
  }
  let conn = await prisma.emailConnection.findFirst({
    where: { userId: user.id, inboundToken: { not: null } },
  });
  if (!conn) {
    conn = await prisma.emailConnection.create({
      data: {
        userId: user.id,
        provider: "forwarding",
        // synthetic value keeps the [userId,email] unique key from colliding with
        // any OAuth gmail connection the user may also have.
        email: `forwarding:${user.id}`,
        inboundToken: randomBytes(9).toString("hex"),
      },
    });
  }
  return c.json({
    address: `u_${conn.inboundToken}@${env.INBOUND_EMAIL_DOMAIN}`,
    verified: conn.forwardingVerified,
  });
});

/** List parsed inbox items (most recent first). */
router.get("/inbox", async (c) => {
  const user = c.get("user")!;
  const items = await prisma.inboxEmail.findMany({
    where: { userId: user.id },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });
  return c.json({ items });
});

/** Mark inbox items as imported so the app doesn't re-add them. */
router.post("/inbox/imported", async (c) => {
  const user = c.get("user")!;
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
  if (ids.length > 0) {
    await prisma.inboxEmail.updateMany({
      where: { userId: user.id, id: { in: ids } },
      data: { status: "imported" },
    });
  }
  return c.json({ success: true });
});

router.post("/scan", async (c) => {
  const user = c.get("user")!;
  if (!googleConfigured()) return c.json({ error: "Gmail connect is not configured on this server." }, 503);
  if (!env.OPENAI_API_KEY) {
    return c.json({ error: "AI extraction is not configured on this server." }, 503);
  }
  // Each scan is a Gmail sweep + one large OpenAI call — cap it.
  if (!allowUsageTiered("email-scan", user.id, { burstMax: 3, burstWindowMs: 5 * 60_000, dailyMax: 12 })) {
    return c.json({ error: "Scan limit reached. Please try again later." }, 429);
  }
  const conn = await prisma.emailConnection.findFirst({
    where: { userId: user.id, provider: "gmail", status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn || !conn.refreshTokenEnc) return c.json({ error: "No connected inbox." }, 400);

  try {
    const provider = new GmailProvider();
    const emails = await provider.listSubscriptionMessages(decryptSecret(conn.refreshTokenEnc));
    const subscriptions = await extractSubscriptions(emails);

    await prisma.emailConnection.update({
      where: { id: conn.id },
      data: { lastScanAt: new Date() },
    });

    return c.json({ subscriptions, scanned: emails.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email:scan]", msg);
    // A failed token refresh almost always means the user revoked access.
    if (msg.includes("token refresh")) {
      await prisma.emailConnection.update({ where: { id: conn.id }, data: { status: "revoked" } }).catch(() => {});
      return c.json({ error: "Email access expired. Please reconnect." }, 401);
    }
    return c.json({ error: "Email scan failed" }, 502);
  }
});

router.delete("/disconnect", async (c) => {
  const user = c.get("user")!;
  // Only disconnect OAuth (gmail) connections; leave the forwarding inbox intact.
  const conns = await prisma.emailConnection.findMany({ where: { userId: user.id, provider: "gmail", status: "active" } });
  for (const conn of conns) {
    if (conn.refreshTokenEnc) {
      try {
        await fetchWithTimeout(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(decryptSecret(conn.refreshTokenEnc))}`, { method: "POST" });
      } catch {
        /* best-effort revoke; still remove locally */
      }
    }
    await prisma.emailConnection.update({ where: { id: conn.id }, data: { status: "revoked" } });
  }
  return c.json({ success: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface DetectedEmailSubscription {
  merchant: string;
  amount: number;
  currency: string;
  cadence: "weekly" | "monthly" | "yearly" | "unknown";
  lastChargedISO: string | null;
}

/** Decode the `email` claim from a Google id_token (no signature check needed —
 *  the token came straight from Google's token endpoint over TLS). */
function decodeIdTokenEmail(idToken?: string): string {
  if (!idToken) return "";
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return "";
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.email === "string" ? json.email : "";
  } catch {
    return "";
  }
}

/** Ask OpenAI to turn raw receipt emails into a de-duplicated subscription list. */
async function extractSubscriptions(emails: RawEmail[]): Promise<DetectedEmailSubscription[]> {
  if (emails.length === 0) return [];

  const compact = emails.map((e) => ({ from: e.from, subject: e.subject, date: e.date, snippet: e.snippet }));

  const system =
    "You analyze receipt/billing emails and identify RECURRING subscriptions (not one-off purchases). " +
    "Return ONLY compact JSON: " +
    '{"subscriptions":[{"merchant":string,"amount":number,"currency":string,"cadence":"weekly"|"monthly"|"yearly"|"unknown","lastChargedISO":string|null}]}. ' +
    "Rules: merchant is the clean brand name (e.g. \"Netflix\", not the email address). " +
    "amount is the recurring charge as a number (0 if unknown). currency is a 3-letter code (default \"USD\"). " +
    "lastChargedISO is the most recent charge date as YYYY-MM-DD or null. " +
    "De-duplicate by merchant (one entry per service, keep the most recent/representative charge). " +
    "Exclude obvious one-time purchases (e.g. a single Amazon order) unless clearly a membership/subscription. No prose, no markdown.";

  const res = await fetchWithTimeout(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(compact).slice(0, 18000) },
      ],
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data?.choices?.[0]?.message?.content ?? "{}";

  let parsed: { subscriptions?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];

  const cadences = new Set(["weekly", "monthly", "yearly", "unknown"]);
  return list
    .map((s): DetectedEmailSubscription | null => {
      const item = s as Record<string, unknown>;
      const merchant = typeof item.merchant === "string" ? item.merchant.trim() : "";
      if (!merchant) return null;
      const cadence = cadences.has(item.cadence as string) ? (item.cadence as DetectedEmailSubscription["cadence"]) : "unknown";
      return {
        merchant,
        amount: Number(item.amount) || 0,
        currency: typeof item.currency === "string" && item.currency.length === 3 ? item.currency.toUpperCase() : "USD",
        cadence,
        lastChargedISO: typeof item.lastChargedISO === "string" ? item.lastChargedISO : null,
      };
    })
    .filter((s): s is DetectedEmailSubscription => s !== null);
}

interface ParsedInbound extends DetectedEmailSubscription {
  isSubscription: boolean;
}

/** Parse a single forwarded billing email into a subscription summary via OpenAI. */
async function parseInboundEmail(subject: string, from: string, text: string): Promise<ParsedInbound | null> {
  const system =
    "You are given ONE billing/receipt email (sender, subject, body). Decide if it represents a RECURRING " +
    "subscription charge (not a one-off purchase). Reply ONLY with compact JSON " +
    '{"isSubscription":boolean,"merchant":string,"amount":number,"currency":string,"cadence":"weekly"|"monthly"|"yearly"|"unknown","lastChargedISO":string|null}. ' +
    'merchant = clean brand name. amount = charge as a number (0 if unknown). currency = 3-letter code (default "USD"). ' +
    "lastChargedISO = the charge date as YYYY-MM-DD or null. No prose, no markdown.";

  const res = await fetchWithTimeout(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `From: ${from}\nSubject: ${subject}\n\n${text}`.slice(0, 12000) },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data?.choices?.[0]?.message?.content ?? "{}";

  let p: Record<string, unknown>;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  const merchant = typeof p.merchant === "string" ? p.merchant.trim() : "";
  if (!merchant) return null;
  const cadences = new Set(["weekly", "monthly", "yearly", "unknown"]);
  return {
    isSubscription: !!p.isSubscription,
    merchant,
    amount: Number(p.amount) || 0,
    currency: typeof p.currency === "string" && p.currency.length === 3 ? p.currency.toUpperCase() : "USD",
    cadence: cadences.has(p.cadence as string) ? (p.cadence as DetectedEmailSubscription["cadence"]) : "unknown",
    lastChargedISO: typeof p.lastChargedISO === "string" ? p.lastChargedISO : null,
  };
}

export { router as emailRouter };
