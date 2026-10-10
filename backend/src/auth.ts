import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";
import { debugLog } from "./lib/log";
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

// Identifier extraction is intentionally body-free.
//
// Why: previously this did `c.req.raw.clone()` + `await cloned.json()` to get
// `email` / `phone` for per-identifier rate-limiting on POST /api/auth/*.
// On Bun under production load, tee-ing the request body via `clone()` and
// fully consuming one branch before the original is read by `auth.handler`
// can deadlock the original branch — the underlying socket stream stalls
// instead of completing. That manifests exactly as the observed bug:
// `auth.handler(c.req.raw)` awaits body parsing and never returns, no DB
// query issues, no hooks fire, request 503s at the 30s wrapper timeout.
//
// We can recover identifier-style limits later from query string or a
// header without touching the body. Per-IP limits (which still run below)
// already cover the same misuse vector for unauthenticated POSTs.
function extractIdentifier(c: Context): string | null {
  const fromQuery = c.req.query("email") || c.req.query("phone");
  if (fromQuery) return fromQuery;
  const fromHeader = c.req.header("x-rate-limit-identifier");
  if (fromHeader) return fromHeader;
  return null;
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
  /**
   * Namespace for this limiter's counters. Without it every limiter shared a
   * single record per IP, so whichever one fired first decided the window for
   * all of them and their budgets cancelled each other out. Lockouts are
   * namespaced too, so tripping the sign-up limit cannot lock a legitimate
   * user out of sign-in from the same (often NAT-shared) address.
   */
  scope: string;
  ipMax: number;
  ipWindowMs: number;
  identifierMax: number;
  identifierWindowMs: number;
  lockoutThreshold: number;
}) {
  return async (c: Context, next: Next) => {
    const ip = getIp(c);
    const identifier = extractIdentifier(c);
    const ipKey = `${opts.scope}:ip:${ip}`;
    const idKey = identifier ? `${opts.scope}:id:${identifier}` : null;

    // Check lockout (by identifier first, then IP)
    if (idKey && !checkLockout(idKey)) {
      return c.json({ error: "Account temporarily locked, try again later" }, 429);
    }
    if (!checkLockout(ipKey)) {
      return c.json({ error: "Too many requests, try again later" }, 429);
    }

    // Check IP rate limit
    if (!checkStore(ipStore, ipKey, opts.ipMax, opts.ipWindowMs)) {
      applyLockout(ipKey, ipStore, opts.lockoutThreshold);
      return c.json({ error: "Too many requests, try again later" }, 429);
    }

    // Check identifier rate limit
    if (idKey) {
      if (!checkStore(identifierStore, idKey, opts.identifierMax, opts.identifierWindowMs)) {
        applyLockout(idKey, identifierStore, opts.lockoutThreshold);
        return c.json({ error: "Too many requests for this account, try again later" }, 429);
      }
    }

    return next();
  };
}

// Pre-configured limiters for specific auth paths
export const loginRateLimiter = createRateLimiter({
  scope: "login",
  ipMax: 15,
  ipWindowMs: 10 * 60 * 1000,     // 10 min
  identifierMax: 5,
  identifierWindowMs: 10 * 60 * 1000,
  lockoutThreshold: 5,
});

export const generalAuthRateLimiter = createRateLimiter({
  scope: "general",
  ipMax: 30,
  ipWindowMs: 15 * 60 * 1000,     // 15 min
  identifierMax: 20,
  identifierWindowMs: 15 * 60 * 1000,
  lockoutThreshold: 20,
});

// Sign-up is the expensive one: each attempt creates an account and runs a
// 600,000-iteration password hash, and once email verification is wired it will
// also send mail through Resend — on our bill and our domain's reputation. Two
// windows, applied together — a short burst limit and a daily ceiling.
export const signupBurstRateLimiter = createRateLimiter({
  scope: "signup-burst",
  ipMax: 5,
  ipWindowMs: 60 * 60 * 1000,     // 1 hour
  identifierMax: 3,
  identifierWindowMs: 60 * 60 * 1000,
  lockoutThreshold: 5,
});

