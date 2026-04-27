import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, bearer } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";
import type { Context, Next } from "hono";

// ── Rate limiter (per-IP + per-identifier, with lockout) ────────
interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const ipStore = new Map<string, RateLimitRecord>();
const identifierStore = new Map<string, RateLimitRecord>();
const lockoutStore = new Map<string, number>(); // key → lockout expiry timestamp

function getIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function extractIdentifier(c: Context): Promise<string | null> {
  try {
    const cloned = c.req.raw.clone();
    const body = await cloned.json();
    const b = body as Record<string, unknown>;
    return (b?.email as string) || (b?.phone as string) || null;
  } catch {
    return null;
  }
}

function checkStore(
  store: Map<string, RateLimitRecord>,
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const record = store.get(key);

  if (!record || now > record.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= max) return false;

  record.count++;
  return true;
}

function checkLockout(key: string): boolean {
  const expiry = lockoutStore.get(key);
  if (!expiry) return true;
  if (Date.now() > expiry) {
    lockoutStore.delete(key);
    return true;
  }
  return false;
}

function applyLockout(key: string, store: Map<string, RateLimitRecord>, threshold: number) {
  const record = store.get(key);
  if (record && record.count >= threshold) {
    lockoutStore.set(key, Date.now() + 15 * 60 * 1000); // 15-minute lockout
  }
}

export function createRateLimiter(opts: {
  ipMax: number;
  ipWindowMs: number;
  identifierMax: number;
  identifierWindowMs: number;
  lockoutThreshold: number;
}) {
  return async (c: Context, next: Next) => {
    const ip = getIp(c);
    const identifier = await extractIdentifier(c);

    // Check lockout (by identifier first, then IP)
    if (identifier && !checkLockout(`id:${identifier}`)) {
      return c.json({ error: "Account temporarily locked, try again later" }, 429);
    }
    if (!checkLockout(`ip:${ip}`)) {
      return c.json({ error: "Too many requests, try again later" }, 429);
    }

    // Check IP rate limit
    if (!checkStore(ipStore, ip, opts.ipMax, opts.ipWindowMs)) {
      applyLockout(`ip:${ip}`, ipStore, opts.lockoutThreshold);
      return c.json({ error: "Too many requests, try again later" }, 429);
    }

    // Check identifier rate limit
    if (identifier) {
      if (!checkStore(identifierStore, identifier, opts.identifierMax, opts.identifierWindowMs)) {
        applyLockout(`id:${identifier}`, identifierStore, opts.lockoutThreshold);
        return c.json({ error: "Too many requests for this account, try again later" }, 429);
      }
    }

    return next();
  };
}

// Pre-configured limiters for specific auth paths
export const loginRateLimiter = createRateLimiter({
  ipMax: 15,
  ipWindowMs: 10 * 60 * 1000,     // 10 min
  identifierMax: 5,
  identifierWindowMs: 10 * 60 * 1000,
  lockoutThreshold: 5,
});

export const otpRateLimiter = createRateLimiter({
  ipMax: 10,
  ipWindowMs: 5 * 60 * 1000,      // 5 min
  identifierMax: 3,
  identifierWindowMs: 5 * 60 * 1000,
  lockoutThreshold: 3,
});

export const generalAuthRateLimiter = createRateLimiter({
  ipMax: 30,
  ipWindowMs: 15 * 60 * 1000,     // 15 min
  identifierMax: 20,
  identifierWindowMs: 15 * 60 * 1000,
  lockoutThreshold: 20,
});

// Periodically purge expired entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of ipStore) if (now > val.resetAt) ipStore.delete(key);
  for (const [key, val] of identifierStore) if (now > val.resetAt) identifierStore.delete(key);
  for (const [key, expiry] of lockoutStore) if (now > expiry) lockoutStore.delete(key);
}, 60_000).unref();

