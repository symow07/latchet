import { describe, test, expect } from "bun:test";
import { LOCALES, SYNC_ROW_SCHEMAS, parseIsoTimestamp, parsePushRow, toWireTimestamp } from "./schemas";
import { SYNC_ENTITIES } from "./constants";

describe("timestamps", () => {
  test("ISO date-times with a zone parse to epoch milliseconds; the wire form always has milliseconds", () => {
    expect(parseIsoTimestamp("2026-10-11T08:00:00.123Z")).toBe(Date.UTC(2026, 9, 11, 8, 0, 0, 123));
    expect(parseIsoTimestamp("2026-10-11T10:00:00+02:00")).toBe(Date.UTC(2026, 9, 11, 8));
    expect(parseIsoTimestamp("2026-10-11T08:00:00.123456789Z")).toBe(Date.UTC(2026, 9, 11, 8, 0, 0, 123));
    expect(parseIsoTimestamp("2026-10-11")).toBe(Date.UTC(2026, 9, 11));
    expect(parseIsoTimestamp("1970-01-01T00:00:00.000Z")).toBe(0);
    expect(toWireTimestamp(Date.UTC(2026, 9, 11, 8))).toBe("2026-10-11T08:00:00.000Z");
  });

  test("a time with no zone, a non-date and an impossible date are refused, not guessed", () => {
    for (const bad of ["2026-10-11T08:00:00", "yesterday", "2026-02-31", "2026-13-01T00:00:00Z", "1760169600000", ""]) {
      expect(parseIsoTimestamp(bad)).toBeNull();
    }
  });
});

describe("row schemas", () => {
  test("SYNC_ROW_SCHEMAS lists exactly the I-WIRE fields of each entity", () => {
    const fields = Object.fromEntries(SYNC_ENTITIES.map((e) => [e, Object.keys(SYNC_ROW_SCHEMAS[e].shape).sort()]));
    expect(fields).toEqual({
      settings: ["currency", "currencySymbol", "hourlyValue", "locale", "monthlyBudget", "monthlyIncome",
        "primaryGoal", "savingsGoal", "showTimeCost", "spendingStyle", "startingBalance"],
      categories: ["color", "createdAt", "icon"],
      accounts: ["color", "createdAt", "currency", "icon", "isDefault", "name", "openingBalance", "type"],
      transactions: ["accountId", "amount", "category", "createdAt", "currency", "dateISO", "isImpulse", "note", "type"],
      subscriptions: ["cadence", "cancelNotes", "cancelUrl", "confidenceScore", "createdAt", "currency", "lastChargedAt",
        "merchantDisplay", "merchantNormalized", "nextExpectedAt", "source", "status", "typicalAmount"],
    });
  });

  test("the sync locales are the ones PUT /settings accepts (and locale-parity ties those to the app)", async () => {
    const source = await Bun.file(new URL("../../routes/settings.ts", import.meta.url)).text();
    const listed = source.match(/locale:\s*z\.enum\(\[([^\]]*)\]\)/)![1]!;
    expect([...listed.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort()).toEqual([...LOCALES].sort());
  });
});

describe("parsePushRow", () => {
  const tx = {
    id: "tx_1", clientUpdatedAt: "2026-10-11T08:00:00.000Z", amount: 12.5, category: "Food", type: "Expense",
    isImpulse: false, note: null, dateISO: "2026-10-11", accountId: null, currency: "USD", createdAt: "2026-10-11T07:00:00.000Z",
  };

  test("a whole row parses, timestamps to milliseconds; fields the protocol does not carry are dropped", () => {
    const parsed = parsePushRow("transactions", { ...tx, balance: 999, dirty: 1 });
    expect(parsed).toEqual({
      ok: true,
      row: {
        id: "tx_1", clientUpdatedAt: Date.UTC(2026, 9, 11, 8), deleted: false,
        values: { amount: 12.5, category: "Food", type: "Expense", isImpulse: false, note: null, dateISO: "2026-10-11",
          accountId: null, currency: "USD", createdAt: Date.UTC(2026, 9, 11, 7) },
      },
    });
  });

  test("a delete needs only its id and time", () => {
    expect(parsePushRow("accounts", { id: "acc_1", clientUpdatedAt: "2026-10-11T08:00:00.000Z", deleted: true }))
      .toEqual({ ok: true, row: { id: "acc_1", clientUpdatedAt: Date.UTC(2026, 9, 11, 8), deleted: true } });
  });

  test("a row missing a field, out of range or with unstorable text is invalid under the id it was sent with", () => {
    const { note: _n, ...noNote } = tx;
    expect(parsePushRow("transactions", noNote)).toEqual({ ok: false, id: "tx_1" });
    expect(parsePushRow("transactions", { ...tx, amount: 0 })).toEqual({ ok: false, id: "tx_1" });
    expect(parsePushRow("transactions", { ...tx, note: "a\u0000b" })).toEqual({ ok: false, id: "tx_1" });
    expect(parsePushRow("transactions", { ...tx, note: "half a pair \uD83D" })).toEqual({ ok: false, id: "tx_1" });
    expect(parsePushRow("transactions", { ...tx, note: "a whole pair 🐾" }).ok).toBe(true);
    expect(parsePushRow("transactions", { ...tx, clientUpdatedAt: "2026-10-11T08:00:00" })).toEqual({ ok: false, id: "tx_1" });
    expect(parsePushRow("transactions", { ...tx, id: 42 })).toEqual({ ok: false, id: "42" });
    expect(parsePushRow("transactions", "nonsense")).toEqual({ ok: false, id: "" });
  });

  test("the settings row is always 'settings', and a category id is its 1–50 character name", () => {
    const settings = {
      clientUpdatedAt: "2026-10-11T08:00:00.000Z", monthlyBudget: 0, startingBalance: 0, hourlyValue: 0,
      showTimeCost: false, currency: "USD", currencySymbol: "$", monthlyIncome: 0, savingsGoal: 0,
      spendingStyle: "moderate", primaryGoal: "track", locale: "ar",
    };
    expect(parsePushRow("settings", { ...settings, id: "settings" }).ok).toBe(true);
    expect(parsePushRow("settings", { ...settings, id: "settings_user1" }).ok).toBe(false);
    expect(parsePushRow("settings", { ...settings, id: "settings", locale: "de" }).ok).toBe(false);

    const cat = { clientUpdatedAt: "2026-10-11T08:00:00.000Z", icon: "🐾", color: "#8A5F45", createdAt: "2026-10-11T08:00:00.000Z" };
    expect(parsePushRow("categories", { ...cat, id: "Pets" }).ok).toBe(true);
    expect(parsePushRow("categories", { ...cat, id: "x".repeat(51) }).ok).toBe(false);
  });
});
