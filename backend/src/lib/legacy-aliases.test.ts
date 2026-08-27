import { test, expect } from "bun:test";
import { withLegacyAliases } from "./legacy-aliases";

/**
 * The aliases are added at runtime and deliberately absent from the return
 * type — the middleware wants T so it stays transparent to every route. These
 * tests are the one place that looks at the extra keys, so they read the
 * result as a plain record rather than widening the signature for everyone.
 */
const rec = (v: unknown) => v as Record<string, unknown>;

test("members is mirrored to teamMembers", () => {
  // The crash: `business?.teamMembers.find(...)` on a build that predates the
  // rename. An absent list threw; a present one does not.
  const out = rec(withLegacyAliases({ id: "g1", members: [{ userId: "u1", role: "owner" }] }));
  expect(out.teamMembers).toEqual(out.members);
  expect(Array.isArray(out.teamMembers)).toBe(true);
});

test("groupId is mirrored to businessId", () => {
  const out = rec(withLegacyAliases({ id: "e1", groupId: "g1", amount: 10 }));
  expect(out.businessId).toBe("g1");
});

test("aliases are added inside nested objects and arrays", () => {
  const out = withLegacyAliases({
    business: { members: [{ groupId: "g1" }] },
    expenses: [{ groupId: "g1" }],
  });
  const b = rec(out.business) as { teamMembers: { businessId: string }[] };
  expect(b.teamMembers[0]!.businessId).toBe("g1");
  expect(rec((out.expenses as unknown[])[0]).businessId).toBe("g1");
});

test("nothing is renamed or removed — current builds see what they saw", () => {
  const input = { id: "g1", name: "Acme", members: [{ userId: "u1" }], groupId: "g1" };
  const out = withLegacyAliases(input);
  expect(out.id).toBe("g1");
  expect(out.name).toBe("Acme");
  expect(out.members).toEqual(input.members);
  expect(out.groupId).toBe("g1");
});

test("an existing legacy key is never overwritten", () => {
  const out = rec(withLegacyAliases({ members: ["new"], teamMembers: ["explicit"] }));
  expect(out.teamMembers).toEqual(["explicit"]);
});

test("dates survive rather than becoming empty objects", () => {
  // Spreading a Date into a plain object yields {}, which would silently
  // destroy every createdAt on the wire.
  const when = new Date("2026-08-27T00:00:00Z");
  const out = withLegacyAliases({ createdAt: when, members: [] });
  expect(out.createdAt instanceof Date).toBe(true);
  expect((out.createdAt as Date).toISOString()).toBe(when.toISOString());
});

test("primitives and null pass through", () => {
  expect(withLegacyAliases(null)).toBeNull();
  expect(withLegacyAliases(4)).toBe(4);
  expect(withLegacyAliases("x")).toBe("x");
  expect(withLegacyAliases(undefined)).toBeUndefined();
});

test("a payload with neither field is unchanged", () => {
  const input = { id: "t1", amount: 12.5, category: "Food" };
  expect(withLegacyAliases(input)).toEqual(input);
});
