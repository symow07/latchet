import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { logger } from "hono/logger";
import { auth, loginRateLimiter, otpRateLimiter, generalAuthRateLimiter } from "./auth";
import { transactionsRouter } from "./routes/transactions";
import { accountsRouter } from "./routes/accounts";
import { settingsRouter } from "./routes/settings";
import { billRemindersRouter } from "./routes/bill-reminders";
import { recurringRouter } from "./routes/recurring";
import { netWorthRouter } from "./routes/net-worth";
import { categoryBudgetsRouter } from "./routes/category-budgets";
import { sampleRouter } from "./routes/sample";
import { businessRouter } from "./routes/business";
import { expensesRouter } from "./routes/expenses";
import { budgetRouter } from "./routes/budget";
import { payrollRouter } from "./routes/payroll";
import { startRecurringProcessor } from "./jobs/recurring-processor";
import { startBillReminderChecker } from "./jobs/bill-reminder-checker";
import { debugRouter } from "./routes/debug";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// CORS middleware
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  })
);

app.use("*", logger());

// Auth middleware - populates user/session for all routes.
// getSession is wrapped with a 5-second timeout: if the DB hangs (e.g. SQLite
// lock on Railway) we skip setting user/session and continue rather than
// freezing every request indefinitely.
app.use("*", async (c, next) => {
  const isAuthPath = c.req.path.startsWith("/api/auth/");
  if (isAuthPath) {
    console.log(`[session-mw:start] ${c.req.method} ${c.req.path}`);
  }
  const t0 = Date.now();

  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await Promise.race([
      auth.api.getSession({ headers: c.req.raw.headers }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("getSession timeout after 5s")),
          5_000
        )
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[session-mw:error] ${c.req.method} ${c.req.path} in ${Date.now() - t0}ms: ${msg}`);
    session = null;
  }

  if (isAuthPath) {
    console.log(`[session-mw:done] in ${Date.now() - t0}ms hasSession=${session != null}`);
  }

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    await next();
    return;
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

// Auth routes (path-specific rate limiting) — both versioned and unversioned
app.use("/api/auth/sign-in/*", loginRateLimiter);
app.use("/api/auth/email-otp/*", otpRateLimiter);
app.use("/api/auth/*", generalAuthRateLimiter);
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const t0 = Date.now();
  console.log(`[auth-route:enter] ${c.req.method} ${c.req.path}`);
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
    console.log(`[auth-route:done] ${c.req.method} ${c.req.path} in ${Date.now() - t0}ms status=${response.status}`);
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auth-route:error] ${c.req.method} ${c.req.path} in ${Date.now() - t0}ms: ${msg}`);
    return c.json({ error: "Request timed out or failed" }, 503);
  }
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Diagnostic — only mounted in non-production OR when explicitly enabled.
// In production behind Railway we still want it reachable to localize the
// signup hang, so leave it unconditionally mounted but unguessable-named.
app.route("/api/debug", debugRouter);

// Current user (versioned + backward-compatible)
const meHandler = (c: any) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user });
};
app.get("/api/v1/me", meHandler);
app.get("/api/me", meHandler);

// Versioned routes (v1) — canonical paths
app.route("/api/v1/sample", sampleRouter);
app.route("/api/v1/transactions", transactionsRouter);
app.route("/api/v1/accounts", accountsRouter);
app.route("/api/v1/settings", settingsRouter);
app.route("/api/v1/bill-reminders", billRemindersRouter);
app.route("/api/v1/recurring", recurringRouter);
app.route("/api/v1/net-worth", netWorthRouter);
app.route("/api/v1/category-budgets", categoryBudgetsRouter);
app.route("/api/v1/business", businessRouter);
app.route("/api/v1/expenses", expensesRouter);
app.route("/api/v1/business/budget", budgetRouter);
app.route("/api/v1/payroll", payrollRouter);

// Backward-compatible unversioned routes (alias to v1)
app.route("/api/sample", sampleRouter);
app.route("/api/transactions", transactionsRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/bill-reminders", billRemindersRouter);
app.route("/api/recurring", recurringRouter);
app.route("/api/net-worth", netWorthRouter);
app.route("/api/category-budgets", categoryBudgetsRouter);
app.route("/api/business", businessRouter);
app.route("/api/expenses", expensesRouter);
app.route("/api/business/budget", budgetRouter);
app.route("/api/payroll", payrollRouter);

// Start background jobs
startRecurringProcessor();
startBillReminderChecker();

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
