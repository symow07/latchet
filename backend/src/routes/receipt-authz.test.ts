import { test, expect } from "bun:test";
import { expensesRouter } from "./expenses";

/**
 * A receipt is somebody's private document. Reaching one must require being in
 * the business that owns it, not merely knowing an id.
 */
function registered(): Array<{ method: string; path: string }> {
  return (expensesRouter as unknown as { routes: Array<{ method: string; path: string }> }).routes;
}

test("receipts are served by their own route", () => {
  expect(registered().some((r) => r.method === "GET" && r.path === "/:id/receipt")).toBe(true);
});

test("serving a receipt is scoped by the caller's membership, not by the id", async () => {
  // findFirst({ where: { id } }) alone would hand any receipt to anyone who
  // guessed a cuid. The businessId term is what makes the id insufficient.
  const source = await Bun.file(new URL("./expenses.ts", import.meta.url)).text();
  const start = source.indexOf('expensesRouter.get("/:id/receipt"');
  expect(start).toBeGreaterThan(-1);
  const handler = source.slice(start, source.indexOf("\n});", start));

  expect(handler).toContain("getMembership(user.id)");
  expect(handler).toContain("businessId: membership.businessId");
});

test("the id from the path is validated before it becomes a filename", async () => {
  // It is concatenated into a path; a traversal would read arbitrary files.
  const source = await Bun.file(new URL("./expenses.ts", import.meta.url)).text();
  const start = source.indexOf('expensesRouter.get("/:id/receipt"');
  const handler = source.slice(start, source.indexOf("\n});", start));

  expect(handler).toContain("isSafeId(id)");
});

test("an expense in another business is a 404, not a 403", async () => {
  // 403 would confirm the id exists, which is itself worth something to
  // someone enumerating ids.
  const source = await Bun.file(new URL("./expenses.ts", import.meta.url)).text();
  const start = source.indexOf('expensesRouter.get("/:id/receipt"');
  const handler = source.slice(start, source.indexOf("\n});", start));

  expect(handler).toContain('if (!expense?.imageUrl) return c.json({ error: "Not found" }, 404)');
});

test("receipts are not cached by shared proxies", async () => {
  const source = await Bun.file(new URL("./expenses.ts", import.meta.url)).text();
  expect(source).toContain('"Cache-Control": "private');
});
