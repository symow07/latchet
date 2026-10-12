/**
 * One validator for every finding, whether the rules or the AI produced it.
 * Amounts are finite, positive, under a sane ceiling and rounded to cents (and
 * may arrive as text in any common format); a currency is a real ISO 4217 code
 * that the email itself evidences, or null; dates are real days within two
 * years of now; kind, cadence and billedVia come from their enums only.
 * Confidence is computed here from what survived, never taken on trust.
 */

import { amountCeiling, ISO_4217, normalizeCurrency, isWordlikeCode, type CurrencyContext } from "./currency";
import { parseDateLoose } from "./dates";
import { cleanMerchantName } from "./merchant";
import { findMoney, parseMoneyValue } from "./money";
import { subjectLabel } from "./label";
import { BILLED_VIA, CADENCES, EMAIL_KINDS, type BilledVia, type EmailFinding, type EmailKind, type FindingCadence } from "./types";

export interface ValidationContext {
  now: Date;
  subject: string;
  senderDomain: string | null;
  emailDateISO: string | null;
  currency: CurrencyContext;
  /** The email's normalised text: a currency must be evidenced by it. */
  text: string;
  monthFirst: boolean;
}

export interface RawFinding {
  kind?: unknown;
  merchant?: unknown;
  billedVia?: unknown;
  amount?: unknown;
  currency?: unknown;
  cadence?: unknown;
  chargedISO?: unknown;
  nextChargeISO?: unknown;
  trialEndsISO?: unknown;
  previousAmount?: unknown;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** An amount as a number or as written text; with any currency the text names. */
export function validateAmount(value: unknown, ctx: CurrencyContext): { amount: number; currency: string | null } | null {
  let amount: number | null = null;
  let currency: string | null = null;
  if (typeof value === "number") amount = value;
  else if (typeof value === "string") {
    const parsed = parseMoneyValue(value, ctx);
    if (parsed) ({ amount, currency } = parsed);
  }
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const rounded = round2(amount);
  if (rounded <= 0) return null;
  return { amount: rounded, currency };
}

/** The currencies an email gives evidence of: markers beside amounts and codes in the text. */
export function evidencedCurrencies(text: string, ctx: CurrencyContext): Set<string> {
  const out = new Set<string>();
  for (const m of findMoney(text, ctx)) if (m.currency) out.add(m.currency);
  for (const m of text.matchAll(/(?<![\p{L}])([A-Z]{3})(?![\p{L}])/gu)) {
    const code = m[1]!;
    if (ISO_4217.has(code) && !isWordlikeCode(code)) out.add(code);
  }
  if (/人民币|RMB/.test(text) || (ctx.chinese && /[¥元]/.test(text))) out.add("CNY");
  if (/€|euros?\b/i.test(text)) out.add("EUR");
  if (/£/.test(text)) out.add("GBP");
  if (/US\$/.test(text) || (ctx.usDollar && /\$/.test(text))) out.add("USD");
  if (ctx.dollarCode && /\$/.test(text)) out.add(ctx.dollarCode);
  if (/درهم|دراهم|د\.م|(?<![\p{L}])(?:DH|Dhs|DHS|dirhams?)(?![\p{L}])/iu.test(text)) out.add(ctx.emirati ? "AED" : "MAD");
  if (ctx.japanese && /[¥円]/.test(text)) out.add("JPY");
  return out;
}

export function validateCurrency(value: unknown, ctx: ValidationContext): string | null {
  const code = normalizeCurrency(value, ctx.currency);
  if (!code) return null;
  return evidencedCurrencies(ctx.text, ctx.currency).has(code) ? code : null;
}

function validDate(value: unknown, ctx: ValidationContext): string | null {
  return parseDateLoose(value, {
    monthFirst: ctx.monthFirst,
    refISO: ctx.emailDateISO ?? ctx.now.toISOString().slice(0, 10),
    now: ctx.now,
  });
}

const WEIGHTS: Record<EmailKind, [string, number][]> = {
  renewal: [["amount", 0.4], ["merchant", 0.3], ["currency", 0.15], ["dateOrCadence", 0.15]],
  receipt: [["amount", 0.45], ["merchant", 0.35], ["currency", 0.2]],
  trial_ending: [["trialEndsISO", 0.6], ["merchant", 0.4]],
  price_change: [["amount", 0.4], ["merchant", 0.3], ["currency", 0.15], ["previousAmount", 0.15]],
  cancellation: [["merchant", 1]],
  other: [["merchant", 1]],
};

/** How much of what this kind of email should carry was found, 0..1. */
export function computeConfidence(f: Omit<EmailFinding, "confidence" | "label" | "parser">): number {
  let found = 0;
  for (const [field, weight] of WEIGHTS[f.kind]) {
    const present =
      field === "dateOrCadence"
        ? f.cadence !== "unknown" || !!(f.chargedISO || f.nextChargeISO)
        : (f as Record<string, unknown>)[field] != null;
    if (present) found += weight;
  }
  const base = f.kind === "other" ? 0.2 : 0.3;
  const score = Math.min(f.kind === "other" ? 0.5 : 1, base + 0.7 * found);
  return Math.round(score * 100) / 100;
}

/** Validate a candidate finding; null when it is not one (no valid kind). */
export function validateFinding(raw: unknown, ctx: ValidationContext, parser: "rules" | "ai"): EmailFinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as RawFinding;
  const kind = typeof r.kind === "string" && (EMAIL_KINDS as readonly string[]).includes(r.kind) ? (r.kind as EmailKind) : null;
  if (!kind) return null;

  const merchant = typeof r.merchant === "string" ? cleanMerchantName(r.merchant) : null;
  const billedVia = typeof r.billedVia === "string" && (BILLED_VIA as readonly string[]).includes(r.billedVia) ? (r.billedVia as BilledVia) : null;
  const cadence = typeof r.cadence === "string" && (CADENCES as readonly string[]).includes(r.cadence) ? (r.cadence as FindingCadence) : "unknown";

  const amountV = validateAmount(r.amount, ctx.currency);
  let currency = validateCurrency(r.currency, ctx);
  if (!currency && amountV?.currency) currency = validateCurrency(amountV.currency, ctx);
  let amount = amountV?.amount ?? null;
  if (amount !== null && amount > amountCeiling(currency)) amount = null;

  let previousAmount: number | null = null;
  if (kind === "price_change") {
    const prev = validateAmount(r.previousAmount, ctx.currency);
    if (prev && prev.amount <= amountCeiling(currency) && prev.amount !== amount) previousAmount = prev.amount;
  }

  let chargedISO = validDate(r.chargedISO, ctx);
  let nextChargeISO = validDate(r.nextChargeISO, ctx);
  let trialEndsISO = validDate(r.trialEndsISO, ctx);
  if (kind === "cancellation") {
    // A cancellation stops charges; any date in it is when access ends.
    nextChargeISO = null;
    trialEndsISO = null;
  }
  if (chargedISO && nextChargeISO && nextChargeISO <= chargedISO) nextChargeISO = null;
  if (kind !== "trial_ending" && trialEndsISO && chargedISO && trialEndsISO < chargedISO) trialEndsISO = null;
  if (kind === "cancellation") chargedISO = null;

  const base = {
    kind,
    merchant,
    senderDomain: ctx.senderDomain,
    billedVia,
    amount,
    currency,
    cadence,
    chargedISO,
    emailDateISO: ctx.emailDateISO,
    nextChargeISO,
    trialEndsISO,
    previousAmount,
  };
  return { ...base, confidence: computeConfidence(base), parser, label: subjectLabel(ctx.subject) };
}
