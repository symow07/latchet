import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { env } from "../env";
import { allowUsage } from "../lib/usage-limit";
import { parseInboundToken, isGmailForwardConfirm, extractConfirmationCode, sanitizeSubjectLabel, senderDomain } from "../lib/inbound-email";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { secretsMatch } from "../lib/secrets";

/**
 * Email forwarding: the user forwards billing emails to a private address,
 * u_<token>@INBOUND_EMAIL_DOMAIN, and they become subscription candidates.
 *
 *   POST   /inbound        → the inbound provider delivers a forwarded email
 *                            (shared-secret guarded; no session).
 *   GET    /status         → is forwarding set up and verified? how many items?
 *   GET    /inbox-address  → provision (once) and return the private address.
 *   GET    /inbox          → parsed inbox items, most recent first.
 *   POST   /inbox/imported → mark items imported so the app doesn't re-add them.
 *
 * The forwarding routes 503 until INBOUND_EMAIL_DOMAIN / INBOUND_EMAIL_SECRET
 * are configured; parsing additionally needs OPENAI_API_KEY.
 *
 * There used to be a second path here, a Gmail OAuth scanner. Nothing in the
 * app ever called it, and it was removed along with its encrypted tokens.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const EXTRACT_MODEL = "gpt-4o-mini";

function inboundConfigured(): boolean {
  return !!env.INBOUND_EMAIL_DOMAIN && !!env.INBOUND_EMAIL_SECRET;
}

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

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
    data: { forwardingVerified: true },
  });

  // Spend cap: at most 60 OpenAI parses per user per day (a mail-bomb of
  // forwards should not become an OpenAI bill). Over-cap emails are still
  // stored, just unparsed.
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

// ── Auth guard for the remaining user-facing routes. ─────────────────────────
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

router.get("/status", async (c) => {
  const user = c.get("user")!;
  const fwd = await prisma.emailConnection.findFirst({
    where: { userId: user.id, inboundToken: { not: null } },
  });
  const inboxCount = await prisma.inboxEmail.count({
    where: { userId: user.id, status: "parsed", isSubscription: true },
  });
  return c.json({
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
        // A synthetic address: the [userId, email] unique key then guards against a
        // second inbox being created if two first requests race.
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

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface DetectedEmailSubscription {
  merchant: string;
  amount: number;
  currency: string;
  cadence: "weekly" | "monthly" | "yearly" | "unknown";
  lastChargedISO: string | null;
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
