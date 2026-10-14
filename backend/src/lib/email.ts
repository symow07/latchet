import { env } from "../env";
import { fetchWithTimeout } from "./fetch-timeout";

/**
 * Outgoing email. Provider-agnostic so the app isn't tied to one vendor:
 *
 *   1. RESEND_API_KEY set   → send via Resend (https://resend.com) — simplest.
 *   2. SMTP_SERVICE_URL set → POST { from, to, subject, html, text } to your own
 *                             relay.
 *   3. neither, non-prod    → log the message to the server console, so mail can
 *                             be exercised locally without configuring a provider.
 *                             The log carries the plain-text body, links included:
 *                             that is how a reset or verification link is followed
 *                             locally, and the black-box auth check reads it.
 *   4. neither, production  → throw, rather than silently drop the message.
 *
 * Mail to a reserved domain (example.com, *.test, *.invalid, …) is never handed
 * to a provider in any environment: nothing can receive it, and every attempt
 * is a bounce charged to the sending domain's reputation. Outside production it
 * is logged like case 3, so the test suite and the gate checks (which sign up
 * @example.test and @e2e.test accounts) never send real mail even on a machine
 * whose .env names a provider.
 *
 * Callers: password reset and email verification (auth.ts), which send in the
 * background and never let a failure here reach the request.
 *
 * The send goes through fetchWithTimeout. The previous version built its own
 * AbortController and never handed the signal to fetch, so its timeout raced
 * the request without ever cancelling it.
 */

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 5_000;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Mail clients that block HTML show this instead. */
  text: string;
}

/** Domains reserved by RFC 2606 and RFC 6761: no mail can ever be delivered there. */
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

/** True when the address's domain is reserved, so the message could never arrive. */
export function isUndeliverableAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return true;
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return true;
  const tld = domain.split(".").pop() ?? "";
  if (RESERVED_TLDS.includes(tld)) return true;
  return RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const from = env.EMAIL_FROM ?? "Latchet <onboarding@resend.dev>";
  let res: Response;

  if (isUndeliverableAddress(msg.to)) {
    if (env.NODE_ENV !== "production") {
      console.warn(`[mail:dev] Not sent: reserved domain. To ${msg.to}: ${msg.subject}\n${msg.text}`);
    } else {
      // Never the body in production: a reset link in a log is a live credential.
      console.warn("[mail] not sent: the recipient's domain is reserved and cannot receive mail");
    }
    return;
  }

  if (env.RESEND_API_KEY) {
    res = await fetchWithTimeout(RESEND_URL, {
      method: "POST",
      timeoutMs: SEND_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
  } else if (env.SMTP_SERVICE_URL) {
    res = await fetchWithTimeout(env.SMTP_SERVICE_URL, {
      method: "POST",
      timeoutMs: SEND_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
  } else if (env.NODE_ENV !== "production") {
    console.warn(`[mail:dev] Email not configured. To ${msg.to}: ${msg.subject}\n${msg.text}`);
    return;
  } else {
    throw new Error("No email provider configured (set RESEND_API_KEY or SMTP_SERVICE_URL)");
  }

  if (!res.ok) {
    console.error(`[mail] provider returned ${res.status}`);
    throw new Error("Failed to send email");
  }
}
