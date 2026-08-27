import { test, expect } from "bun:test";
import { selectActiveGroupId, type MembershipRow } from "./get-user-group";

const at = (iso: string) => new Date(iso);
const member = (groupId: string, iso: string): MembershipRow => ({
  groupId,
  createdAt: at(iso),
});

test("a user with nothing resolves to no business", () => {
  expect(selectActiveGroupId(null, [], null)).toBeNull();
});

test("an owner resolves to the business they own", () => {
  expect(selectActiveGroupId("biz_owned", [], null)).toBe("biz_owned");
});

test("a single membership resolves to that business", () => {
  expect(selectActiveGroupId(null, [member("biz_a", "2026-01-01")], null)).toBe("biz_a");
});

test("multiple memberships resolve deterministically, not by row order", () => {
  // findFirst with no ordering could return either of these, and could change
  // its mind between requests.
  const memberships = [member("biz_b", "2026-03-01"), member("biz_a", "2026-01-01")];

  expect(selectActiveGroupId(null, memberships, null)).toBe("biz_a");
  expect(selectActiveGroupId(null, [...memberships].reverse(), null)).toBe("biz_a");
});

test("memberships created at the same instant tie-break on id", () => {
  const memberships = [member("biz_z", "2026-01-01"), member("biz_a", "2026-01-01")];
  expect(selectActiveGroupId(null, memberships, null)).toBe("biz_a");
  expect(selectActiveGroupId(null, [...memberships].reverse(), null)).toBe("biz_a");
});

test("an explicit selection wins over the default ordering", () => {
  const memberships = [member("biz_a", "2026-01-01"), member("biz_b", "2026-03-01")];
  expect(selectActiveGroupId(null, memberships, "biz_b")).toBe("biz_b");
});

test("an explicit selection wins over an owned business", () => {
  const memberships = [member("biz_employer", "2026-01-01")];
  expect(selectActiveGroupId("biz_mine", memberships, "biz_employer")).toBe("biz_employer");
});

test("selecting a business you do not belong to grants nothing", () => {
  // Otherwise writing to the settings field would itself be the exploit.
  expect(selectActiveGroupId(null, [member("biz_a", "2026-01-01")], "biz_someone_else")).toBe(
    "biz_a"
  );
  expect(selectActiveGroupId(null, [], "biz_someone_else")).toBeNull();
});

test("an owner falls back to their own business when the selection is invalid", () => {
  expect(selectActiveGroupId("biz_mine", [], "biz_stale")).toBe("biz_mine");
});

test("a user added to a business without consent cannot be resolved into it", () => {
  // The end state the vulnerability produced: victim owns nothing, and a
  // TeamMember row exists that they never agreed to. The route that created
  // such rows is gone, but if one exists it must not silently become their
  // active business ahead of their own explicit choice.
  const planted = [member("biz_attacker", "2026-01-01")];

  // With no business of their own and no selection, the row is all there is —
  // so what protects the victim is that the row can no longer be created.
  expect(selectActiveGroupId(null, planted, null)).toBe("biz_attacker");

  // But it can never override a business they actually own...
  expect(selectActiveGroupId("biz_victim", planted, null)).toBe("biz_victim");
  // ...nor their own explicit choice.
  expect(selectActiveGroupId("biz_victim", planted, "biz_victim")).toBe("biz_victim");
});
