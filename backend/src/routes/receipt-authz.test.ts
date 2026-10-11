import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { expensesRouter } from "./expenses";
import { businessRouter } from "./business";
import { logoPath, receiptPath } from "../lib/receipt-store";

/**
 * A receipt is somebody's private document. Reaching one must require being in
 * the business that owns it, not merely knowing an id — and since receipts and
 * logos moved from the instance's disk into Postgres, every instance must
 * serve them, under exactly the same rules.
 */
function registered(): Array<{ method: string; path: string }> {
  return (expensesRouter as unknown as { routes: Array<{ method: string; path: string }> }).routes;
}

async function receiptHandlerSource(): Promise<string> {
  const source = await Bun.file(new URL("./expenses.ts", import.meta.url)).text();
  const start = source.indexOf('expensesRouter.get("/:id/receipt"');
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n});", start));
}

test("receipts are served by their own route", () => {
  expect(registered().some((r) => r.method === "GET" && r.path === "/:id/receipt")).toBe(true);
});

test("serving a receipt is scoped by the caller's membership, not by the id", async () => {
  // findFirst({ where: { id } }) alone would hand any receipt to anyone who
  // guessed a cuid. The groupId term is what makes the id insufficient, and
  // the file is looked up under the caller's own business too.
  const handler = await receiptHandlerSource();
  expect(handler).toContain("getMembership(user.id)");
  expect(handler).toContain("groupId: membership.groupId");
  expect(handler).toContain("receiptPath(membership.groupId, id)");
});

test("the id from the path is validated before it becomes part of a file path", async () => {
  expect(await receiptHandlerSource()).toContain("isSafeId(id)");
});

test("an expense in another business is a 404, not a 403", async () => {
  // 403 would confirm the id exists, which is itself worth something to
  // someone enumerating ids.
  expect(await receiptHandlerSource()).toContain(
    'if (!expense?.imageUrl) return c.json({ error: "Not found" }, 404)'
  );
});

test("receipts are not cached by shared proxies", async () => {
  const source = await Bun.file(new URL("./expenses.ts", import.meta.url)).text();
  expect(source).toContain('"Cache-Control": "private');
});

// ── Through the real handlers, against Postgres ──────────────────────────────

const RUN = `${process.pid}${Date.now().toString(36)}`;
const P = `rcpt_${RUN}_`;
const OWNER = `${P}owner`;
const EMPLOYEE = `${P}employee`;
const OUTSIDER = `${P}outsider`;
const LONER = `${P}loner`;
const BIZ = `${P}biz`;
const OTHER_BIZ = `${P}other`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

let actingAs = "";
type TestEnv = { Variables: { user: { id: string; email: string; name: string } | null; session: unknown } };
const app = new Hono<TestEnv>();
app.use("*", async (c, next) => {
  c.set("user", actingAs ? { id: actingAs, email: `${actingAs}@x.test`, name: actingAs } : null);
  await next();
});
app.route("/expenses", expensesRouter as unknown as Hono<TestEnv>);
app.route("/business", businessRouter as unknown as Hono<TestEnv>);

const as = (userId: string) => {
  actingAs = userId;
};
const send = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://t${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

