import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";
import type { Context, Next } from "hono";

// ── Rate limiter (in-memory, per-IP) ────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // max attempts per window

export function authRateLimiter() {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || now > record.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }

    if (record.count >= RATE_LIMIT_MAX) {
      return c.json({ error: "Too many requests, try again later" }, 429);
    }

    record.count++;
    return next();
  };
}

// Periodically purge expired entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore) {
    if (now > val.resetAt) rateLimitStore.delete(key);
  }
}, 60_000).unref();

// ── Auth configuration ──────────────────────────────────────────
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [
    "vibecode://*/*",
    "exp://*/*",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://*.dev.vibecode.run",
    "https://*.vibecode.run",
    "https://*.vibecodeapp.com",
    "https://*.vibecode.dev",
    "https://vibecode.dev",
  ],
  plugins: [
    expo(),
    emailOTP({
      otpLength: 6,
      expiresIn: 300, // 5 minutes
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;

        const smtpUrl = env.SMTP_SERVICE_URL;
        const response = await fetch(smtpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            code: String(otp),
            fromName: "Real Budget",
            lang: "en",
          }),
        });
        if (!response.ok) {
          // Never leak OTP value or upstream response details
          throw new Error("Failed to send verification code");
        }
      },
    }),
  ],
  advanced: {
    trustedProxyHeaders: true,
    // CSRF protection enabled (enforced via trustedOrigins above)
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
      partitioned: true,
    },
  },
});
