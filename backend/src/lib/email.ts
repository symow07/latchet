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
 *   4. neither, production  → throw, rather than silently drop the message.
 *
 * Nothing calls this yet. It used to be the one-time-code sender, and the code
 * flow is gone — sign-in is email and password and never sends mail — but
 * password reset and email verification both need a way to send, so the
 * transport stays and the OTP-specific parts went.
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

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const from = env.EMAIL_FROM ?? "Budget <onboarding@resend.dev>";
  let res: Response;

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
