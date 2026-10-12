import { test, expect } from "bun:test";
import { billDueNotification, formatBillAmount } from "./bill-notify";
import { NOTIFY_LOCALES } from "./household-notify";

const rent = { name: "Rent", amount: 1200, currency: "EUR", currencySymbol: "€", overdue: false };

test("bill push language: every supported locale has its own title and body, carrying the bill's name and amount", () => {
  const rendered = NOTIFY_LOCALES.map((locale) => billDueNotification(locale, rent));
  for (const { title, body } of rendered) {
    expect(title.length).toBeGreaterThan(0);
    expect(body).toContain("Rent");
    expect(body).toMatch(/1.200/);
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("${");
  }
  // Four languages, not English four times.
  expect(new Set(rendered.map((r) => r.title)).size).toBe(NOTIFY_LOCALES.length);
  expect(new Set(rendered.map((r) => r.body)).size).toBe(NOTIFY_LOCALES.length);
});

test("bill push language: each language says it in its own words", () => {
  expect(billDueNotification("en", rent)).toEqual({ title: "Bill due 💸", body: '"Rent" — €1,200.00 is due today.' });
  expect(billDueNotification("fr", rent)).toEqual({
    title: "Facture à régler 💸",
    body: "« Rent » — 1 200,00 € à régler aujourd’hui.",
  });
  expect(billDueNotification("zh", { ...rent, currency: "CNY", currencySymbol: "¥" })).toEqual({
    title: "账单到期 💸",
    body: "“Rent”（¥1,200.00）今天到期。",
  });
  const ar = billDueNotification("ar", { ...rent, currency: "MAD", currencySymbol: "د.م." });
  expect(ar.title).toBe("فاتورة مستحقة 💸");
  expect(ar.body).toContain("«Rent»");
  expect(ar.body).toContain("تُستحق اليوم");
});

test("bill push language: an unknown or missing language falls back to English", () => {
  for (const junk of [null, undefined, "", "de", "EN", 5, {}]) {
    expect(billDueNotification(junk, rent)).toEqual({ title: "Bill due 💸", body: '"Rent" — €1,200.00 is due today.' });
  }
});

test("bill push language: the amount is the user's currency, written as the app writes money in that language", () => {
  expect(formatBillAmount("en", 1200, "USD", "$")).toBe("$1,200.00");
  expect(formatBillAmount("en", 42, "EUR", "€")).toBe("€42.00");
  expect(formatBillAmount("fr", 42, "EUR", "€")).toBe("42,00 €");
  // The currency's own minor units: no yen cents.
  expect(formatBillAmount("en", 1200, "JPY", "¥")).toBe("¥1,200");
  // ar-MA, as the app: Western digits, never ١٢٠٠.
  expect(formatBillAmount("ar", 1200, "MAD", "د.م.")).toMatch(/1\.200,00/);
  expect(formatBillAmount("ar", 1200, "MAD", "د.م.")).not.toMatch(/[٠-٩]/);
  // A lower-case code is still the code.
  expect(formatBillAmount("en", 5, "eur", null)).toBe("€5.00");
});

test("bill push language: a currency that cannot be formatted falls back to the saved symbol, then to $", () => {
  expect(formatBillAmount("en", 42, "not-a-code", "€")).toBe("€42.00");
  expect(formatBillAmount("fr", 42, null, "€")).toBe("42,00 €");
  expect(formatBillAmount("en", 42, null, null)).toBe("$42.00");
  expect(formatBillAmount("en", 42, "", "  ")).toBe("$42.00");
});

test("bill push language: a bill past its due day says it is overdue, in every language", () => {
  const overdue = NOTIFY_LOCALES.map((l) => billDueNotification(l, { ...rent, overdue: true }).body);
  const dueToday = NOTIFY_LOCALES.map((l) => billDueNotification(l, rent).body);
  expect(overdue[0]).toBe('"Rent" — €1,200.00 is overdue.');
  for (let i = 0; i < overdue.length; i++) {
    expect(overdue[i]).not.toBe(dueToday[i]);
    expect(overdue[i]).toContain("Rent");
  }
});
