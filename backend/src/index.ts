import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";
import { logger } from "hono/logger";
import { auth, loginRateLimiter, sharedAuthLimiter,
  signupBurstRateLimiter,
  signupDailyRateLimiter,
} from "./auth";
import { debugLog } from "./lib/log";
import { transactionsRouter } from "./routes/transactions";
import { accountsRouter } from "./routes/accounts";
import { settingsRouter } from "./routes/settings";
import { billRemindersRouter } from "./routes/bill-reminders";
import { recurringRouter } from "./routes/recurring";
import { netWorthRouter } from "./routes/net-worth";
import { categoryBudgetsRouter } from "./routes/category-budgets";
import { businessRouter } from "./routes/business";
import { householdRouter } from "./routes/household";
import { expensesRouter } from "./routes/expenses";
import { budgetRouter } from "./routes/budget";
import { payrollRouter } from "./routes/payroll";
import { startRecurringProcessor } from "./jobs/recurring-processor";
import { startBillReminderChecker } from "./jobs/bill-reminder-checker";
import { startRetentionJob } from "./jobs/retention";
import { startEmailSyncJob } from "./jobs/email-sync";
import { debugRouter } from "./routes/debug";
import { aiRouter } from "./routes/ai";
import { achievementsRouter } from "./routes/achievements";
import { pushTokensRouter } from "./routes/push-tokens";
import { plaidRouter } from "./routes/plaid";
import { ratesRouter } from "./routes/rates";
import { meRouter } from "./routes/me";
import { revenueCatRouter } from "./routes/revenuecat";
import { emailRouter, isPublicEmailPath } from "./routes/email";
import { createSiteRouter, isPublicSitePath } from "./routes/site";
import { syncRouter } from "./routes/sync";
import { installErrorHandlers } from "./lib/http-errors";
import { prisma } from "./prisma";
import { withLegacyAliases } from "./lib/legacy-aliases";

// Exported so tests can drive the whole pipeline in-process — CORS, the alias
// and session middleware, every mount and the error handlers — exactly as
// served. Importing this module starts no timers; see the bottom of the file.
export const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
    requestId: string;
  };
}>();

// CORS middleware. Local dev origins are always allowed; add your production
// web origins via the CORS_ORIGINS env var (comma-separated exact origins).
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
const extraOrigins = (env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (allowed.some((re) => re.test(origin))) return origin;
      if (extraOrigins.includes(origin)) return origin;
      return null;
    },
    credentials: true,
  })
);

app.use("*", logger());

// Older app builds read teamMembers/businessId where the API now sends
// members/groupId. Applied globally rather than per route: the rename touched
// several routers and the failure mode is a crash on the first screen, so
// missing one is worse than aliasing a payload that does not need it.
// Additive only — see lib/legacy-aliases.ts, including when to remove it.
app.use("*", async (c, next) => {
  await next();
  const body = c.res.headers.get("content-type");
  if (!body?.includes("application/json")) return;
  try {
    const parsed = await c.res.clone().json();
    c.res = new Response(JSON.stringify(withLegacyAliases(parsed)), {
      status: c.res.status,
      headers: c.res.headers,
    });
  } catch {
    // A body that is not parseable JSON is left exactly as it was.
  }
});

// Request-id tagging, Prisma/Zod error mapping and a JSON 404. Registered here
// so the id middleware runs ahead of every route.
installErrorHandlers(app, { isProduction: env.NODE_ENV === "production" });

// Auth middleware - populates user/session for protected routes.
// Skipped for /api/auth/* because BetterAuth's own handler resolves the session
// itself; calling auth.api.getSession() here is redundant DB work and consumes
// the 5s timeout budget that should be available to auth.handler.
// Skipped too for the email OAuth callback and the inbound-mail webhook, which
// never act on a session: the callback's user is named by its OAuth state, the
// webhook is the mail worker's (routes/email.ts). And for the public website,
// which is the same for everyone (routes/site.ts).
app.use("*", async (c, next) => {
  if (
    c.req.path.startsWith("/api/auth/") ||
    isPublicEmailPath(c.req.path) ||
    isPublicSitePath(c.req.path)
  ) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }

  const t0 = Date.now();
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await Promise.race([
      auth.api.getSession({ headers: c.req.raw.headers }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("getSession timeout after 10s")),
          10_000
        )
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[session-mw:error] ${c.req.method} ${c.req.path} in ${Date.now() - t0}ms: ${msg}`);
    session = null;
  }

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

// Auth routes (path-specific rate limiting) — both versioned and unversioned.
//
// sign-up and sign-in were once exempted from every limit, a stabilization
// measure from the signup-hang investigation that was never reverted. The
// hang's actual cause was body-cloning inside the limiters (see auth.ts) and
// is long gone — these limiters read headers only, and the limits per account
// run inside Better Auth, from its hooks. Each now has its own
// limit, on its path below, and the general one no longer counts them
// (auth.ts, sharedAuthLimiter): it used to refuse sign-in to a whole address.
app.use("/api/auth/sign-up/*", signupBurstRateLimiter);
app.use("/api/auth/sign-up/*", signupDailyRateLimiter);
app.use("/api/auth/sign-in/*", loginRateLimiter);
// Session reads have their own, wider limit; everything else shares the general one.
app.use("/api/auth/*", (c, next) => {
  const limiter = sharedAuthLimiter(c.req.method, c.req.path);
  return limiter ? limiter(c, next) : next();
});
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const t0 = Date.now();
  debugLog(`[auth-route:enter] ${c.req.method} ${c.req.path}`);
  // Headers-only probe. Never read or clone the body — that's the deadlock
  // that motivated commit e519527.
  const ct = c.req.header("content-type") ?? "";
  const cl = c.req.header("content-length") ?? "?";
  const ip = c.req.header("x-forwarded-for") ?? "unknown";
  debugLog(`[auth-route:headers] ct=${ct} cl=${cl} ip=${ip}`);
  try {
    const response = await Promise.race([
      auth.handler(c.req.raw),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("auth.handler timeout after 30s")),
          30_000
        )
      ),
    ]);
    debugLog(`[auth-route:done] ${c.req.method} ${c.req.path} in ${Date.now() - t0}ms status=${response.status}`);
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auth-route:error] ${c.req.method} ${c.req.path} in ${Date.now() - t0}ms: ${msg}`);
    return c.json({ error: "Request timed out or failed" }, 503);
  }
});

