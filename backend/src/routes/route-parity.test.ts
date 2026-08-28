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
