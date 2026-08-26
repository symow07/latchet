import { test, expect } from "bun:test";
import {
  normaliseVoiceRows,
  voiceExtractionPrompt,
  MAX_VOICE_ROWS,
} from "./voice-extract";
import { STATEMENT_CATEGORIES } from "./statement-extract";

const TODAY = "2026-08-26";

test("a spoken transaction with no date lands on the speaker's today", () => {
  // The difference from a statement: silence about the date means "now", not
  // a failed extraction, so the row must survive rather than be dropped.
  const rows = normaliseVoiceRows(
    { transactions: [{ amount: 12, category: "Food", note: "lunch" }] },
    TODAY,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.dateISO).toBe(TODAY);
  expect(rows[0]!.type).toBe("Expense");
});

test("a date the model resolved wins over today", () => {
  const rows = normaliseVoiceRows(
    { transactions: [{ amount: 40, dateISO: "2026-08-24", note: "petrol" }] },
    TODAY,
  );
  expect(rows[0]!.dateISO).toBe("2026-08-24");
});

test("today is the speaker's, not the server's", () => {
  // Someone in Shanghai recording at 08:00 is a day ahead of a UTC server;
  // defaulting to the server's date would file the morning's coffee under
  // yesterday.
  const rows = normaliseVoiceRows({ transactions: [{ amount: 5 }] }, "2026-08-27");
  expect(rows[0]!.dateISO).toBe("2026-08-27");
});

test("a row with no usable amount is dropped, never guessed", () => {
  // Speech is the least reliable input the app has. Inventing a figure here
  // would put a wrong number into someone's finances silently.
  const rows = normaliseVoiceRows(
    {
      transactions: [
        { amount: null, note: "something about lunch" },
        { amount: 0, note: "free sample" },
        { note: "no amount at all" },
        { amount: "not a number", note: "mumbling" },
        { amount: 9.5, note: "coffee" },
      ],
    },
    TODAY,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.amount).toBe(9.5);
});

test("income is recognised, and expense is the default", () => {
  const rows = normaliseVoiceRows(
    {
      transactions: [
        { amount: 2000, type: "Income", note: "salary" },
        { amount: 30, note: "groceries" },
        { amount: 15, type: "nonsense", note: "unclear" },
      ],
    },
    TODAY,
  );
  expect(rows.map((r) => r.type)).toEqual(["Income", "Expense", "Expense"]);
});

test("an invented category falls back rather than reaching the database", () => {
  const rows = normaliseVoiceRows(
    { transactions: [{ amount: 20, category: "Artisanal Cheese" }] },
    TODAY,
  );
  expect(rows[0]!.category).toBe("Other");
});

test("amounts arrive in whatever notation the speaker's locale produced", () => {
  const rows = normaliseVoiceRows(
    {
      transactions: [
        { amount: "12,50" },
        { amount: "1 234,56 MAD" },
        { amount: "-84.32" },
      ],
    },
    TODAY,
  );
  expect(rows.map((r) => r.amount)).toEqual([12.5, 1234.56, 84.32]);
});

test("a bare array is accepted as well as a wrapped one", () => {
  expect(normaliseVoiceRows([{ amount: 7 }], TODAY)).toHaveLength(1);
  expect(normaliseVoiceRows({ transactions: [{ amount: 7 }] }, TODAY)).toHaveLength(1);
});

test("junk in gives an empty list out, not a throw", () => {
  for (const junk of [null, undefined, 0, "", "nope", { transactions: "no" }, [1, 2, 3]]) {
    expect(normaliseVoiceRows(junk, TODAY)).toEqual([]);
  }
});

test("a runaway response is capped", () => {
  const many = Array.from({ length: MAX_VOICE_ROWS + 25 }, () => ({ amount: 1 }));
  expect(normaliseVoiceRows({ transactions: many }, TODAY)).toHaveLength(MAX_VOICE_ROWS);
});

test("notes are trimmed and bounded", () => {
  const rows = normaliseVoiceRows(
    { transactions: [{ amount: 5, note: "  " + "x".repeat(400) + "  " }] },
    TODAY,
  );
  expect(rows[0]!.note.length).toBe(200);
});

test("the prompt names the categories the validator actually accepts", () => {
  // If these drift apart the model is told to use a category that
  // coerceCategory will silently rewrite to "Other".
  const prompt = voiceExtractionPrompt(TODAY, STATEMENT_CATEGORIES);
  for (const c of STATEMENT_CATEGORIES) {
    expect(prompt).toContain(c);
  }
  expect(prompt).toContain(TODAY);
  expect(prompt).toContain("YYYY-MM-DD");
});
