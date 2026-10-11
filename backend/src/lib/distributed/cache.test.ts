import { test, expect, afterAll } from "bun:test";
import { prisma } from "../../prisma";
import { cacheAdd, cacheDelete, cacheDeleteIf, cacheGet, cacheSet, cacheTake } from "./cache";

const RUN = `cache-${process.pid}-${Date.now().toString(36)}`;
const key = (name: string) => `${RUN}:${name}`;
afterAll(async () => {
  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: RUN } } });
});

test("a value round-trips as JSON and replaces the previous one", async () => {
  const k = key("set");
  expect(await cacheGet(k)).toBeNull();
  await cacheSet(k, { a: 1, list: ["x", 2], nested: { ok: true } }, 60_000);
  expect(await cacheGet<object>(k)).toEqual({ a: 1, list: ["x", 2], nested: { ok: true } });
  await cacheSet(k, "second", 60_000);
  expect(await cacheGet<string>(k)).toBe("second");
  await cacheDelete(k);
  expect(await cacheGet(k)).toBeNull();
});

test("an expired value reads as absent", async () => {
  const k = key("expire");
  await cacheSet(k, 1, 50);
  expect(await cacheGet<number>(k)).toBe(1);
  await new Promise((r) => setTimeout(r, 80));
  expect(await cacheGet(k)).toBeNull();
});

test("take returns the value once, then nothing", async () => {
  const k = key("take");
  await cacheSet(k, { userId: "u1" }, 60_000);
  expect(await cacheTake<object>(k)).toEqual({ userId: "u1" });
  expect(await cacheTake(k)).toBeNull();
  expect(await cacheGet(k)).toBeNull();
});

test("concurrent takes of one value: exactly one gets it", async () => {
  const k = key("take-race");
  await cacheSet(k, "only-once", 60_000);
  const results = await Promise.all(Array.from({ length: 10 }, () => cacheTake<string>(k)));
  expect(results.filter((r) => r === "only-once").length).toBe(1);
});

test("take of an expired value gets nothing, and clears it", async () => {
  const k = key("take-expired");
  await cacheSet(k, 1, 30);
  await new Promise((r) => setTimeout(r, 60));
  expect(await cacheTake(k)).toBeNull();
  expect(await prisma.cacheEntry.findUnique({ where: { key: k } })).toBeNull();
});

test("add stores only when nothing live is there: one winner among concurrent adds", async () => {
  const k = key("add");
  const wins = await Promise.all(Array.from({ length: 10 }, (_, i) => cacheAdd(k, `h${i}`, 60_000)));
  expect(wins.filter(Boolean).length).toBe(1);
  expect(await cacheAdd(k, "late", 60_000)).toBe(false);
});

test("add takes over an expired entry", async () => {
  const k = key("add-expired");
  expect(await cacheAdd(k, "first", 30)).toBe(true);
  await new Promise((r) => setTimeout(r, 60));
  expect(await cacheAdd(k, "second", 60_000)).toBe(true);
  expect(await cacheGet<string>(k)).toBe("second");
});

test("deleteIf releases only the holder's own entry", async () => {
  const k = key("release");
  await cacheAdd(k, "holder-a", 60_000);
  expect(await cacheDeleteIf(k, "holder-b")).toBe(false);
  expect(await cacheGet<string>(k)).toBe("holder-a");
  expect(await cacheDeleteIf(k, "holder-a")).toBe(true);
  expect(await cacheGet(k)).toBeNull();
});
