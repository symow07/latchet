import { test, expect } from "bun:test";
import { parseUpstream } from "./rates";

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
