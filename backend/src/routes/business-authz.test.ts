import { test, expect } from "bun:test";
import { businessRouter } from "./business";

/**
 * Asserts against the router's registered route table rather than response
 * status: the router's auth guard answers 401 for every path, including ones
 * that do not exist, so status cannot distinguish "removed" from "unauthorized".
 */
function registered(): Array<{ method: string; path: string }> {
  return (businessRouter as unknown as { routes: Array<{ method: string; path: string }> }).routes;
}

const has = (method: string, path: string) =>
  registered().some((r) => r.method === method && r.path === path);

test("the arbitrary-userId team route is gone", () => {
  // POST /api/business/team accepted any userId and created a TeamMember row
  // for it — no invitation, no consent, no existence check. Combined with
  // findFirst membership resolution, that silently pulled the victim into the
  // attacker's business, exposing its payroll and expenses to them.
  expect(has("POST", "/team")).toBe(false);
});

test("joining is only possible by invite code", () => {
  // Consent by construction: the invitee types the code themselves.
  expect(has("POST", "/join")).toBe(true);
});

test("managing existing members still works", () => {
  expect(has("PATCH", "/team/:memberId")).toBe(true);
  expect(has("DELETE", "/team/:memberId")).toBe(true);
});

test("switching the active business is available", () => {
  expect(has("PUT", "/active")).toBe(true);
});

test("no route can add a member by raw user id", () => {
  // Guards against the endpoint reappearing under another verb or path.
  const memberCreators = registered().filter(
    (r) => r.path.startsWith("/team") && (r.method === "POST" || r.method === "PUT")
  );
  expect(memberCreators).toEqual([]);
});

test("the company profile can be edited", () => {
  expect(has("PATCH", "/")).toBe(true);
});

test("editing the company profile is owner-scoped, not membership-scoped", async () => {
  // A manager approves expenses; only the owner changes the company's legal
  // identity. The handler resolves the row by findUnique({ ownerId }), so a
  // non-owner has no path to another business's record even knowing its id —
  // there is no id in the route to supply.
  const source = await Bun.file(new URL("./business.ts", import.meta.url)).text();
  const handler = source.slice(source.indexOf('businessRouter.patch(\n  "/"'));
  const body = handler.slice(0, handler.indexOf("\n);"));

  expect(body).toContain("findUnique({ where: { ownerId: user.id } })");
  // No membership lookup, which would widen this to managers and employees.
  expect(body).not.toContain("teamMember.findFirst");
});

test("deleting the company is possible, and owner-scoped", async () => {
  expect(has("DELETE", "/")).toBe(true);

  const source = await Bun.file(new URL("./business.ts", import.meta.url)).text();
  const start = source.indexOf('businessRouter.delete(');
  const body = source.slice(start, source.indexOf("\n);", start));

  expect(body).toContain("findUnique({ where: { ownerId: user.id } })");
  // Deleting a company takes every expense and salary with it. An endpoint
  // that does that on an empty body is one stray request from a catastrophe.
  expect(body).toContain("confirmName");
  expect(body).toContain("Name does not match");
});

test("deleting the company cleans up its receipt files", async () => {
  // The ids have to be read before the row goes; afterwards nothing links the
  // files to the business and they sit on the volume forever.
  const source = await Bun.file(new URL("./business.ts", import.meta.url)).text();
  const start = source.indexOf('businessRouter.delete(');
  const body = source.slice(start, source.indexOf("\n);", start));

  expect(body.indexOf("expense.findMany")).toBeLessThan(body.indexOf("business.delete"));
  expect(body).toContain("rm(receiptPath(");
});