async function cleanup() {
  await prisma.storedFile.deleteMany({
    where: { OR: [{ id: { startsWith: `receipts/${P}` } }, { id: { startsWith: `logos/${P}` } }] },
  });
  await prisma.group.deleteMany({ where: { ownerId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  for (const id of [OWNER, EMPLOYEE, OUTSIDER, LONER]) {
    await prisma.user.create({
      data: { id, name: id, email: `${id}@x.test`, emailVerified: true, createdAt: now, updatedAt: now },
    });
  }
  await prisma.group.create({
    data: {
      id: BIZ, ownerId: OWNER, name: "Acme", type: "business",
      members: { create: [{ userId: OWNER, role: "owner" }, { userId: EMPLOYEE, role: "employee" }] },
    },
  });
  await prisma.group.create({
    data: { id: OTHER_BIZ, ownerId: OUTSIDER, name: "Rival", type: "business",
      members: { create: [{ userId: OUTSIDER, role: "owner" }] } },
  });
});
afterAll(cleanup);

async function submitExpense(image?: Uint8Array) {
  as(EMPLOYEE);
  const res = await send("POST", "/expenses", {
    amount: 12.5, category: "Meals", description: "Lunch", ...(image ? { image: b64(image) } : {}),
  });
  return { res, body: (await res.json()) as { expense: { id: string; imageUrl: string | null } } };
}

test("an uploaded receipt is stored in Postgres, under its business, and linked from the expense", async () => {
  const { res, body } = await submitExpense(PNG);
  expect(res.status).toBe(201);
  expect(body.expense.imageUrl).toBe(`/api/expenses/${body.expense.id}/receipt`);

  const file = await prisma.storedFile.findUnique({ where: { id: receiptPath(BIZ, body.expense.id) } });
  expect(file).not.toBeNull();
  expect(file!.kind).toBe("receipt");
  expect(file!.ownerId).toBe(body.expense.id);
  expect(file!.contentType).toBe("image/png");
  expect(file!.size).toBe(PNG.byteLength);
  expect(new Uint8Array(file!.bytes)).toEqual(PNG);
});

test("anyone in the business is served the receipt, privately", async () => {
  const { body } = await submitExpense(JPEG);
  as(OWNER);
  const res = await send("GET", `/expenses/${body.expense.id}/receipt`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
});

test("a member of another business gets 404 for the same receipt", async () => {
  const { body } = await submitExpense(PNG);
  as(OUTSIDER);
  expect((await send("GET", `/expenses/${body.expense.id}/receipt`)).status).toBe(404);
});

test("someone in no business at all is refused", async () => {
  const { body } = await submitExpense(PNG);
  as(LONER);
  expect((await send("GET", `/expenses/${body.expense.id}/receipt`)).status).toBe(403);
});

test("an expense without a receipt has nothing to serve", async () => {
  const { body } = await submitExpense();
  expect(body.expense.imageUrl).toBeNull();
  as(OWNER);
  expect((await send("GET", `/expenses/${body.expense.id}/receipt`)).status).toBe(404);
});

test("a non-image upload is refused before any row is written", async () => {
  as(EMPLOYEE);
  const before = await prisma.expense.count({ where: { groupId: BIZ } });
  const res = await send("POST", "/expenses", {
    amount: 1, category: "Other", description: "x", image: b64(new TextEncoder().encode("%PDF-1.7")),
  });
  expect(res.status).toBe(400);
  expect(await prisma.expense.count({ where: { groupId: BIZ } })).toBe(before);
});

test("a company logo is stored in Postgres, replaced in place, served to members, and removed", async () => {
  as(OWNER);
  expect((await send("PUT", "/business/logo", { image: b64(PNG) })).status).toBe(200);
  // Replacing with another format overwrites the one file; no stale copy.
  const put = await send("PUT", "/business/logo", { image: b64(JPEG) });
  expect(put.status).toBe(200);
  expect(((await put.json()) as { business: { logoUrl: string } }).business.logoUrl).toBe("/api/business/logo");
  expect(await prisma.storedFile.count({ where: { kind: "logo", ownerId: BIZ } })).toBe(1);

  as(EMPLOYEE);
  const got = await send("GET", "/business/logo");
  expect(got.status).toBe(200);
  expect(got.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await got.arrayBuffer())).toEqual(JPEG);

  // An outsider resolves their own business, which has no logo.
  as(OUTSIDER);
  expect((await send("GET", "/business/logo")).status).toBe(404);

  as(OWNER);
  expect((await send("DELETE", "/business/logo")).status).toBe(200);
  expect(await prisma.storedFile.findUnique({ where: { id: logoPath(BIZ) } })).toBeNull();
  expect((await send("GET", "/business/logo")).status).toBe(404);
});

test("only the owner can set the logo", async () => {
  as(EMPLOYEE);
  // The employee owns no business, so there is nothing for them to set.
  expect((await send("PUT", "/business/logo", { image: b64(PNG) })).status).toBe(404);
  expect(await prisma.storedFile.count({ where: { kind: "logo", ownerId: BIZ } })).toBe(0);
});

test("deleting a business removes its receipts and logo, and nobody else's", async () => {
  // A receipt in the other business, which must survive.
  as(OUTSIDER);
  const theirs = (await (await send("POST", "/expenses", {
    amount: 3, category: "Office", description: "Pens", image: b64(PNG),
  })).json()) as { expense: { id: string } };

  as(OWNER);
  await send("PUT", "/business/logo", { image: b64(PNG) });
  const ours = await prisma.storedFile.count({ where: { id: { startsWith: `receipts/${BIZ}/` } } });
  expect(ours).toBeGreaterThan(0);

  const res = await send("DELETE", "/business", { confirmName: "Acme" });
  expect(res.status).toBe(200);
  expect(await prisma.storedFile.count({ where: { id: { startsWith: `receipts/${BIZ}/` } } })).toBe(0);
  expect(await prisma.storedFile.findUnique({ where: { id: logoPath(BIZ) } })).toBeNull();
  expect(
    await prisma.storedFile.findUnique({ where: { id: receiptPath(OTHER_BIZ, theirs.expense.id) } })
  ).not.toBeNull();
});