export const signupDailyRateLimiter = createRateLimiter({
  scope: "signup-daily",
  ipMax: 20,
  ipWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  identifierMax: 10,
  identifierWindowMs: 24 * 60 * 60 * 1000,
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
// PBKDF2-SHA256 is used instead.
//
// Iteration count is OWASP's current figure for PBKDF2-HMAC-SHA256. Measured
// at 32ms/hash on an M-series laptop; Railway's shared CPU is several times
// slower, which still leaves it far inside the 30s auth handler budget — the
// original scrypt problem was 10+ seconds, two orders of magnitude worse.
//
// The count is stored in the hash so it can be raised again later without
// invalidating anything: hashes written before this change have three
// colon-separated parts and are verified at the old 100k.
const PBKDF2_ITERATIONS = 600_000;
const LEGACY_PBKDF2_ITERATIONS = 100_000;

async function deriveKeyHex(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Split a stored hash into its parts, tolerating the pre-iteration format. */
export function parsePasswordHash(
  hash: string
): { iterations: number; saltHex: string; keyHex: string } | null {
  const parts = hash.split(":");
  if (parts[0] !== "pbkdf2") return null;

  if (parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations <= 0) return null;
    return { iterations, saltHex: parts[2]!, keyHex: parts[3]! };
  }
  if (parts.length === 3) {
    // Written before the iteration count was recorded.
    return {
      iterations: LEGACY_PBKDF2_ITERATIONS,
      saltHex: parts[1]!,
      keyHex: parts[2]!,
    };
  }
  return null;
}
async function hashPassword(password: string): Promise<string> {
  const t0 = Date.now();
  debugLog(`[hash:start] op=hash pwdLen=${password.length}`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
  const keyHex = await deriveKeyHex(password, salt, PBKDF2_ITERATIONS);
  debugLog(`[hash:done] op=hash ms=${Date.now() - t0}`);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${keyHex}`;
}

async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const t0 = Date.now();
  debugLog(`[hash:start] op=verify pwdLen=${password.length}`);
  const parsed = parsePasswordHash(hash);
  if (!parsed) {
    console.warn(`[hash:done] op=verify ms=${Date.now() - t0} match=false reason=bad-format`);
    return false;
  }
  const { iterations, saltHex, keyHex } = parsed;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  // Verify at whatever cost this hash was written with, so raising
  // PBKDF2_ITERATIONS never locks an existing user out.
  const derivedHex = await deriveKeyHex(password, salt, iterations);
  if (derivedHex.length !== keyHex.length) {
    console.warn(`[hash:done] op=verify ms=${Date.now() - t0} match=false reason=length-mismatch`);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++)
    diff |= derivedHex.charCodeAt(i) ^ keyHex.charCodeAt(i);
  const match = diff === 0;
  debugLog(`[hash:done] op=verify ms=${Date.now() - t0} match=${match}`);
  return match;
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
          debugLog(`[hook:user-create:before] email=${u.email}`);
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const s = session as { userId?: string };
          debugLog(`[hook:session-create:before] userId=${s.userId}`);
          return { data: session };
        },
      },
    },
    verification: {
      create: {
        before: async (verification) => {
          const v = verification as { identifier?: string };
          debugLog(`[hook:verification-create:before] identifier=${v.identifier}`);
          return { data: verification };
        },
      },
    },
  },
  // The mobile app's custom scheme + Expo dev + localhost are always trusted.
  // Add production web origins via TRUSTED_ORIGINS (comma-separated).
  trustedOrigins: [
    "realbudget://*/*",
    "exp://*/*",
    "http://localhost:*",
    "http://127.0.0.1:*",
    ...(env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ],
  plugins: [
    expo(),
    bearer(),
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
