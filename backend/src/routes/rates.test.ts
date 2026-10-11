import { test, expect, afterAll, beforeEach } from "bun:test";
import { prisma } from "../prisma";
import {
  CACHE_TTL_MS, createRatesRouter, getRates, parseUpstream, type RatesDeps, type RatesPayload,
} from "./rates";

test("a well-formed provider response is parsed", () => {
  const parsed = parseUpstream(
    {
      result: "success",
      base_code: "USD",
      time_last_update_utc: "Tue, 18 Aug 2026 00:00:01 +0000",
      rates: { USD: 1, EUR: 0.86, MAD: 9.81 },
    },
    "open.er-api.com"
  );

  expect(parsed).toEqual({
    base: "USD",
    rates: { USD: 1, EUR: 0.86, MAD: 9.81 },
    asOf: "2026-08-18",
    source: "open.er-api.com",
  });
});

test("unusable rate values are dropped", () => {
  const parsed = parseUpstream(
    {
      base_code: "USD",
      rates: {
        EUR: 0.86,
        BAD: 0 as number,
        WORSE: -3 as number,
        NAN: NaN as number,
        TEXT: "1.5" as unknown as number,
      },
    },
    "test"
  );

  expect(parsed!.rates).toEqual({ EUR: 0.86 });
});

test("a response with no rates is rejected rather than cached", () => {
  expect(parseUpstream({ result: "error" }, "test")).toBeNull();
  expect(parseUpstream({ rates: {} }, "test")).toBeNull();
});

test("currency codes are normalised to upper case", () => {
  const parsed = parseUpstream({ rates: { eur: 0.86 } }, "test");
  expect(parsed!.rates.EUR).toBe(0.86);
});

test("a missing or unparseable timestamp falls back to today", () => {
  const today = new Date().toISOString().split("T")[0];
  expect(parseUpstream({ rates: { EUR: 0.86 } }, "test")!.asOf).toBe(today!);
  expect(
    parseUpstream({ rates: { EUR: 0.86 }, time_last_update_utc: "not a date" }, "test")!.asOf
  ).toBe(today!);
});

test("the base defaults to USD when the provider omits it", () => {
  expect(parseUpstream({ rates: { EUR: 0.86 } }, "test")!.base).toBe("USD");
});

// ── The shared cache, against Postgres ───────────────────────────────────────

const SAMPLE: RatesPayload = { base: "USD", rates: { USD: 1, EUR: 0.86 }, asOf: "2026-10-10", source: "test" };

async function clearRates() {
  await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: "rates:" } } });
}
beforeEach(clearRates);
afterAll(clearRates);

/** Deps whose upstream counts its calls and answers after `delayMs`. */
function stub(answer: () => RatesPayload, delayMs = 0) {
  let calls = 0;
  const deps: RatesDeps = {
    db: prisma,
    async fetchUpstream() {
      calls++;
      await new Promise((r) => setTimeout(r, delayMs));
      return answer();
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  return { deps, calls: () => calls };
}

test("a miss fetches once and keeps the rates for a day, by the database's clock", async () => {
  const { deps, calls } = stub(() => SAMPLE);
  expect(await getRates(deps)).toEqual(SAMPLE);
  expect(await getRates(deps)).toEqual(SAMPLE);
  expect(calls()).toBe(1);

  const [row] = await prisma.$queryRaw<{ ms: number }[]>`
    SELECT EXTRACT(EPOCH FROM ("expiresAt" - (statement_timestamp() AT TIME ZONE 'UTC'))) * 1000 AS ms
      FROM "CacheEntry" WHERE "key" = 'rates:latest'`;
  expect(Math.abs(Number(row!.ms) - CACHE_TTL_MS)).toBeLessThan(60_000);
});

test("concurrent misses share one upstream request", async () => {
  const { deps, calls } = stub(() => SAMPLE, 150);
  const results = await Promise.all(Array.from({ length: 8 }, () => getRates(deps)));
  expect(results.every((r) => r?.asOf === SAMPLE.asOf)).toBe(true);
  expect(calls()).toBe(1);
});

test("when the provider fails, the last good rates are served", async () => {
  await getRates(stub(() => SAMPLE).deps);
  // The day is over: only the fresh copy expires.
  await prisma.cacheEntry.delete({ where: { key: "rates:latest" } });
  const failing = stub(() => {
    throw new Error("provider down");
  });
  expect(await getRates(failing.deps)).toEqual(SAMPLE);
  expect(failing.calls()).toBe(1);
});

test("with no rates at all and the provider down, the route answers 503", async () => {
  const failing = stub(() => {
    throw new Error("provider down");
  });
  const res = await createRatesRouter(failing.deps).request("/");
  expect(res.status).toBe(503);
  // The failed refresh released its lock, so the next request may try again.
  expect(await prisma.cacheEntry.findUnique({ where: { key: "rates:refresh" } })).toBeNull();
});

test("the route serves cached rates as JSON", async () => {
  const { deps } = stub(() => SAMPLE);
  const res = await createRatesRouter(deps).request("/");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(SAMPLE);
});
