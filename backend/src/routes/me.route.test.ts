import { test, expect } from "bun:test";
import { meRouter } from "./me";

/**
 * The router's own auth guard is the last line of defence — the global session
 * middleware sets `user`, and without it every request here must be rejected.
 */
function unauthenticated(path: string, init: RequestInit = {}) {
  return meRouter.request(path, init);
}

test("deleting an account requires a session", async () => {
  const res = await unauthenticated("/", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmEmail: "victim@example.com" }),
  });
  expect(res.status).toBe(401);
});

test("the deletion preview requires a session", async () => {
  expect((await unauthenticated("/deletion-preview")).status).toBe(401);
});

test("reading the current user requires a session", async () => {
  expect((await unauthenticated("/")).status).toBe(401);
});
