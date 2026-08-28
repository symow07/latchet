/**
 * The business profile, end to end through real handlers.
 *
 * Reported as "the business profile doesn't work". The screens are only half
 * the story — this exercises the actual create -> read -> update -> read
 * cycle, so a failure lands on whichever step is broken rather than on a
 * screenshot.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { businessRouter } from "./business";

const P = "bizflow_";
const OWNER = `${P}owner`;

async function cleanup() {
  await prisma.groupMember.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { ownerId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

type TestEnv = { Variables: { user: { id: string; email: string; name?: string } | null; session: unknown } };
const app = new Hono<TestEnv>();
app.use("*", async (c, next) => {
  c.set("user", { id: OWNER, email: `${OWNER}@x.test`, name: "Owner" });
  await next();
});
app.route("/business", businessRouter as unknown as Hono<TestEnv>);

const send = (method: string, path: string, body?: unknown) =>
  app.fetch(new Request(`http://t${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  await prisma.user.create({
    data: { id: OWNER, name: "Owner", email: `${OWNER}@x.test`, emailVerified: true,
            createdAt: now, updatedAt: now },
  });
});
afterAll(cleanup);

test("a business can be created for an account that has none", async () => {
  // The recovery path: createBusiness at account-type only logs on failure, so
  // an account can sit in business mode with no business row forever.
  // 404 with no business is deliberate, and businessApi.getBusiness maps it to
  // null. Asserted so a change to 200-with-null does not silently break the
  // client's `if (res.status === 404) return null`.
  const before = await send("GET", "/business");
  expect(before.status).toBe(404);

  const res = await send("POST", "/business", { name: "Acme Ltd" });
  expect(res.status).toBe(201);
  const created = await res.json() as { business: { id: string; name: string; ownerId: string } };
  expect(created.business.name).toBe("Acme Ltd");
  expect(created.business.ownerId).toBe(OWNER);
});

test("creating twice does not produce a second business", async () => {
  const res = await send("POST", "/business", { name: "Acme Again" });
  // Either a conflict or the existing row back — never a duplicate.
  expect([200, 201, 409]).toContain(res.status);
  expect(await prisma.group.count({ where: { ownerId: OWNER, type: "business" } })).toBe(1);
});

test("the profile reads back what was created", async () => {
  const body = await (await send("GET", "/business")).json() as {
    business: { name: string; members?: unknown[] };
  };
  expect(body.business.name).toBe("Acme Ltd");
  expect(Array.isArray(body.business.members)).toBe(true);
});

test("company profile fields save and persist", async () => {
  const patch = {
    name: "Acme International",
    address: "12 Rue Mohammed V, Casablanca",
    vatNumber: "MA-123456",
    taxId: "TAX-99",
    fiscalYearStartMonth: 4,
  };
  const res = await send("PATCH", "/business", patch);
  expect(res.status).toBe(200);

  // Read back through a FRESH request, not the update's own response — a
  // handler can return what it was sent without having written it.
  const after = await (await send("GET", "/business")).json() as {
    business: Record<string, unknown>;
  };
  expect(after.business.name).toBe("Acme International");
  expect(after.business.address).toBe(patch.address);
  expect(after.business.vatNumber).toBe("MA-123456");
  expect(after.business.taxId).toBe("TAX-99");
  expect(after.business.fiscalYearStartMonth).toBe(4);
});

test("an empty string clears a field, undefined leaves it alone", async () => {
  await send("PATCH", "/business", { vatNumber: "" });
  const after = await (await send("GET", "/business")).json() as {
    business: Record<string, unknown>;
  };
  expect(after.business.vatNumber).toBeNull();
  // taxId was not in the patch, so it survives.
  expect(after.business.taxId).toBe("TAX-99");
});

test("the invite code is issued and stable", async () => {
  const a = await (await send("GET", "/business/invite-code")).json() as { code: string };
  expect(a.code).toMatch(/^[0-9A-F]{6}$/);
  const b = await (await send("GET", "/business/invite-code")).json() as { code: string };
  expect(b.code).toBe(a.code);
});
