import { describe, test, expect } from "bun:test";
import {
  countryCodesForCurrency,
  countryCodesForLink,
  isPlaidCountry,
  linkLanguage,
  normalizeRegion,
  parseEnabledCountries,
  PLAID_SUPPORTED_COUNTRIES,
} from "./plaid-countries";

const ALL = [...PLAID_SUPPORTED_COUNTRIES];

describe("plaid countries", () => {
  test("plaid countries: the phone's region wins over the app's currency", () => {
    // A French phone with the app set to dollars still banks in France.
    expect(countryCodesForLink({ region: "FR", currency: "USD" }, ALL)).toEqual(["FR"]);
    expect(countryCodesForLink({ region: "us", currency: "EUR" }, ALL)).toEqual(["US"]);
    expect(countryCodesForLink({ region: "CA", currency: "CAD" }, ALL)).toEqual(["CA"]);
  });

  test("plaid countries: the United Kingdom is GB, whichever way the device spells it", () => {
    expect(normalizeRegion("UK")).toBe("GB");
    expect(normalizeRegion("gb")).toBe("GB");
    expect(countryCodesForLink({ region: "UK", currency: "EUR" }, ALL)).toEqual(["GB"]);
    expect(isPlaidCountry("uk")).toBe(true);
  });

  test("plaid countries: a region we are not enabled for falls back to the currency's countries", () => {
    // Enabled for the US, Canada and France only: an Irish phone in euros is
    // offered France, the enabled euro country, rather than the US.
    const enabled = ["US", "CA", "FR"];
    expect(countryCodesForLink({ region: "IE", currency: "EUR" }, enabled)).toEqual(["FR"]);
  });

  test("plaid countries: a region Plaid does not serve uses the currency, then everything enabled", () => {
    // Morocco and China have no Plaid coverage. A Moroccan phone in euros may
    // well bank in France; one in dirhams gets every enabled country.
    expect(countryCodesForLink({ region: "MA", currency: "EUR" }, ["US", "FR", "DE"])).toEqual(["FR", "DE"]);
    expect(countryCodesForLink({ region: "MA", currency: "MAD" }, ["US", "GB"])).toEqual(["US", "GB"]);
    expect(countryCodesForLink({ region: "CN", currency: "CNY" }, ["GB"])).toEqual(["GB"]);
    expect(isPlaidCountry("MA")).toBe(false);
    expect(isPlaidCountry("CN")).toBe(false);
  });

  test("plaid countries: no region and no currency still yields a valid, non-empty request", () => {
    expect(countryCodesForLink({}, ["GB", "IE"])).toEqual(["GB", "IE"]);
    expect(countryCodesForLink({ region: null, currency: null }, [])).toEqual(["US"]);
    expect(countryCodesForLink({ region: "not a region", currency: "" }, ["CA"])).toEqual(["CA"]);
  });

  test("plaid countries: every result stays inside the enabled list", () => {
    const enabled = ["GB", "FR", "DE"];
    for (const region of [null, "US", "CA", "GB", "FR", "IE", "MA", "CN", "SE"]) {
      for (const currency of [null, "USD", "EUR", "GBP", "SEK", "MAD"]) {
        const codes = countryCodesForLink({ region, currency }, enabled);
        expect(codes.length).toBeGreaterThan(0);
        for (const c of codes) expect(enabled).toContain(c);
      }
    }
  });

  test("plaid countries: the US, Canada, the UK and the EU countries are all supported", () => {
    expect(PLAID_SUPPORTED_COUNTRIES.length).toBe(20);
    for (const c of ["US", "CA", "GB", "FR", "DE", "IE", "ES", "IT", "NL", "BE", "AT", "PT", "PL", "SE", "DK", "FI", "EE", "LV", "LT", "NO"]) {
      expect(isPlaidCountry(c)).toBe(true);
    }
  });

  test("plaid countries: the enabled list is parsed, validated and de-duplicated", () => {
    expect(parseEnabledCountries("US,CA,GB")).toEqual(["US", "CA", "GB"]);
    expect(parseEnabledCountries(" us , fr ")).toEqual(["US", "FR"]);
    expect(parseEnabledCountries("US,UK,GB")).toEqual(["US", "GB"]);
    // Codes Plaid does not support are dropped.
    expect(parseEnabledCountries("US,MA,CN")).toEqual(["US"]);
    expect(parseEnabledCountries("")).toEqual(["US"]);
    expect(parseEnabledCountries(undefined)).toEqual(["US"]);
    expect(parseEnabledCountries("XX,ZZ")).toEqual(["US"]);
  });
});

describe("country codes from the currency alone", () => {
  test("a euro user gets euro-area institutions, not US ones", () => {
    const codes = countryCodesForCurrency("EUR", ALL);
    expect(codes).toContain("FR");
    expect(codes).toContain("IE");
    expect(codes).not.toContain("US");
  });

  test("currency matching is case-insensitive and bounded by the enabled list", () => {
    expect(countryCodesForCurrency("gbp", ALL)).toEqual(["GB"]);
    expect(countryCodesForCurrency("EUR", ["US", "FR"])).toEqual(["FR"]);
  });

  test("a covered currency with no enabled overlap falls back to everything enabled", () => {
    expect(countryCodesForCurrency("CAD", ["US"])).toEqual(["US"]);
    expect(countryCodesForCurrency(undefined, ["GB", "IE"])).toEqual(["GB", "IE"]);
  });
});

test("Link is shown in French to French readers and in English to everyone else", () => {
  expect(linkLanguage("fr")).toBe("fr");
  expect(linkLanguage("fr-CA")).toBe("fr");
  expect(linkLanguage("en")).toBe("en");
  expect(linkLanguage("zh")).toBe("en");
  expect(linkLanguage("ar")).toBe("en");
  expect(linkLanguage(null)).toBe("en");
});
