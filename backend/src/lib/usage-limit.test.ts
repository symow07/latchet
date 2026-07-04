import { test, expect } from "bun:test";
import { allowUsage, allowUsageTiered } from "./usage-limit";

test("allows up to max uses within the window, then blocks", () => {
  const key = `u-${Math.random()}`;
  expect(allowUsage("t1", key, 3, 60_000)).toBe(true);
  expect(allowUsage("t1", key, 3, 60_000)).toBe(true);
  expect(allowUsage("t1", key, 3, 60_000)).toBe(true);
  expect(allowUsage("t1", key, 3, 60_000)).toBe(false);
});

test("keys are isolated from each other", () => {
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;
  expect(allowUsage("t2", a, 1, 60_000)).toBe(true);
  expect(allowUsage("t2", a, 1, 60_000)).toBe(false);
  expect(allowUsage("t2", b, 1, 60_000)).toBe(true); // unaffected by a's exhaustion
});

test("window expiry resets the counter", async () => {
  const key = `w-${Math.random()}`;
  expect(allowUsage("t3", key, 1, 20)).toBe(true);
  expect(allowUsage("t3", key, 1, 20)).toBe(false);
  await new Promise((r) => setTimeout(r, 30));
  expect(allowUsage("t3", key, 1, 20)).toBe(true);
});

test("tiered cap blocks on burst limit even when daily budget remains", () => {
  const key = `tier-${Math.random()}`;
  const opts = { burstMax: 2, burstWindowMs: 60_000, dailyMax: 100 };
  expect(allowUsageTiered("t4", key, opts)).toBe(true);
  expect(allowUsageTiered("t4", key, opts)).toBe(true);
  expect(allowUsageTiered("t4", key, opts)).toBe(false);
});