// Health check. Runs a real query: returning ok unconditionally meant Railway
// kept routing traffic to an instance whose database volume was unreachable,
// which is precisely the failure the healthcheck exists to catch.
app.get("/health", async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: "ok" });
  } catch (e) {
    console.error("[health] database unreachable:", e instanceof Error ? e.message : e);
    return c.json({ status: "error", error: "database unreachable" }, 503);
  }
});

// The public website: home, privacy policy, terms of service. Their URLs are on
// Google's OAuth Branding page and in the store listings (routes/site.ts).
app.route("/", createSiteRouter({ siteVerification: env.GOOGLE_SITE_VERIFICATION }));

// Diagnostic routes — never mounted in production (they expose internals from
// the signup-hang investigation). Set DEBUG_ROUTES=true to re-enable temporarily.
if (process.env.NODE_ENV !== "production" || process.env.DEBUG_ROUTES === "true") {
  app.route("/api/debug", debugRouter);
}

// Current user + account deletion (versioned + backward-compatible)
app.route("/api/v1/me", meRouter);
app.route("/api/me", meRouter);

// Versioned routes (v1) — canonical paths
app.route("/api/v1/transactions", transactionsRouter);
app.route("/api/v1/accounts", accountsRouter);
app.route("/api/v1/settings", settingsRouter);
app.route("/api/v1/bill-reminders", billRemindersRouter);
app.route("/api/v1/recurring", recurringRouter);
app.route("/api/v1/net-worth", netWorthRouter);
app.route("/api/v1/category-budgets", categoryBudgetsRouter);
app.route("/api/v1/business", businessRouter);
app.route("/api/v1/household", householdRouter);
app.route("/api/v1/expenses", expensesRouter);
app.route("/api/v1/business/budget", budgetRouter);
app.route("/api/v1/payroll", payrollRouter);
app.route("/api/v1/ai", aiRouter);
app.route("/api/v1/achievements", achievementsRouter);
app.route("/api/v1/push-tokens", pushTokensRouter);
app.route("/api/v1/plaid", plaidRouter);
app.route("/api/v1/rates", ratesRouter);
app.route("/api/v1/revenuecat", revenueCatRouter);
app.route("/api/v1/email", emailRouter);
app.route("/api/v1/sync", syncRouter);

// Backward-compatible unversioned routes (alias to v1)
app.route("/api/transactions", transactionsRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/bill-reminders", billRemindersRouter);
app.route("/api/recurring", recurringRouter);
app.route("/api/net-worth", netWorthRouter);
app.route("/api/category-budgets", categoryBudgetsRouter);
app.route("/api/business", businessRouter);
app.route("/api/household", householdRouter);
app.route("/api/expenses", expensesRouter);
app.route("/api/business/budget", budgetRouter);
app.route("/api/payroll", payrollRouter);
app.route("/api/ai", aiRouter);
app.route("/api/achievements", achievementsRouter);
app.route("/api/push-tokens", pushTokensRouter);
app.route("/api/plaid", plaidRouter);
app.route("/api/rates", ratesRouter);
app.route("/api/revenuecat", revenueCatRouter);
app.route("/api/email", emailRouter);
app.route("/api/sync", syncRouter);

// Background jobs run only in the served process (`bun run src/index.ts`,
// start:prod). A test that imports `app` must not start interval timers that
// write to the test database behind its back and keep the runner alive.
if (import.meta.main) {
  startRecurringProcessor();
  startBillReminderChecker();
  startRetentionJob();
  startEmailSyncJob();
}

const port = Number(process.env.PORT) || 3000;

/**
 * Seconds a request may go without a byte before Bun closes it. Bun's default
 * is 10, shorter than this server's own waits: an upstream call is allowed 15
 * (fetch-timeout.ts), the email AI 20, and deleting a linked bank's history a
 * 60-second transaction. At 10 the connection dropped while the work went on,
 * and the app reported a disconnect that had in fact happened as a failure.
 * Bun's maximum is 255.
 */
export const SERVER_IDLE_TIMEOUT_SECONDS = 120;

export default {
  port,
  fetch: app.fetch,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
};