// ── Password hashing (PBKDF2-SHA256) ────────────────────────────────────────
// BetterAuth's built-in scrypt uses N=16384,r=16 — 2× the standard r=8 —
// which takes 10+ seconds on Railway's shared CPU and hits every request timeout.
// PBKDF2-SHA256 at 100k iterations meets OWASP minimums and completes in ~100ms.
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const keyHex = Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return `pbkdf2:${saltHex}:${keyHex}`;
}

async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const parts = hash.split(":");
  if (parts[0] !== "pbkdf2" || parts.length !== 3) return false;
  const saltHex = parts[1]!;
  const keyHex = parts[2]!;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const derivedHex = Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  if (derivedHex.length !== keyHex.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++)
    diff |= derivedHex.charCodeAt(i) ^ keyHex.charCodeAt(i);
  return diff === 0;
}

// ── Auth configuration ──────────────────────────────────────────
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  emailAndPassword: {
    enabled: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
  },
  // Diagnostic-only: log the FIRST adapter call BetterAuth makes on each path.
  // The "auth.handler timeout" with no other logs means we can't tell whether
  // BetterAuth hung pre-DB (PBKDF2, validation, plugin chain) or mid-DB.
  // These `before` callbacks fire from the adapter — the moment one prints,
  // we know BetterAuth has reached a real DB op.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const u = user as { email?: string };
          console.log(`[hook:user-create:before] email=${u.email}`);
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const s = session as { userId?: string };
          console.log(`[hook:session-create:before] userId=${s.userId}`);
          return { data: session };
        },
      },
    },
    verification: {
      create: {
        before: async (verification) => {
          const v = verification as { identifier?: string };
          console.log(`[hook:verification-create:before] identifier=${v.identifier}`);
          return { data: verification };
        },
      },
    },
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
    bearer(),
    emailOTP({
      otpLength: 6,
      expiresIn: 300, // 5 minutes
      async sendVerificationOTP({ email, otp, type }) {
        const smtpUrl = env.SMTP_SERVICE_URL;
        console.log(`[otp:start] type=${type} email=${email}`);

        // Hard 5-second timeout — without this the fetch hangs forever when
        // the SMTP service is unreachable, freezing the entire signup request.
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          console.log(`[otp:timeout] AbortController fired for ${email}`);
          controller.abort();
        }, 5_000);

        let response: Response;
        try {
          console.log(`[otp:before-fetch] url=${smtpUrl} email=${email}`);
          response = await fetch(smtpUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: email,
              code: String(otp),
              fromName: "Real Budget",
              lang: "en",
            }),
            signal: controller.signal,
          });
          console.log(`[otp:after-fetch] status=${response.status} email=${email}`);
        } catch (err) {
          // AbortError means we hit the 5-second deadline; any other error is a
          // network-level failure (DNS, TCP reset, etc.). Log the reason so it's
          // debuggable, then surface a clean error to the caller — never hang.
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`[otp:catch] OTP send failed for ${email} (type=${type}): ${reason}`);
          throw new Error("Failed to send verification code");
        } finally {
          clearTimeout(timeout);
          console.log(`[otp:finally] cleanup done for ${email}`);
        }

        if (!response.ok) {
          // Never leak OTP value or upstream response details to the client,
          // but log status so on-call can triage without guessing.
          console.error(
            `[otp:http-error] status=${response.status} email=${email} type=${type}`
          );
          throw new Error("Failed to send verification code");
        }

        console.log(`[otp:success] OTP sent for ${email} type=${type}`);
      },
    }),
  ],
  advanced: {
    trustedProxyHeaders: true,
    // CSRF protection enabled (enforced via trustedOrigins above).
    // secure: true in production (HTTPS), false in local dev (plain HTTP).
    //   Browsers and React Native silently drop Secure cookies over plain HTTP,
    //   so the session token would never be stored and every getSession() would
    //   return null, creating a login → redirect → login loop.
    // partitioned: omitted — CHIPS is a cutting-edge browser spec and has no
    //   support in React Native / Expo's cookie handling layer.
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      httpOnly: true,
    },
  },
});
