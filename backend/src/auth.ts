import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";
import { debugLog } from "./lib/log";
import type { Context, Next } from "hono";
import { hitWindow, lockFor, lockedKeys } from "./lib/distributed/counter";
import { cacheGet, cacheSet } from "./lib/distributed/cache";
import type { Db } from "./lib/distributed/clock";
import { sendEmail, type EmailMessage } from "./lib/email";
import {
  APP_RESET_PASSWORD_URL,
  APP_VERIFY_EMAIL_URL,
  RESET_LINK_TTL_SECONDS,
  VERIFY_LINK_TTL_SECONDS,
  authEmailLocale,
  passwordResetEmail,
  pinAppCallback,
  verificationEmail,
  withAppCallback,
} from "./lib/auth-emails";

// ── Rate limiter (per-IP + per-identifier, with lockout) ────────
// Counters and lockouts live in Postgres (lib/distributed/counter.ts), shared
// by every instance. They were Maps in this process, so each instance kept its
// own copy of every limit — with two instances, five sign-in attempts per
// account became ten — and a restart cleared every lockout. They still read
// headers only, never the body, for the reason given on extractIdentifier.

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

/** How long a tripped account lockout lasts. */
const LOCKOUT_MS = 15 * 60 * 1000;

export function createRateLimiter(opts: {
  /**
   * Namespace for this limiter's counters. Without it every limiter shared a
   * single record per IP, so whichever one fired first decided the window for
   * all of them and their budgets cancelled each other out. Lockouts are
   * namespaced too, so tripping the sign-up limit cannot lock an account out
   * of sign-in.
   */
  scope: string;
  ipMax: number;
  ipWindowMs: number;
  identifierMax: number;
  identifierWindowMs: number;
  /**
   * Once an account's window count has reached this, a refused attempt locks
   * that account for LOCKOUT_MS, from every address. Absent, or above
   * identifierMax: the account is refused while over its window, never locked.
   *
   * Addresses are never locked. One address is often many people (a
   * carrier's NAT, an office, a VPN exit), and an address lockout shut sign-in
   * for all of them for 15 minutes once anyone there went over. The address
   * window already caps what one address can do, and reopens when it ends.
   */
  identifierLockoutThreshold?: number;
}, db: Db = prisma) {
  return async (c: Context, next: Next) => {
    const ip = getIp(c);
    const identifier = extractIdentifier(c);
    const ipKey = `${opts.scope}:ip:${ip}`;
    const idKey = identifier ? `${opts.scope}:id:${identifier}` : null;

    // A locked account is refused from any address.
    if (idKey && (await lockedKeys([idKey], db)).has(idKey)) {
      return c.json({ error: "Account temporarily locked, try again later" }, 429);
    }

    // The address's window: refused while over it, never locked (above).
    const byIp = await hitWindow(ipKey, opts.ipMax, opts.ipWindowMs, db);
    if (!byIp.allowed) {
      return c.json({ error: "Too many requests, try again later" }, 429);
    }

    // Check identifier rate limit. Not counted when the IP was refused.
    if (idKey) {
      const byId = await hitWindow(idKey, opts.identifierMax, opts.identifierWindowMs, db);
      if (!byId.allowed) {
        const threshold = opts.identifierLockoutThreshold;
        if (threshold !== undefined && byId.count >= threshold) await lockFor(idKey, LOCKOUT_MS, db);
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
  identifierLockoutThreshold: 5,
});

export const generalAuthRateLimiter = createRateLimiter({
  scope: "general",
  ipMax: 30,
  ipWindowMs: 15 * 60 * 1000,     // 15 min
  identifierMax: 20,
  identifierWindowMs: 15 * 60 * 1000,
  identifierLockoutThreshold: 20,
});

/**
 * Reading the session (GET /api/auth/get-session) is what the app does on every
 * launch and every return to the foreground. Counted with the rest of
 * /api/auth/* it shared 30 requests per address per 15 minutes, so a phone
 * opened often, or many phones behind one carrier or office address, ran out:
 * the refused read looked like "signed out" to the app, and past the lockout
 * threshold sign-in itself was locked for 15 minutes. Session reads get their
 * own, wide window. A read changes nothing, and returns nothing without a
 * valid session cookie.
 */
export const sessionRateLimiter = createRateLimiter({
  scope: "session",
  ipMax: 600,
  ipWindowMs: 15 * 60 * 1000,
  identifierMax: 600,
  identifierWindowMs: 15 * 60 * 1000,
});

/** A session read, which sessionRateLimiter counts instead of the general limit. */
export function isSessionRead(method: string, path: string): boolean {
  return method === "GET" && /^\/api\/auth\/get-session\/?$/.test(path);
}

/**
 * The limit index.ts applies to a request under /api/auth/*, besides the ones
 * it mounts on a path of their own: none for sign-in and sign-up, which have
 * those, the session limit for a session read, and the general one for the
 * rest.
 *
 * Sign-in was counted by the general limit too, so whatever used up an
 * address's general budget (password resets, verification mails, sign-outs)
 * refused sign-in to everyone at that address until the window ended. Its own
 * limit already counts every attempt, per address and per account.
 */
export function sharedAuthLimiter(method: string, path: string) {
  if (isSessionRead(method, path)) return sessionRateLimiter;
  if (/^\/api\/auth\/sign-(in|up)\//.test(path)) return null;
  return generalAuthRateLimiter;
}

// Sign-up is the expensive one: each attempt creates an account and runs a
// 600,000-iteration password hash, and sends a verification mail through
// Resend — on our bill and our domain's reputation. Two windows, applied
// together — a short burst limit and a daily ceiling.
export const signupBurstRateLimiter = createRateLimiter({
  scope: "signup-burst",
  ipMax: 5,
  ipWindowMs: 60 * 60 * 1000,     // 1 hour
  identifierMax: 3,
  identifierWindowMs: 60 * 60 * 1000,
});

export const signupDailyRateLimiter = createRateLimiter({
  scope: "signup-daily",
  ipMax: 20,
  ipWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  identifierMax: 10,
  identifierWindowMs: 24 * 60 * 60 * 1000,
});

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

// ── Reset and verification mail ─────────────────────────────────────────────
//
// Two rules, both about what a request may reveal or depend on:
//
//  - Mail never fails a request. A provider that is down, slow or missing
//    (production with no RESEND_API_KEY throws in sendEmail) must not fail
//    sign-up, and must not turn a reset request into an error.
//  - Mail never tells anyone whether an account exists. Better Auth answers a
//    reset request identically for known and unknown addresses; awaiting the
//    send would undo that through timing (a known address waits on the
//    provider) and through errors. So the send runs in the background: the
//    request has its answer before the provider is even contacted, and a
//    failure is logged, never thrown.
//
// Each account gets at most AUTH_MAIL_PER_HOUR of each kind, counted in
// Postgres like the limiters above. The per-IP limits do not stop someone
// spreading reset requests for one victim across many addresses; this does,
// and it does it silently — the answer is the same either way.
//
// The reset link always redirects into the app, whatever redirectTo the
// request named: that redirect carries the token, and the requester need not
// be the account's owner (pinAppCallback, lib/auth-emails.ts).

type AuthMailKind = "reset" | "verify";

const AUTH_MAIL_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

/** The slice of a Better Auth user the mail needs. */
interface MailUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface AuthMailDeps {
  send: (msg: EmailMessage) => Promise<void>;
  /** The account's saved UserSettings.locale, or null when it has no settings yet. */
  savedLocale: (userId: string) => Promise<string | null>;
  /** Counts one mail of this kind for this account; false once over the limit. */
  allow: (kind: AuthMailKind, userId: string) => Promise<boolean>;
}

const defaultMailDeps: AuthMailDeps = {
  send: sendEmail,
  savedLocale: async (userId) =>
    (await prisma.userSettings.findUnique({ where: { userId }, select: { locale: true } }))?.locale ?? null,
  allow: async (kind, userId) =>
    (await hitWindow(`auth-mail:${kind}:${userId}`, AUTH_MAIL_PER_HOUR, HOUR_MS)).allowed,
};

/**
 * Builds the senders Better Auth calls. Each returns at once, having started
 * the delivery in the background; the promise it returns never rejects.
 * Exported with injectable deps so auth-flows.test.ts can hold it to that
 * without a provider.
 */
export function createAuthMailer(deps: AuthMailDeps = defaultMailDeps) {
  async function deliver(kind: AuthMailKind, user: MailUser, url: string, acceptLanguage: string | null) {
    if (!(await deps.allow(kind, user.id))) {
      console.warn(`[auth-mail] ${kind} mail for user ${user.id} not sent: over ${AUTH_MAIL_PER_HOUR} an hour`);
      return;
    }
    const locale = authEmailLocale(await deps.savedLocale(user.id), acceptLanguage);
    const content =
      kind === "reset"
        ? passwordResetEmail({ name: user.name, url: pinAppCallback(url, APP_RESET_PASSWORD_URL), locale })
        : verificationEmail({ name: user.name, url: withAppCallback(url, APP_VERIFY_EMAIL_URL), locale });
    await deps.send({ to: user.email, ...content });
  }

  function inBackground(kind: AuthMailKind) {
    return (data: { user: MailUser; url: string }, request?: Request): Promise<void> => {
      // Read now: the request is finished by the time the delivery runs.
      const acceptLanguage = request?.headers.get("accept-language") ?? null;
      deliver(kind, data.user, data.url, acceptLanguage).catch((e) => {
        // No address and no link: the link is a live credential.
        console.error(`[auth-mail] ${kind} mail for user ${data.user.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      return Promise.resolve();
    };
  }

  return {
    sendResetPassword: inBackground("reset"),
    sendVerificationEmail: inBackground("verify"),
  };
}

const authMailer = createAuthMailer();

// ── Auth configuration ──────────────────────────────────────────

/** One of Better Auth's rate-limit records, as it reads and writes them. */
interface RateLimit {
  key: string;
  count: number;
  lastRequest: number;
}

/**
 * How long a Better Auth rate-limit record is kept. It compares lastRequest
 * against its own window (10 or 60 s) itself, so this only needs to outlast
 * the longest of those; the retention job purges what expires.
 */
const BETTER_AUTH_RATE_TTL_MS = 10 * 60 * 1000;

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  emailAndPassword: {
    enabled: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    // POST /request-password-reset { email, redirectTo } mails a link to
    // GET /reset-password/:token, which redirects to the app
    // (latchet://reset-password?token=…, or ?error=INVALID_TOKEN); the app
    // then POSTs /reset-password { newPassword, token }. The token is single
    // use. Every session of the account ends with the reset, so whoever held
    // the old password loses access along with it.
    sendResetPassword: authMailer.sendResetPassword,
    resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS,
    revokeSessionsOnPasswordReset: true,
    // Sign-in does not wait for verification (PLAN decision 2): requiring it
    // would lock out every existing account, none of which has verified, and
    // would change what sign-up returns. Verification is offered instead.
    requireEmailVerification: false,
  },
  // Offered, not required: a link at sign-up, and a resend in Settings
  // (POST /send-verification-email). GET /verify-email marks the address
  // verified and redirects to latchet://verify-email (or ?error=…).
  //
  // autoSignInAfterVerification stays off. The link is opened in a browser,
  // and with it on, the expo plugin copies the new session's cookie into the
  // latchet:// redirect — a session token handed to whichever app claims
  // the scheme. The app refreshes its own session on the landing instead.
  emailVerification: {
    sendVerificationEmail: authMailer.sendVerificationEmail,
    sendOnSignUp: true,
    expiresIn: VERIFY_LINK_TTL_SECONDS,
  },
  // Reset tokens are stored hashed, so a read of the Verification table (a
  // backup, a leaked dump, a debug log of the row) yields nothing that resets
  // a password. Better Auth still finds a token stored before this was set.
  verification: {
    storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } },
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
          // The kind only. An identifier can embed the token itself
          // ("reset-password:<token>"), and DEBUG_LOGS can be on in production.
          const v = verification as { identifier?: string };
          const kind = v.identifier?.includes(":") ? v.identifier.split(":")[0] : "opaque";
          debugLog(`[hook:verification-create:before] kind=${kind}`);
          return { data: verification };
        },
      },
    },
  },
  // The mobile app's custom scheme + Expo dev + localhost are always trusted.
  // Add production web origins via TRUSTED_ORIGINS (comma-separated).
  trustedOrigins: [
    "latchet://*/*",
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
  // Better Auth's own limiter (production only: three sign-in or sign-up
  // attempts per 10 s per address, 100 requests per 10 s elsewhere) keeps its
  // counts in a Map inside this process unless given storage. Shared storage
  // makes every instance see the same counts, like the limiters above. Its
  // read-then-write is not atomic, which is why the limiters above, not this
  // one, are the enforced budget; this stays as the short-burst layer it was.
  rateLimit: {
    customStorage: {
      get: (key) => cacheGet<RateLimit>(`better-auth-rate:${key}`),
      set: (key, value) => cacheSet(`better-auth-rate:${key}`, value, BETTER_AUTH_RATE_TTL_MS),
    },
  },
  advanced: {
    // Better Auth switches its origin and callback-URL checks off whenever
    // NODE_ENV is "test", which `bun test` sets — so no test could ever see a
    // reset link redirect somewhere untrusted. Pinned on, as it already is in
    // development and production, so auth-flows.test.ts runs the real checks.
    disableOriginCheck: false,
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
