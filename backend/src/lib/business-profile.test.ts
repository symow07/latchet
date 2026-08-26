import { test, expect } from "bun:test";
import { buildBusinessProfileFields } from "./business-profile";

test("a field that was not sent is left alone", () => {
  // A screen that edits only the address must not wipe the tax id.
  expect(buildBusinessProfileFields({ address: "12 Rue de Paris" })).toEqual({
    address: "12 Rue de Paris",
  });
});

test("an emptied field is cleared, not stored as an empty string", () => {
  // Otherwise "" and "no value" render differently for no reason, and every
  // read site has to check for both.
  expect(buildBusinessProfileFields({ vatNumber: "" })).toEqual({ vatNumber: null });
  expect(buildBusinessProfileFields({ taxId: null })).toEqual({ taxId: null });
  expect(buildBusinessProfileFields({ address: "   " })).toEqual({ address: null });
});

test("text is trimmed", () => {
  expect(buildBusinessProfileFields({ taxId: "  FR123  " })).toEqual({ taxId: "FR123" });
});

test("the company name cannot be cleared", () => {
  // Every screen renders it; an empty one is a blank header, not an error.
  expect(buildBusinessProfileFields({ name: "" })).toEqual({});
  expect(buildBusinessProfileFields({ name: "   " })).toEqual({});
});

test("the company name is trimmed when it is set", () => {
  expect(buildBusinessProfileFields({ name: "  Acme  " })).toEqual({ name: "Acme" });
});

test("clearing the fiscal year start is distinct from not sending it", () => {
  expect(buildBusinessProfileFields({ fiscalYearStartMonth: null })).toEqual({
    fiscalYearStartMonth: null,
  });
  expect(buildBusinessProfileFields({})).toEqual({});
});

test("a fiscal year start month is kept as given", () => {
  expect(buildBusinessProfileFields({ fiscalYearStartMonth: 4 })).toEqual({
    fiscalYearStartMonth: 4,
  });
});

test("an empty patch writes nothing", () => {
  // Guards against a PATCH with no body quietly blanking the row.
  expect(buildBusinessProfileFields({})).toEqual({});
});

test("several fields at once are all applied", () => {
  expect(
    buildBusinessProfileFields({ name: "Acme", address: "1 High St", vatNumber: "", taxId: "X1" })
  ).toEqual({ name: "Acme", address: "1 High St", vatNumber: null, taxId: "X1" });
});
