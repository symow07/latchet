import { test, expect, afterAll } from "bun:test";
import { prisma } from "../../prisma";
import { bucketKey, forget, hitWindow, lockFor, lockedKeys } from "./counter";

// Rows outlive the run; every key carries this run's tag and is removed after.
const RUN = `ctr-${process.pid}-${Date.now().toString(36)}`;
const key = (name: string) => `${RUN}:${name}`;
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
});

test("hits are allowed up to the limit, then refused, and the count stops at the limit", async () => {
  const k = key("basic");
  const hits = [];
  for (let i = 0; i < 5; i++) hits.push(await hitWindow(k, 3, 60_000));
  expect(hits.map((h) => h.allowed)).toEqual([true, true, true, false, false]);
  expect(hits.map((h) => h.count)).toEqual([1, 2, 3, 3, 3]);
  // The stored count never climbs past max + 1, however hard it is hammered.
  const row = await prisma.rateLimitBucket.findUnique({ where: { key: k } });
  expect(row!.count).toBe(4);
});

test("a refused hit does not extend the window", async () => {
  const k = key("noextend");
  const first = await hitWindow(k, 1, 60_000);
  await new Promise((r) => setTimeout(r, 15));
  const refused = await hitWindow(k, 1, 60_000);
  expect(refused.allowed).toBe(false);
  expect(refused.resetAt.getTime()).toBe(first.resetAt.getTime());
});

test("the window rolls over inside the statement: an expired row restarts at one", async () => {
  const k = key("rollover");
  expect((await hitWindow(k, 1, 50)).allowed).toBe(true);
  expect((await hitWindow(k, 1, 50)).allowed).toBe(false);
  await new Promise((r) => setTimeout(r, 80));
  const next = await hitWindow(k, 1, 50);
  expect(next).toMatchObject({ allowed: true, count: 1 });
});

test("the window is measured by the database's clock", async () => {
  const k = key("dbclock");
  const hit = await hitWindow(k, 1, 10 * 60_000);
  const row = await prisma.rateLimitBucket.findUnique({ where: { key: k } });
  // windowStart and expiresAt are both database times, exactly ten minutes apart.
  expect(row!.expiresAt.getTime() - row!.windowStart.getTime()).toBe(10 * 60_000);
  expect(hit.resetAt.getTime()).toBe(row!.expiresAt.getTime());
  const [db] = await prisma.$queryRaw<{ now: Date }[]>`SELECT (statement_timestamp() AT TIME ZONE 'UTC') AS now`;
  expect(Math.abs(row!.windowStart.getTime() - db!.now.getTime())).toBeLessThan(5_000);
});

test("concurrent hits on one key are each counted once: exactly max are allowed", async () => {
  const k = key("race");
  const results = await Promise.all(Array.from({ length: 30 }, () => hitWindow(k, 7, 60_000)));
  expect(results.filter((r) => r.allowed).length).toBe(7);
  expect(results.filter((r) => r.allowed).map((r) => r.count).sort((a, b) => a - b))
    .toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test("a lock holds for its time and then lifts; other keys are not locked", async () => {
  const k = key("lock");
  expect(await lockedKeys([k])).toEqual(new Set());
  await lockFor(k, 80);
  expect(await lockedKeys([k, key("other")])).toEqual(new Set([k]));
  await new Promise((r) => setTimeout(r, 120));
  expect(await lockedKeys([k])).toEqual(new Set());
});

test("a lock and a counter on the same key do not collide", async () => {
  const k = key("both");
  await lockFor(k, 60_000);
  expect((await hitWindow(k, 1, 60_000)).allowed).toBe(true);
  expect(await lockedKeys([k])).toEqual(new Set([k]));
});

test("forgetting a key clears its count and its lock, and nothing else", async () => {
  const k = key("forget");
  const other = key("forget-other");
  for (let i = 0; i < 3; i++) await hitWindow(k, 2, 60_000);
  await lockFor(k, 60_000);
  await hitWindow(other, 2, 60_000);
  await forget(k);
  expect(await lockedKeys([k])).toEqual(new Set());
  expect(await hitWindow(k, 2, 60_000)).toMatchObject({ allowed: true, count: 1 });
  expect((await hitWindow(other, 2, 60_000)).count).toBe(2);
});

test("long keys are stored bounded and still distinct", () => {
  const a = bucketKey("x".repeat(5_000) + "a");
  const b = bucketKey("x".repeat(5_000) + "b");
  expect(a.length).toBeLessThan(200);
  expect(a).not.toBe(b);
  expect(bucketKey("short")).toBe("short");
});

test("nonsense limits are refused rather than silently allowing everything", async () => {
  await expect(hitWindow(key("bad"), -1, 1000)).rejects.toThrow();
  await expect(hitWindow(key("bad"), 1, 0)).rejects.toThrow();
});
