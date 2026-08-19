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
