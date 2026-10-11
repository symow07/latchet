import { test, expect } from "bun:test";

/**
 * Every router mounted under /api/v1 must also be mounted unversioned.
 *
 * The app has shipped both forms since before v1 existed, and which one a
 * given client uses depends on when its module was written — householdApi
 * calls /api/v1, businessApi calls /api/. A router mounted only under one
 * prefix works until some client reaches for the other and gets a 404 that
 * looks like a missing feature rather than a missing mount.
 *
 * The household router was mounted only under /api/v1 for exactly that reason:
 * it was new, and the unversioned block was a separate list further down.
 */
test("every /api/v1 router is also mounted unversioned", async () => {
  const source = await Bun.file(new URL("../index.ts", import.meta.url)).text();

  const versioned = new Map<string, string>();
  const plain = new Map<string, string>();
  for (const m of source.matchAll(/app\.route\("\/api\/(v1\/)?([^"]+)",\s*(\w+)\)/g)) {
    (m[1] ? versioned : plain).set(m[2]!, m[3]!);
  }

  expect(versioned.size).toBeGreaterThan(5);
  const missing = [...versioned.entries()]
    .filter(([path]) => path !== "debug")
    .filter(([path, router]) => plain.get(path) !== router)
    .map(([path]) => `/api/${path}`);

  expect(missing).toEqual([]);
});

/**
 * The same property, checked on the routes the exported app actually serves
 * rather than on index.ts's text: every method and path under /api/v1 also
 * answers unversioned. A router mounted under both prefixes but with a route
 * added through a second, v1-only mount would pass the test above and fail
 * this one.
 */
test("every route the app serves under /api/v1 is also served unversioned", async () => {
  const { app } = await import("../index");
  const served = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
  const v1 = app.routes.filter((r) => r.path.startsWith("/api/v1/"));
  expect(v1.length).toBeGreaterThan(50);
  const missing = v1
    .map((r) => `${r.method} ${r.path.replace("/api/v1/", "/api/")}`)
    .filter((route) => !served.has(route));
  expect(missing).toEqual([]);
});

/**
 * Sync (routes/sync.ts) replaced the bulk upload endpoints. They are gone
 * rather than left beside it: a build still calling them would write rows
 * without clientUpdatedAt and overwrite newer edits from other devices.
 */
test("the sync API is served under both prefixes and the old bulk endpoints are gone", async () => {
  const { app } = await import("../index");
  const served = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
  for (const prefix of ["/api/v1", "/api"]) {
    expect(served.has(`POST ${prefix}/sync/push`)).toBe(true);
    expect(served.has(`GET ${prefix}/sync/pull`)).toBe(true);
    expect(served.has(`POST ${prefix}/transactions/sync`)).toBe(false);
    expect(served.has(`POST ${prefix}/accounts/sync`)).toBe(false);
  }
});
