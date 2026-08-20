import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { aiRouter } from "./ai";
import { plaidRouter } from "./plaid";
import { revenueCatRouter } from "./revenuecat";
import { FREE_AI_CALLS_PER_DAY } from "../lib/entitlement";

/**
 * The entitlement gate, exercised against a real database.
 *
 * The property under test is that the tier comes from the row and nothing else
 * — a client is never able to assert what it is entitled to.
 */

const FREE_USER = "guard_free_user";
const PRO_USER = "guard_pro_user";
const EXPIRED_USER = "guard_expired_user";
// The webhook test mutates its subject, so it gets one nobody else asserts on.
const WEBHOOK_USER = "guard_webhook_user";

/** The context variables the global session middleware normally populates. */
type SessionVars = {
  Variables: { user: { id: string; email: string } | null; session: unknown };
};

/** Mounts a router behind a middleware that pretends `userId` is signed in. */
function appAs(userId: string, router: Hono<never>) {
  const app = new Hono<SessionVars>();
  app.use("*", async (c, next) => {
    c.set("user", { id: userId, email: `${userId}@example.com` });
    c.set("session", { userId });
    await next();
  });
  app.route("/", router as never);
  return app;
}

async function makeUser(id: string, entitlement: string, expiresAt: Date | null) {
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      name: id,
      email: `${id}@example.com`,
      updatedAt: new Date(),
      entitlement,
      entitlementExpiresAt: expiresAt,
    },
    update: { entitlement, entitlementExpiresAt: expiresAt },
  });
}

beforeAll(async () => {
  const future = new Date(Date.now() + 30 * 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  await makeUser(FREE_USER, "free", null);
  await makeUser(PRO_USER, "pro", future);
  await makeUser(EXPIRED_USER, "pro", past);
  await makeUser(WEBHOOK_USER, "free", null);
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [FREE_USER, PRO_USER, EXPIRED_USER, WEBHOOK_USER] } },
  });
});

// ── Bank sync is Pro-only ────────────────────────────────────────────────────

test("a free user is refused bank linking with 402, not 500", async () => {
  const res = await appAs(FREE_USER, plaidRouter as never).request("/accounts");
  const body = (await res.json()) as { code: string };

  expect(res.status).toBe(402);
  // A machine-readable code so the client can present the paywall rather than
  // an error toast.
  expect(body.code).toBe("upgrade_required");
});

test("a client claiming Pro is still refused", async () => {
  // The whole point of server-side entitlement. Nothing a request can say —
  // header, body or query — changes the answer.
  const forged = await appAs(FREE_USER, plaidRouter as never).request("/accounts", {
    method: "GET",
    headers: {
      "X-Entitlement": "pro",
      "X-Pro": "true",
      Authorization: "Bearer pro",
    },
  });
  expect(forged.status).toBe(402);
});

test("a Pro user gets past the gate", async () => {
  const res = await appAs(PRO_USER, plaidRouter as never).request("/accounts");
  expect(res.status).toBe(200);
});

test("an expired Pro subscription is treated as free", async () => {
  // A missed EXPIRATION webhook must not leave someone on Pro forever.
  const res = await appAs(EXPIRED_USER, plaidRouter as never).request("/accounts");
  expect(res.status).toBe(402);
});

// ── The AI allowance ─────────────────────────────────────────────────────────

test("a free user gets a taste of the advisor, then a paywall", async () => {
  const app = appAs(FREE_USER, aiRouter as never);
  const call = () =>
    app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

  // The allowance is consumed by the guard before the handler runs, so these
  // do not reach OpenAI.
  const statuses: number[] = [];
  for (let i = 0; i < FREE_AI_CALLS_PER_DAY + 1; i++) {
    statuses.push((await call()).status);
  }

  const overLimit = statuses[FREE_AI_CALLS_PER_DAY]!;
  // 402, not 429: this is a paywall, not congestion.
  expect(overLimit).toBe(402);
  expect(statuses.slice(0, FREE_AI_CALLS_PER_DAY)).not.toContain(402);
});

// ── Webhook authentication ───────────────────────────────────────────────────

test("a webhook with no Authorization header is rejected", async () => {
  const res = await revenueCatRouter.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { type: "INITIAL_PURCHASE", app_user_id: FREE_USER } }),
  });
  expect(res.status).toBe(401);
});

test("a webhook with the wrong secret is rejected, and changes nothing", async () => {
  const res = await revenueCatRouter.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "not-the-secret" },
    body: JSON.stringify({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: WEBHOOK_USER,
        entitlement_ids: ["pro"],
        expiration_at_ms: Date.now() + 86_400_000,
      },
    }),
  });

  expect(res.status).toBe(401);
  // The forged upgrade must not have landed.
  const user = await prisma.user.findUnique({ where: { id: WEBHOOK_USER } });
  expect(user!.entitlement).toBe("free");
});

test("a signed webhook grants and then expires the entitlement", async () => {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET!;
  const send = (type: string) =>
    revenueCatRouter.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: secret },
      body: JSON.stringify({
        event: {
          type,
          app_user_id: WEBHOOK_USER,
          entitlement_ids: ["pro"],
          expiration_at_ms: Date.now() + 30 * 86_400_000,
        },
      }),
    });

  expect((await send("INITIAL_PURCHASE")).status).toBe(200);
  expect((await prisma.user.findUnique({ where: { id: WEBHOOK_USER } }))!.entitlement).toBe("pro");
  // ...and the guard follows immediately.
  expect((await appAs(WEBHOOK_USER, plaidRouter as never).request("/accounts")).status).toBe(200);

  expect((await send("EXPIRATION")).status).toBe(200);
  expect((await prisma.user.findUnique({ where: { id: WEBHOOK_USER } }))!.entitlement).toBe("free");
  expect((await appAs(WEBHOOK_USER, plaidRouter as never).request("/accounts")).status).toBe(402);
});

test("a webhook for an unknown subscriber is acknowledged, not retried forever", async () => {
  const res = await revenueCatRouter.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.REVENUECAT_WEBHOOK_SECRET!,
    },
    body: JSON.stringify({
      event: { type: "INITIAL_PURCHASE", app_user_id: "nobody", entitlement_ids: ["pro"] },
    }),
  });

  expect(res.status).toBe(200);
  expect((await res.json()) as { applied: boolean }).toMatchObject({ applied: false });
});
