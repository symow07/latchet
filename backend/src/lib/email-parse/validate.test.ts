import { describe, expect, test } from "bun:test";
import { findMoney, parseAmountString } from "./money";
import { findDates, parseDateLoose, addPeriod } from "./dates";
import { computeConfidence, validateFinding, type ValidationContext } from "./validate";
import { subjectLabel } from "./label";
import type { CurrencyContext } from "./currency";

const NOW = new Date("2026-10-12T12:00:00Z");
const PLAIN: CurrencyContext = { chinese: false, japanese: false, usDollar: false, dollarCode: null, emirati: false };

function ctx(text: string, over: Partial<ValidationContext> = {}): ValidationContext {
  return { now: NOW, subject: "Your receipt", senderDomain: "example.com", emailDateISO: "2026-10-12", currency: PLAIN, text, monthFirst: false, ...over };
}

const one = (text: string, c: CurrencyContext = PLAIN) => findMoney(text, c).map((m) => [m.amount, m.currency]);

describe("validation", () => {
  test("finding validation: number formats 1.234,56 · 1,234.56 · 1 234,56 (all three spaces) · 1'234.56", () => {
    expect(parseAmountString("1.234,56")).toBe(1234.56);
    expect(parseAmountString("1,234.56")).toBe(1234.56);
    expect(parseAmountString("1 234,56")).toBe(1234.56);
    expect(parseAmountString("1 234,56")).toBe(1234.56);
    expect(parseAmountString("1 234,56")).toBe(1234.56);
    expect(parseAmountString("1'234.56")).toBe(1234.56);
    expect(parseAmountString("12,99")).toBe(12.99);
    expect(parseAmountString("12.99")).toBe(12.99);
    expect(parseAmountString("1,234")).toBe(1234);
    expect(parseAmountString("1.234.567,89")).toBe(1234567.89);
    expect(parseAmountString("12,500", "KWD")).toBe(12.5);
    expect(parseAmountString("1.2.3")).toBeNull();
    expect(parseAmountString("abc")).toBeNull();
  });

  test("finding validation: currency symbols and codes beside amounts, before or after", () => {
    expect(one("Total 12,99 € TTC")).toEqual([[12.99, "EUR"]]);
    expect(one("€12.99/month")).toEqual([[12.99, "EUR"]]);
    expect(one("US$ 9.99 and C$ 12.50 and CA$4 and A$7")).toEqual([[9.99, "USD"], [12.5, "CAD"], [4, "CAD"], [7, "AUD"]]);
    expect(one("£95.00 (VAT included)")).toEqual([[95, "GBP"]]);
    expect(one("Montant : 1 234,56 EUR")).toEqual([[1234.56, "EUR"]]);
    expect(one("149,00 DH · 99 Dhs · 39 درهم · 249,00 د.م. · MAD 50")).toEqual([[149, "MAD"], [99, "MAD"], [39, "MAD"], [249, "MAD"], [50, "MAD"]]);
    expect(one("RMB 25 / CNY 30 / 人民币40元")).toEqual([[25, "CNY"], [30, "CNY"], [40, "CNY"]]);
    expect(one("-$5.00 refund and ($3.00)", { ...PLAIN, usDollar: true }).length).toBe(2);
    expect(findMoney("-$5.00 refund and ($3.00)", { ...PLAIN, usDollar: true }).every((m) => m.negative)).toBe(true);
  });

  test("finding validation: ¥ is CNY only with Chinese context, JPY when Japanese is evident, otherwise unknown; 元 is CNY", () => {
    expect(one("¥25.00")).toEqual([[25, null]]);
    expect(one("¥25.00", { ...PLAIN, chinese: true })).toEqual([[25, "CNY"]]);
    expect(one("¥1,200", { ...PLAIN, japanese: true })).toEqual([[1200, "JPY"]]);
    expect(one("扣款金额：25.00元", { ...PLAIN, chinese: true })).toEqual([[25, "CNY"]]);
    expect(one("Dhs 50", { ...PLAIN, emirati: true })).toEqual([[50, "AED"]]);
  });

  test("finding validation: an unknown or unevidenced currency becomes null — never a guessed USD", () => {
    const base = { kind: "receipt", amount: 12.99 };
    expect(validateFinding({ ...base, currency: "XYZ" }, ctx("Total 12.99 XYZ"), "ai")?.currency).toBeNull();
    // The AI says USD but the email shows euros.
    expect(validateFinding({ ...base, currency: "USD" }, ctx("Total 12,99 €"), "ai")?.currency).toBeNull();
    expect(validateFinding({ ...base, currency: "eur" }, ctx("Total 12,99 €"), "ai")?.currency).toBe("EUR");
    expect(validateFinding({ ...base, currency: "RMB" }, ctx("扣款金额：12.99元", { currency: { ...PLAIN, chinese: true } }), "ai")?.currency).toBe("CNY");
    // No marker at all: unknown stays unknown.
    expect(validateFinding({ ...base, currency: "USD" }, ctx("Amount: 12.99"), "ai")?.currency).toBeNull();
    expect(validateFinding({ ...base, currency: 42 }, ctx("Total 12,99 €"), "ai")?.currency).toBeNull();
  });

  test("finding validation: amounts are finite, positive, under the ceiling and rounded to cents; text amounts are parsed", () => {
    const v = (amount: unknown, text = "Total 12,99 €") => validateFinding({ kind: "receipt", amount, currency: "EUR" }, ctx(text), "ai")?.amount;
    expect(v(12.994)).toBe(12.99);
    expect(v(12.995)).toBe(13);
    expect(v("1.234,56 €")).toBe(1234.56);
    expect(v("€12.99")).toBe(12.99);
    expect(v(-5)).toBeNull();
    expect(v(0)).toBeNull();
    expect(v(Number.NaN)).toBeNull();
    expect(v(Number.POSITIVE_INFINITY)).toBeNull();
    expect(v(5_000_000)).toBeNull();
    expect(v("twelve")).toBeNull();
    expect(validateFinding({ kind: "receipt", amount: 3_500_000, currency: "VND" }, ctx("3.500.000 VND"), "ai")?.amount).toBe(3_500_000);
  });

  test("finding validation: dates in many forms and languages; impossible or far-off dates become null", () => {
    const opts = { monthFirst: false, refISO: "2026-10-12", now: NOW };
    expect(parseDateLoose("2026-11-12", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12 octobre 2026", opts)).toBe("2026-10-12");
    expect(parseDateLoose("1er décembre 2026", opts)).toBe("2026-12-01");
    expect(parseDateLoose("2026年11月12日", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12/11/2026", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12/11/2026", { ...opts, monthFirst: true })).toBe("2026-12-11");
    expect(parseDateLoose("25/11/2026", { ...opts, monthFirst: true })).toBe("2026-11-25");
    expect(parseDateLoose("November 12, 2026", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12 نوفمبر 2026", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12 نونبر 2026", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12 de noviembre de 2026", opts)).toBe("2026-11-12");
    expect(parseDateLoose("12. November 2026", opts)).toBe("2026-11-12");
    expect(parseDateLoose("2026-02-30", opts)).toBeNull();
    expect(parseDateLoose("31/04/2026", opts)).toBeNull();
    expect(parseDateLoose("2031-01-01", opts)).toBeNull();
    expect(parseDateLoose("1999-01-01", opts)).toBeNull();
    expect(parseDateLoose("soon", opts)).toBeNull();
    // A year-less date takes the year that puts it nearest the email.
    expect(findDates("renews on Jan 3", { ...opts, refISO: "2026-12-28" })[0]?.iso).toBe("2027-01-03");
    expect(addPeriod("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(addPeriod("2028-02-29", "yearly")).toBe("2029-02-28");
  });

  test("finding validation: kind, cadence and billedVia come from their enums only", () => {
    expect(validateFinding({ kind: "subscription" }, ctx(""), "ai")).toBeNull();
    expect(validateFinding(null, ctx(""), "ai")).toBeNull();
    expect(validateFinding([1, 2], ctx(""), "ai")).toBeNull();
    const f = validateFinding({ kind: "renewal", cadence: "every month", billedVia: "stripe", merchant: "jane@example.com" }, ctx(""), "ai")!;
    expect(f.cadence).toBe("unknown");
    expect(f.billedVia).toBeNull();
    expect(f.merchant).toBeNull();
    const g = validateFinding({ kind: "renewal", cadence: "quarterly", billedVia: "apple", merchant: "  Netflix, Inc. " }, ctx(""), "ai")!;
    expect(g).toMatchObject({ cadence: "quarterly", billedVia: "apple", merchant: "Netflix" });
  });

  test("finding validation: a cancellation carries no next charge; a next charge must follow the charge; previousAmount only for price changes", () => {
    const c = validateFinding({ kind: "cancellation", merchant: "Deezer", nextChargeISO: "2026-11-03", chargedISO: "2026-10-03" }, ctx(""), "rules")!;
    expect(c.nextChargeISO).toBeNull();
    expect(c.chargedISO).toBeNull();
    const r = validateFinding({ kind: "renewal", chargedISO: "2026-10-12", nextChargeISO: "2026-10-01", previousAmount: 9 }, ctx(""), "rules")!;
    expect(r.nextChargeISO).toBeNull();
    expect(r.previousAmount).toBeNull();
    const p = validateFinding({ kind: "price_change", amount: 14.99, previousAmount: "13,49 €", currency: "EUR" }, ctx("de 13,49 € à 14,99 €"), "rules")!;
    expect(p.previousAmount).toBe(13.49);
    expect(validateFinding({ kind: "price_change", amount: 14.99, previousAmount: 14.99 }, ctx(""), "rules")!.previousAmount).toBeNull();
  });

  test("finding validation: confidence reflects how much was found, and the label strips digits", () => {
    const base = { kind: "receipt" as const, merchant: null, senderDomain: null, billedVia: null, amount: null, currency: null, cadence: "unknown" as const, chargedISO: null, emailDateISO: null, nextChargeISO: null, trialEndsISO: null, previousAmount: null };
    const empty = computeConfidence(base);
    const full = computeConfidence({ ...base, merchant: "Spotify", amount: 11.99, currency: "USD" });
    expect(empty).toBe(0.3);
    expect(full).toBe(1);
    expect(computeConfidence({ ...base, merchant: "Spotify" })).toBeGreaterThan(empty);
    expect(computeConfidence({ ...base, kind: "other", merchant: "X", amount: 3 })).toBeLessThanOrEqual(0.5);
    expect(subjectLabel("Your receipt for order #114-2937461 — $84.32")).toBe("Your receipt for order");
    expect(subjectLabel("您的订单12345已发货")).toBe("您的订单 已发货");
    expect(subjectLabel("فاتورتكم لشهر أكتوبر 2026")).toBe("فاتورتكم لشهر أكتوبر");
    expect(subjectLabel("a ".repeat(50)).length).toBeLessThanOrEqual(60);
    expect(subjectLabel("Invoice for jane.doe@example.com")).toBe("Invoice for");
  });
});
