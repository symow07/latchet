import { env } from "../env";

/**
 * Sends the login/verification OTP email. Provider-agnostic so the app isn't
 * tied to any single vendor:
 *
 *   1. RESEND_API_KEY set   → send via Resend (https://resend.com) — simplest.
 *   2. SMTP_SERVICE_URL set → POST { to, code, fromName, lang } to your own
 *                             webhook/relay (backward-compatible generic path).
 *   3. neither, non-prod    → log the code to the server console so you can test
 *                             signup locally without configuring email.
 *   4. neither, production  → throw (fail loudly rather than silently drop OTPs).
 */

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 5_000;

export async function sendOtpEmail(opts: {
  email: string;
  otp: string;
  type: string;
}): Promise<void> {
  const { email, otp } = opts;

  // 1. Resend
  if (env.RESEND_API_KEY) {
    await withTimeout(
      fetch(RESEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM ?? "Budget <onboarding@resend.dev>",
          to: [email],
          subject: `Your Budget verification code: ${otp}`,
          html: otpEmailHtml(otp),
        }),
      }),
      "resend"
    );
    return;
  }

  // 2. Generic webhook / relay
  const webhookUrl = env.SMTP_SERVICE_URL;
  if (webhookUrl) {
    await withTimeout(
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email, code: String(otp), fromName: "Budget", lang: "en" }),
      }),
      "smtp-webhook"
    );
    return;
  }

  // 3. Dev fallback — never in production.
  if (env.NODE_ENV !== "production") {
    console.warn(`[otp:dev] Email not configured. OTP for ${email} is: ${otp}`);
    return;
  }

  // 4. Production with no provider — fail loudly.
  throw new Error("No email provider configured (set RESEND_API_KEY or SMTP_SERVICE_URL)");
}

/** Enforce a hard timeout + non-2xx check on the provider call. */
async function withTimeout(p: Promise<Response>, label: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout`)), SEND_TIMEOUT_MS)
      ),
    ]);
    if (!res.ok) {
      console.error(`[otp:${label}] provider returned ${res.status}`);
      throw new Error("Failed to send verification code");
    }
  } finally {
    clearTimeout(timer);
  }
}

function otpEmailHtml(otp: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#1a1130">
      <h1 style="font-size:20px;margin:0 0 8px">Budget</h1>
      <p style="color:#555;margin:0 0 24px">Enter this code to verify your email:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;background:#f3ecff;border-radius:14px;padding:18px;text-align:center;color:#6d28d9">${otp}</div>
      <p style="color:#999;font-size:13px;margin:24px 0 0">This code expires in 5 minutes. If you didn't request it, you can ignore this email.</p>
    </div>`;
}
