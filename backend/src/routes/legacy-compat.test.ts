/**
 * Builds released before the Group rename must keep working.
 *
 * The 26 August build reads `business?.teamMembers.find(...)`. That optional-
 * chains the business, not the list, so when the backend started sending
 * `members` the call threw on the business dashboard — the first screen in
 * business mode, on every launch.
 *
 * Exercised through real handlers rather than by unit-testing the aliaser,
 * because the property is "the middleware is actually mounted and fires on
 * this route". A pure test of withLegacyAliases proves the function, not the
 * wiring, and it was the wiring that was missing.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { withLegacyAliases } from "../lib/legacy-aliases";
import { businessRouter } from "./business";
import { client, createTestUser, deleteTestUsers } from "../lib/sync/testing";

const P = "legacytest_";
const OWNER = `${P}owner`;

async function cleanup() {
  await prisma.groupMember.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { ownerId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

let actingAs = OWNER;
type TestEnv = { Variables: { user: { id: string; email: string } | null; session: unknown } };

// The same global middleware index.ts installs.
const app = new Hono<TestEnv>();
app.use("*", async (c, next) => {
  c.set("user", { id: actingAs, email: `${actingAs}@x.test` });
  await next();
  if (!c.res.headers.get("content-type")?.includes("application/json")) return;
  try {
    const parsed = await c.res.clone().json();
    c.res = new Response(JSON.stringify(withLegacyAliases(parsed)), {
      status: c.res.status,
      headers: c.res.headers,
    });
  } catch { /* not JSON */ }
});
app.route("/business", businessRouter as unknown as Hono<TestEnv>);

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  await prisma.user.create({
    data: { id: OWNER, name: "Owner", email: `${OWNER}@x.test`, emailVerified: true,
            createdAt: now, updatedAt: now },
  });
  await prisma.group.create({
    data: {
      id: `${P}biz`, ownerId: OWNER, name: "Acme", type: "business",
      createdAt: now, updatedAt: now,
      members: { create: { userId: OWNER, role: "owner" } },
    },
  });
});

afterAll(cleanup);

test("GET /business serves teamMembers alongside members", async () => {
  const res = await app.fetch(new Request("http://t/business"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    business: { members?: unknown[]; teamMembers?: unknown[] };
  };

  // The new name is still there for current builds...
  expect(Array.isArray(body.business.members)).toBe(true);
  // ...and the old one is back for the builds already on people's phones.
  expect(Array.isArray(body.business.teamMembers)).toBe(true);
  expect(body.business.teamMembers).toEqual(body.business.members!);
});

test("the alias middleware is wired into the real app, not just this harness", async () => {
  // The tests around this one rebuild index.ts's middleware locally, which
  // proves the function and not the wiring — and it was the wiring that was
  // missing. This drives the exported app itself, with a real session, so
  // deleting the app.use in index.ts fails here.
  const { app } = await import("../index");
  const owner = await createTestUser("legacy");
  try {
    const now = new Date();
    await prisma.group.create({
      data: {
        ownerId: owner.id, name: "Real wiring", type: "business", createdAt: now, updatedAt: now,
        members: { create: { userId: owner.id, role: "owner" } },
      },
    });
    const res = await client(app, owner).get("/api/business");
    expect(res.status).toBe(200);
    const business = res.json.business as { members?: unknown[]; teamMembers?: unknown[] };
    expect(Array.isArray(business.members)).toBe(true);
    expect(business.teamMembers).toEqual(business.members!);
  } finally {
    await deleteTestUsers([owner]);
  }
});

test("the exact call that crashed the 26 August build now works", async () => {
  const res = await app.fetch(new Request("http://t/business"));
  const body = (await res.json()) as { business: Record<string, unknown> };

  // Verbatim from that build: business?.teamMembers.find(...)
  const business = body.business as { teamMembers: { userId: string; role: string }[] };
  expect(() => business.teamMembers.find((m) => m.userId === OWNER)).not.toThrow();
  expect(business.teamMembers.find((m) => m.userId === OWNER)?.role).toBe("owner");
});
