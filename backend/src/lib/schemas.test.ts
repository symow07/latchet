import { test, expect } from "bun:test";
import { z } from "zod";
import { money, signedMoney, isoDate, categoryName, MAX_SYNC_ROWS } from "./schemas";

const netWorthSchema = z.object({
  date: isoDate,
  assets: money,
  liabilities: money,
});

test("net worth rejects a missing field instead of storing NaN", () => {
  // body.assets - body.liabilities with either missing produced NaN, which was
  // written to the database and could never be corrected by the UI.
  expect(netWorthSchema.safeParse({ date: "2026-08-18", assets: 100 }).success).toBe(false);
  expect(netWorthSchema.safeParse({ date: "2026-08-18", liabilities: 50 }).success).toBe(false);
});

test("net worth rejects NaN and Infinity outright", () => {
  const base = { date: "2026-08-18", liabilities: 0 };
  expect(netWorthSchema.safeParse({ ...base, assets: NaN }).success).toBe(false);
  expect(netWorthSchema.safeParse({ ...base, assets: Infinity }).success).toBe(false);
});

test("net worth rejects a non-numeric string", () => {
  expect(
    netWorthSchema.safeParse({ date: "2026-08-18", assets: "lots", liabilities: 0 }).success
  ).toBe(false);
});

test("a well-formed net worth entry is accepted", () => {
  const parsed = netWorthSchema.safeParse({
    date: "2026-08-18",
    assets: 12500.5,
    liabilities: 3200,
  });
  expect(parsed.success).toBe(true);
});

test("dates must be YYYY-MM-DD", () => {
  expect(isoDate.safeParse("2026-08-18").success).toBe(true);
  expect(isoDate.safeParse("18/08/2026").success).toBe(false);
  expect(isoDate.safeParse("2026-8-18").success).toBe(false);
  expect(isoDate.safeParse("").success).toBe(false);
});

test("money is bounded on both ends", () => {
  expect(money.safeParse(0).success).toBe(true);
  expect(money.safeParse(-1).success).toBe(false);
  expect(money.safeParse(10_000_001).success).toBe(false);
});

test("signed money allows negatives, for balances and net worth", () => {
  expect(signedMoney.safeParse(-500).success).toBe(true);
  expect(signedMoney.safeParse(-10_000_001).success).toBe(false);
});

test("category names are free-form but bounded", () => {
  // Custom categories are a shipped feature, so this cannot be an enum.
  expect(categoryName.safeParse("Tagine ingredients").success).toBe(true);
  expect(categoryName.safeParse("").success).toBe(false);
  expect(categoryName.safeParse("x".repeat(51)).success).toBe(false);
});

test("the sync cap leaves headroom over the client's chunk size", () => {
  // mobile/src/lib/cloud-sync.ts uploads in chunks of 500.
  expect(MAX_SYNC_ROWS).toBeGreaterThanOrEqual(500);
});
