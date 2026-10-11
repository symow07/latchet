import { test, expect, afterAll } from "bun:test";
import { prisma } from "../prisma";
import { allowUsage, allowUsageTiered } from "./usage-limit";

// Counts live in Postgres and outlast the run, so every key is unique to it.
const RUN = `${process.pid}-${Date.now().toString(36)}`;
const key = (name: string) => `${name}-${RUN}`;
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
});

test("allows up to max uses within the window, then blocks", async () => {
  const k = key("u");
  expect(await allowUsage("t1", k, 3, 60_000)).toBe(true);
  expect(await allowUsage("t1", k, 3, 60_000)).toBe(true);
  expect(await allowUsage("t1", k, 3, 60_000)).toBe(true);
  expect(await allowUsage("t1", k, 3, 60_000)).toBe(false);
});

test("keys are isolated from each other", async () => {
  const a = key("a");
  const b = key("b");
  expect(await allowUsage("t2", a, 1, 60_000)).toBe(true);
  expect(await allowUsage("t2", a, 1, 60_000)).toBe(false);
  expect(await allowUsage("t2", b, 1, 60_000)).toBe(true); // unaffected by a's exhaustion
});

test("buckets are isolated from each other", async () => {
  const k = key("same-key");
  expect(await allowUsage("t2a", k, 1, 60_000)).toBe(true);
  expect(await allowUsage("t2b", k, 1, 60_000)).toBe(true);
});

test("window expiry resets the counter", async () => {
  const k = key("w");
  expect(await allowUsage("t3", k, 1, 40)).toBe(true);
  expect(await allowUsage("t3", k, 1, 40)).toBe(false);
  await new Promise((r) => setTimeout(r, 80));
  expect(await allowUsage("t3", k, 1, 40)).toBe(true);
});

test("tiered cap blocks on burst limit even when daily budget remains", async () => {
  const k = key("tier");
  const opts = { burstMax: 2, burstWindowMs: 60_000, dailyMax: 100 };
  expect(await allowUsageTiered("t4", k, opts)).toBe(true);
  expect(await allowUsageTiered("t4", k, opts)).toBe(true);
  expect(await allowUsageTiered("t4", k, opts)).toBe(false);
});

test("tiered cap blocks on the daily limit once the day is spent", async () => {
  const k = key("daily");
  const opts = { burstMax: 100, burstWindowMs: 60_000, dailyMax: 2 };
  expect(await allowUsageTiered("t5", k, opts)).toBe(true);
  expect(await allowUsageTiered("t5", k, opts)).toBe(true);
  expect(await allowUsageTiered("t5", k, opts)).toBe(false);
});

test("a burst-refused use does not spend the daily allowance", async () => {
  const k = key("nospend");
  const opts = { burstMax: 1, burstWindowMs: 60_000, dailyMax: 5 };
  expect(await allowUsageTiered("t6", k, opts)).toBe(true);
  for (let i = 0; i < 5; i++) expect(await allowUsageTiered("t6", k, opts)).toBe(false);
  const daily = await prisma.rateLimitBucket.findUnique({ where: { key: `usage:t6:daily:${k}` } });
  expect(daily!.count).toBe(1);
});

test("concurrent uses are each counted exactly once", async () => {
  // Twenty requests at once against a limit of ten: exactly ten get through.
  const k = key("race");
  const results = await Promise.all(
    Array.from({ length: 20 }, () => allowUsage("t7", k, 10, 60_000))
  );
  expect(results.filter(Boolean).length).toBe(10);
});
