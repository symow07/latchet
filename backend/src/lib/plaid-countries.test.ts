import { test, expect } from "bun:test";
import {
  countryCodesForCurrency,
  parseEnabledCountries,
  PLAID_SUPPORTED_COUNTRIES,
} from "./plaid-countries";

const ALL = [...PLAID_SUPPORTED_COUNTRIES];

test("a US user gets US institutions", () => {
  expect(countryCodesForCurrency("USD", ALL)).toEqual(["US"]);
});

test("a euro user gets euro-zone institutions, not US ones", () => {
  // The hardcoded ["US"] meant a French user was only ever offered US banks.
  const codes = countryCodesForCurrency("EUR", ALL);
  expect(codes).toContain("FR");
  expect(codes).toContain("IE");
  expect(codes).not.toContain("US");
});

test("currency matching is case-insensitive", () => {
  expect(countryCodesForCurrency("gbp", ALL)).toEqual(["GB"]);
});

test("the enabled list bounds what is requested", () => {
  // Asking Plaid for a country the account is not enabled for is an error.
  expect(countryCodesForCurrency("EUR", ["US", "FR"])).toEqual(["FR"]);
});

test("a currency Plaid does not cover falls back to everything enabled", () => {
  // Morocco and China have no Plaid coverage — show what we can rather than
  // silently defaulting to US.
  expect(countryCodesForCurrency("MAD", ["US", "FR"])).toEqual(["US", "FR"]);
  expect(countryCodesForCurrency("CNY", ["GB"])).toEqual(["GB"]);
});

test("a covered currency with no enabled overlap falls back to everything enabled", () => {
  expect(countryCodesForCurrency("CAD", ["US"])).toEqual(["US"]);
});

test("a missing currency falls back rather than throwing", () => {
  expect(countryCodesForCurrency(null, ["US"])).toEqual(["US"]);
  expect(countryCodesForCurrency(undefined, ["GB", "IE"])).toEqual(["GB", "IE"]);
});

test("the enabled list is parsed and validated", () => {
  expect(parseEnabledCountries("US,CA,GB")).toEqual(["US", "CA", "GB"]);
  expect(parseEnabledCountries(" us , fr ")).toEqual(["US", "FR"]);
  // Codes Plaid does not support are dropped.
  expect(parseEnabledCountries("US,MA,CN")).toEqual(["US"]);
});

test("an empty or nonsense enabled list defaults to US", () => {
  expect(parseEnabledCountries("")).toEqual(["US"]);
  expect(parseEnabledCountries(undefined)).toEqual(["US"]);
  expect(parseEnabledCountries("XX,ZZ")).toEqual(["US"]);
});

test("Plaid's supported list is the documented 20 countries", () => {
  expect(PLAID_SUPPORTED_COUNTRIES.length).toBe(20);
});
