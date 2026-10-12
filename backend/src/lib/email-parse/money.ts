/**
 * Amounts as people write them: 1.234,56 · 1,234.56 · 1 234,56 (space, no-break
 * or narrow no-break space) · 1'234.56 · 12,99 € · €12.99 · US$ 9.99 · ¥25 ·
 * 25元 · 99,00 درهم · 149 DH. Every amount is found with its position so the
 * caller can read the words around it.
 */

import { ISO_4217, THREE_DECIMAL, isWordlikeCode, resolveMarker, type CurrencyContext } from "./currency";

export interface MoneyMatch {
  amount: number;
  currency: string | null;
  /** The marker as written ("€", "USD", "元"), or "" for a bare number read from a label. */
  marker: string;
  index: number;
  end: number;
  /** No currency marker: the number came from an "amount: 25.00" label. */
  bare: boolean;
  negative: boolean;
}

const NUM = String.raw`(\d{1,3}(?:[ \u00a0\u202f\u2009'’.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const NUM_START = String.raw`(?<![\p{N}.,'’])`;
const NUM_END = String.raw`(?![\p{N}]|[.,]\d)`;
const SP = String.raw`[ \u00a0\u202f\u2009]?`;

const PREFIX = String.raw`(US\$|U\$S|USD\$|CA\$|CAD\$|C\$|AU\$|A\$|NZ\$|HK\$|SG\$|S\$|MX\$|NT\$|R\$|CN¥|JP¥|E£|\$|€|£|¥|₹|₩|₺|₽|₪|₱|₫|฿|₦|₴|人民币|RMB|DHS|Dhs|DH|[A-Z]{3})`;
const SUFFIX = String.raw`(€|£|\$|¥|₫|₺|₽|₹|zł|Kč|日元|港元|港币|美元|欧元|英镑|澳元|加元|新台币|元|块|圆|円|人民币|RMB|د\.م\.?|د\.إ|ر\.س|ر\.ق|د\.ك|ج\.م|د\.ت|د\.ج|درهما|دراهم|درهم|ريال|جنيه|[Ee]uros?|[Dd]irhams?|[Yy]uan|[Dd]ollars?|DHS|Dhs|dhs|DH|Dh|dh|[A-Z]{3})`;

const PREFIX_RE = new RegExp(`(?<![\\p{L}])(-|−)?${PREFIX}${SP}(-|−)?${NUM_START}${NUM}${NUM_END}`, "gu");
const SUFFIX_RE = new RegExp(`(-|−)?${NUM_START}${NUM}${NUM_END}${SP}${SUFFIX}(?![\\p{L}])`, "gu");
/** "Amount: 25.00" with no marker — read only after a money label. */
const LABELLED_RE = new RegExp(
  String.raw`(?:total|amount|price|montant|prix|tarif|importe|betrag|金额|价格|实付|合计|总计|费用|المبلغ|السعر|المجموع|الإجمالي)[^\n\d]{0,24}?${NUM_START}${NUM}${NUM_END}`,
  "giu",
);

/**
 * Parse a number as written, deciding which separator is the decimal one.
 * Spaces and apostrophes group thousands; with both "," and "." the last one is
 * the decimal mark; a lone separator followed by exactly three digits groups
 * thousands (unless the currency has three minor digits).
 */
export function parseAmountString(raw: string, currency: string | null = null): number | null {
  let s = raw.trim().replace(/[ \u00a0\u202f\u2009'’]/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    s = s.split(group).join("");
    // Several decimal marks left means it was never a number.
    if (s.split(decimal).length > 2) return null;
    s = s.replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return null;
      s = parts.join("");
    } else {
      const frac = parts[1]!;
      const threeDecimals = currency !== null && THREE_DECIMAL.has(currency);
      if (frac.length === 3 && !threeDecimals) s = parts.join("");
      else if (frac.length >= 1 && frac.length <= 3) s = `${parts[0]}.${frac}`;
      else return null;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function markerCurrency(marker: string, ctx: CurrencyContext): string | null | undefined {
  if (/^[A-Z]{3}$/.test(marker)) {
    if (marker === "RMB") return "CNY";
    if (marker === "DHS") return resolveMarker(marker, ctx);
    if (!ISO_4217.has(marker)) return undefined; // not a currency at all
    return marker;
  }
  return resolveMarker(marker, ctx);
}

export function findMoney(text: string, ctx: CurrencyContext): MoneyMatch[] {
  const found: MoneyMatch[] = [];
  const add = (m: Omit<MoneyMatch, "amount"> & { raw: string }) => {
    const amount = parseAmountString(m.raw, m.currency);
    if (amount === null || amount <= 0) return;
    const { raw: _raw, ...rest } = m;
    found.push({ ...rest, amount });
  };

  for (const m of text.matchAll(PREFIX_RE)) {
    const marker = m[2]!;
    const currency = markerCurrency(marker, ctx);
    if (currency === undefined) continue;
    // "TVA 20" or "ALL 3": a three-letter word that happens to be a code needs a decimal amount.
    if (/^[A-Z]{3}$/.test(marker) && isWordlikeCode(marker) && !/[.,]\d{2}$/.test(m[4]!)) continue;
    add({ raw: m[4]!, currency, marker, index: m.index!, end: m.index! + m[0].length, bare: false, negative: !!(m[1] || m[3]) || isParenthesised(text, m.index!, m.index! + m[0].length) });
  }
  for (const m of text.matchAll(SUFFIX_RE)) {
    const marker = m[3]!;
    const currency = markerCurrency(marker, ctx);
    if (currency === undefined) continue;
    if (/^[A-Z]{3}$/.test(marker) && isWordlikeCode(marker) && !/[.,]\d{2}$/.test(m[2]!)) continue;
    add({ raw: m[2]!, currency, marker, index: m.index!, end: m.index! + m[0].length, bare: false, negative: !!m[1] || isParenthesised(text, m.index!, m.index! + m[0].length) });
  }
  for (const m of text.matchAll(LABELLED_RE)) {
    const raw = m[1]!;
    const end = m.index! + m[0].length;
    const index = end - raw.length;
    // A marker right after the number makes it a normal match already found above.
    if (found.some((f) => f.index <= index && f.end >= end)) continue;
    // Percentages, quantities and dates are not amounts.
    const after = text.slice(end, end + 12);
    if (/^\s?(?:%|[/.-]\d|年|月|日|天|个|件|位|x(?![\p{L}])|(?:items?|articles?|pcs|units?|days?|jours?|months?|mois|years?|ans?|GB|Go|Mo|MB|TB)(?![\p{L}]))/iu.test(after)) continue;
    // A whole number after "total" or "price" is usually a count; money labels in
    // Chinese and Arabic are specific enough to trust a whole number.
    if (!/[.,]\d{1,2}$/.test(raw) && !/金额|实付|费用|المبلغ|montant|amount|betrag|importe/iu.test(m[0])) continue;
    add({ raw, currency: null, marker: "", index, end, bare: true, negative: false });
  }

  // One amount with both a prefix and a suffix ("€12,99 EUR") or matched twice: keep the first, widest.
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out: MoneyMatch[] = [];
  for (const f of found) {
    const prev = out[out.length - 1];
    if (prev && f.index < prev.end) {
      if (prev.amount === f.amount && prev.currency === null && f.currency !== null) out[out.length - 1] = { ...prev, currency: f.currency, marker: f.marker, end: Math.max(prev.end, f.end) };
      else if (prev.amount === f.amount) out[out.length - 1] = { ...prev, end: Math.max(prev.end, f.end) };
      continue;
    }
    out.push(f);
  }
  return out;
}

function isParenthesised(text: string, start: number, end: number): boolean {
  return text[start - 1] === "(" && text[end] === ")";
}

/**
 * One amount written as a string ("€12,99", "1 234,56", "12.99 USD"), for
 * values the AI hands back. Returns the amount and any currency it names.
 */
export function parseMoneyValue(value: string, ctx: CurrencyContext): { amount: number; currency: string | null } | null {
  const v = value.trim();
  if (!v || v.length > 40) return null;
  const all = findMoney(v, ctx).filter((m) => !m.negative);
  if (all.length === 1) return { amount: all[0]!.amount, currency: all[0]!.currency };
  if (all.length > 1) return null;
  const n = parseAmountString(v);
  return n === null ? null : { amount: n, currency: null };
}
