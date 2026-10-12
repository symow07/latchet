/**
 * Cloudflare Email Worker → Budget's forwarding webhook
 * (POST /api/v1/email/inbound). Setup: inbound-email-setup.md beside this file.
 *
 * Every message sent to *@<your inbound domain> (Email Routing's catch-all)
 * arrives here. The worker sends the raw message, untouched and
 * base64-encoded, to the backend, which reads it with the same MIME parser as
 * Gmail and Outlook mail. Nothing is decoded here.
 *
 * Never bounce a real user's mail because Budget is down or asleep.
 * Cloudflare documents `setReject` as a permanent SMTP rejection and offers no
 * way to answer "try again later"; an exception escaping this handler is
 * retried by Cloudflare a few times and then also reaches the sender as a
 * permanent failure. So an outage is handled here instead:
 *
 *   1. retry the backend with backoff (a sleeping Railway service wakes on
 *      the first request; a deploy takes seconds);
 *   2. still down: keep the message in Workers KV (binding PARKED, 7 days)
 *      and deliver it from the cron trigger (`scheduled`) once the backend is
 *      back;
 *   3. no KV bound: forward it to FALLBACK_FORWARD, a verified address you
 *      control, to resend later;
 *   4. neither configured: throw, and Cloudflare's own retries are all that
 *      is left.
 *
 * `setReject` is used only for mail to an address that is not ours: a local
 * part that is not u_<token>, or one the backend says no user has.
 *
 * Variables (Settings → Variables):
 *   BACKEND_URL       https://your-backend.up.railway.app (no trailing slash)
 *   INBOUND_SECRET    the backend's INBOUND_EMAIL_SECRET (encrypt it)
 *   INBOUND_DOMAIN    optional: your inbound domain; other domains are refused
 *   FALLBACK_FORWARD  optional: a verified destination address for step 3
 *   RETRY_DELAYS_MS   optional: the waits before each attempt, e.g. "0,2000,6000"
 * Bindings:
 *   PARKED            optional (recommended): a KV namespace, for step 2
 * Triggers:
 *   a cron, e.g. every 10 minutes, when PARKED is bound
 */

const DEFAULT_RETRY_DELAYS_MS = [0, 2000, 6000];
const ATTEMPT_TIMEOUT_MS = 20000;
/**
 * Larger messages are cut to this many bytes: the billing text comes first,
 * attachments last, and the backend reads PDFs only up to 2 MB anyway.
 */
const MAX_SEND_BYTES = 8 * 1024 * 1024;
const PARK_PREFIX = "parked:";
const PARK_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Parked messages tried per cron run. */
const REDELIVER_BATCH = 50;
const LOCAL_PART_RE = /^u_[a-z0-9]{4,64}$/;

export default {
  async email(message, env) {
    const to = String(message.to || "").trim().toLowerCase();
    const at = to.lastIndexOf("@");
    const local = at > 0 ? to.slice(0, at) : "";
    const domain = at > 0 ? to.slice(at + 1) : "";
    const ownDomain = String(env.INBOUND_DOMAIN || "").trim().toLowerCase();
    if (!LOCAL_PART_RE.test(local) || (ownDomain && domain !== ownDomain)) {
      message.setReject("Address does not exist");
      return;
    }

    const payload = JSON.stringify({ to, raw: toBase64(await readRaw(message)) });
    const result = await deliver(env, payload, retryDelays(env));
    if (result === "delivered") return;
    if (result === "unknown_recipient") {
      message.setReject("Address does not exist");
      return;
    }

    // Budget is down, asleep or misconfigured: keep the message, never bounce it.
    if (env.PARKED) {
      try {
        await env.PARKED.put(`${PARK_PREFIX}${Date.now()}:${crypto.randomUUID()}`, payload, {
          expirationTtl: PARK_TTL_SECONDS,
        });
        return;
      } catch (e) {
        console.error("budget-inbound: could not park the message", e && e.name);
      }
    }
    if (env.FALLBACK_FORWARD) {
      await message.forward(env.FALLBACK_FORWARD);
      return;
    }
    throw new Error("Budget backend unavailable and no PARKED or FALLBACK_FORWARD configured");
  },

  /** The cron trigger: deliver what was parked during an outage, oldest first. */
  async scheduled(_event, env) {
    await redeliverParked(env);
  },
};

/** The raw message, cut to MAX_SEND_BYTES. */
async function readRaw(message) {
  const bytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  return bytes.byteLength > MAX_SEND_BYTES ? bytes.subarray(0, MAX_SEND_BYTES) : bytes;
}

/**
 * Base64 with the fastest encoder the runtime has: the free plan allows 10 ms
 * of CPU per message. Uint8Array#toBase64 and Buffer (nodejs_compat) are
 * native; the btoa fallback is fine for ordinary billing mail.
 */
function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  if (typeof globalThis.Buffer === "function") return globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function retryDelays(env) {
  const custom = String(env.RETRY_DELAYS_MS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return custom.length ? custom : DEFAULT_RETRY_DELAYS_MS;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST the payload, one attempt per delay. "delivered" on any 2xx;
 * "unknown_recipient" only when the backend says so; "failed" otherwise —
 * a network error, a timeout, a 5xx or 429 (retried), or a configuration
 * problem such as a wrong secret (not retried; kept for later).
 */
async function deliver(env, payload, delays) {
  const url = `${String(env.BACKEND_URL || "").replace(/\/+$/, "")}/api/v1/email/inbound`;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Inbound-Secret": String(env.INBOUND_SECRET || "") },
        body: payload,
        signal: controller.signal,
      });
    } catch {
      continue; // down, asleep or unreachable: try again
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return "delivered";
    const body = await res.json().catch(() => null);
    if (res.status === 404 && body && body.error === "unknown_recipient") return "unknown_recipient";
    if (res.status === 429 || res.status >= 500) continue;
    return "failed";
  }
  return "failed";
}

/** Deliver parked messages; stop at the first that still fails (the backend is still down). */
async function redeliverParked(env) {
  if (!env.PARKED) return { delivered: 0, dropped: 0, remaining: true };
  const { keys } = await env.PARKED.list({ prefix: PARK_PREFIX, limit: REDELIVER_BATCH });
  let delivered = 0;
  let dropped = 0;
  for (const { name } of keys) {
    const payload = await env.PARKED.get(name);
    if (payload === null) continue;
    const result = await deliver(env, payload, [0]);
    if (result === "failed") return { delivered, dropped, remaining: true };
    // An address that no longer exists cannot be bounced from here: drop it.
    if (result === "delivered") delivered++;
    else dropped++;
    await env.PARKED.delete(name);
  }
  return { delivered, dropped, remaining: keys.length === REDELIVER_BATCH };
}
