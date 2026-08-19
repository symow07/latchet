import { test, expect } from "bun:test";
import {
  normaliseStatementRows,
  coerceAmount,
  coerceDate,
  MAX_STATEMENT_ROWS,
} from "./statement-extract";

test("amounts come back from whatever notation the model used", () => {
  expect(coerceAmount(42.5)).toBe(42.5);
  expect(coerceAmount("$1,234.56")).toBe(1234.56);
  expect(coerceAmount("1.234,56 €")).toBe(1234.56);
  expect(coerceAmount("1 234,56 MAD")).toBe(1234.56);
  expect(coerceAmount("-84.32")).toBe(84.32);
});

test("a lone comma is read as decimal or thousands by its position", () => {
  expect(coerceAmount("12,50")).toBe(12.5);
  expect(coerceAmount("1,234")).toBe(1234);
});

test("unusable amounts are rejected, not coerced to zero", () => {
  expect(coerceAmount("n/a")).toBeNull();
  expect(coerceAmount("")).toBeNull();
  expect(coerceAmount(null)).toBeNull();
  expect(coerceAmount(NaN)).toBeNull();
});

test("only a real calendar date is accepted", () => {
  expect(coerceDate("2026-08-18")).toBe("2026-08-18");
  expect(coerceDate("2026-02-31")).toBeNull();
  expect(coerceDate("2026-13-01")).toBeNull();
  expect(coerceDate("18/08/2026")).toBeNull();
  expect(coerceDate(undefined)).toBeNull();
});

test("a well-formed response is normalised", () => {
  const rows = normaliseStatementRows({
    transactions: [
      { dateISO: "2026-08-18", amount: "84.32", type: "Expense", category: "Food", note: "REWE" },
      { dateISO: "2026-08-19", amount: 2500, type: "Income", category: "Salary", note: "Payroll" },
    ],
  });

  expect(rows).toEqual([
    { dateISO: "2026-08-18", amount: 84.32, type: "Expense", category: "Food", note: "REWE" },
    { dateISO: "2026-08-19", amount: 2500, type: "Income", category: "Salary", note: "Payroll" },
  ]);
});

test("a bare array is accepted as well as a wrapped one", () => {
  const rows = normaliseStatementRows([
    { date: "2026-08-18", amount: 10, description: "Coffee" },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.note).toBe("Coffee");
});

test("rows without a usable date or amount are dropped, not guessed", () => {
  // Inventing a date is worse than skipping a line the user can add by hand.
  const rows = normaliseStatementRows({
    transactions: [
      { dateISO: "not a date", amount: 10 },
      { dateISO: "2026-08-18", amount: "balance carried forward" },
      { dateISO: "2026-08-18", amount: 0 },
      { dateISO: "2026-08-18", amount: 12 },
    ],
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.amount).toBe(12);
});

test("an invented category falls back to Other", () => {
  const [row] = normaliseStatementRows({
    transactions: [
      { dateISO: "2026-08-18", amount: 10, category: "Artisanal Cheese", note: "x" },
    ],
  });
  expect(row!.category).toBe("Other");
});

test("direction words the model might use are understood", () => {
  const rows = normaliseStatementRows({
    transactions: [
      { dateISO: "2026-08-18", amount: 10, type: "debit" },
      { dateISO: "2026-08-18", amount: 10, type: "credit" },
    ],
  });
  expect(rows.map((r) => r.type)).toEqual(["Expense", "Income"]);
});

test("a negative number implies an expense when no type is given", () => {
  const [expense] = normaliseStatementRows({
    transactions: [{ dateISO: "2026-08-18", amount: -10 }],
  });
  expect(expense!.type).toBe("Expense");
  expect(expense!.amount).toBe(10);

  const [income] = normaliseStatementRows({
    transactions: [{ dateISO: "2026-08-18", amount: 10 }],
  });
  expect(income!.type).toBe("Income");
});

test("the row count is capped", () => {
  const many = Array.from({ length: MAX_STATEMENT_ROWS + 50 }, () => ({
    dateISO: "2026-08-18",
    amount: 1,
  }));
  expect(normaliseStatementRows({ transactions: many })).toHaveLength(MAX_STATEMENT_ROWS);
});

test("garbage never throws", () => {
  expect(normaliseStatementRows(null)).toEqual([]);
  expect(normaliseStatementRows("nope")).toEqual([]);
  expect(normaliseStatementRows({})).toEqual([]);
  expect(normaliseStatementRows({ transactions: [null, 42, "x"] })).toEqual([]);
});

test("notes are bounded", () => {
  const [row] = normaliseStatementRows({
    transactions: [{ dateISO: "2026-08-18", amount: 1, note: "x".repeat(500) }],
  });
  expect(row!.note.length).toBe(200);
});
