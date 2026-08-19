/**
 * Normalising a model's statement extraction.
 *
 * A vision model returns plausible-looking JSON, not trustworthy JSON: dates
 * come back in whatever format the statement used, amounts as strings with
 * currency symbols, categories invented on the spot, and occasionally a row
 * that is a running balance rather than a transaction. Everything it produces
 * is validated here before it can reach a database.
 *
 * Dependency-free so the validation can be tested without calling OpenAI.
 */

export const STATEMENT_CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Gym",
  "Subscriptions",
  "Bills",
  "Salary",
  "Other",
] as const;

/** Cap on rows accepted from one document, so a bad response can't flood. */
export const MAX_STATEMENT_ROWS = 500;

export interface StatementRow {
  dateISO: string;
  amount: number;
  type: "Expense" | "Income";
  category: string;
  note: string;
}

/** Coerce a model-supplied amount ("$1,234.56", "1 234,56", 42) to a number. */
export function coerceAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return isFinite(value) ? Math.abs(value) : null;
  }
  if (typeof value !== "string") return null;

  let s = value.replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  // Whichever separator comes last is the decimal point.
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // A lone comma with 1-2 trailing digits is a decimal point, else thousands.
    s = s.length - lastComma - 1 <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }

  const n = parseFloat(s);
  return isFinite(n) ? Math.abs(n) : null;
}

/** Accept only a real YYYY-MM-DD date. */
export function coerceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;

  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function coerceType(value: unknown, fallback: "Expense" | "Income"): "Expense" | "Income" {
  const s = String(value ?? "").toLowerCase();
  if (s === "income" || s === "credit" || s === "deposit") return "Income";
  if (s === "expense" || s === "debit" || s === "withdrawal") return "Expense";
  return fallback;
}

function coerceCategory(value: unknown): string {
  const s = String(value ?? "").trim();
  return (STATEMENT_CATEGORIES as readonly string[]).includes(s) ? s : "Other";
}

/**
 * Turn whatever the model returned into rows safe to show the user.
 *
 * Rows missing a usable date or amount are dropped rather than guessed at —
 * a statement import that invents a date is worse than one that skips a line
 * the user can add by hand.
 */
export function normaliseStatementRows(raw: unknown): StatementRow[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { transactions?: unknown })?.transactions)
      ? (raw as { transactions: unknown[] }).transactions
      : [];

  const rows: StatementRow[] = [];
  for (const item of list) {
    if (rows.length >= MAX_STATEMENT_ROWS) break;
    if (typeof item !== "object" || item === null) continue;

    const r = item as Record<string, unknown>;
    const dateISO = coerceDate(r.dateISO ?? r.date);
    const amount = coerceAmount(r.amount);
    if (!dateISO || amount === null || amount === 0) continue;

    // A negative amount means an outflow unless the model said otherwise.
    const signHint: "Expense" | "Income" =
      typeof r.amount === "number" && r.amount > 0 ? "Income" : "Expense";

    rows.push({
      dateISO,
      amount,
      type: coerceType(r.type, signHint),
      category: coerceCategory(r.category),
      note: String(r.note ?? r.description ?? "").slice(0, 200).trim(),
    });
  }
  return rows;
}
