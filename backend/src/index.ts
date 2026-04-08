import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { logger } from "hono/logger";
import { auth, authRateLimiter } from "./auth";
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

// Auth middleware - populates user/session for all routes
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
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

// Auth routes (rate-limited)
app.use("/api/auth/*", authRateLimiter());
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Current user
app.get("/api/me", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user });
});

// Routes
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

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
