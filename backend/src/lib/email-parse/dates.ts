/**
 * Dates as billing emails write them, in English, French, Arabic and Chinese
 * (Spanish and German lightly): ISO, 2026年11月12日, 12 octobre 2026,
 * November 12, 2026, ١٢ نوفمبر ٢٠٢٦ (after digit normalisation), 12/11/2026
 * day-first unless the context is US English. Every result is a real calendar
 * day within two years of `now`, as YYYY-MM-DD — never a Date with local getters.
 */

import type { FindingCadence } from "./types";

const MONTH_NAMES: [string, number][] = [];
function months(n: number, ...names: string[]) {
  for (const name of names) MONTH_NAMES.push([name, n]);
}
// English
months(1, "january", "jan"); months(2, "february", "feb"); months(3, "march", "mar"); months(4, "april", "apr");
months(5, "may"); months(6, "june", "jun"); months(7, "july", "jul"); months(8, "august", "aug");
months(9, "september", "sept", "sep"); months(10, "october", "oct"); months(11, "november", "nov"); months(12, "december", "dec");
// French
months(1, "janvier", "janv"); months(2, "février", "fevrier", "févr", "fevr", "fév", "fev"); months(3, "mars");
months(4, "avril", "avr"); months(5, "mai"); months(6, "juin"); months(7, "juillet", "juil"); months(8, "août", "aout");
months(9, "septembre"); months(10, "octobre"); months(11, "novembre"); months(12, "décembre", "decembre", "déc");
// Spanish
months(1, "enero", "ene"); months(2, "febrero"); months(3, "marzo"); months(4, "abril"); months(5, "mayo"); months(6, "junio");
months(7, "julio"); months(8, "agosto", "ago"); months(9, "septiembre", "setiembre"); months(10, "octubre");
months(11, "noviembre"); months(12, "diciembre", "dic");
// German
months(1, "januar", "jänner"); months(2, "februar"); months(3, "märz", "maerz"); months(6, "juni"); months(7, "juli");
months(10, "oktober", "okt"); months(12, "dezember", "dez");
// Arabic: Egyptian/Gulf, Maghreb (Morocco), Algeria/Tunisia, and Levant/Iraq (Syriac) names.
months(1, "يناير", "جانفي", "كانون الثاني"); months(2, "فبراير", "فيفري", "شباط"); months(3, "مارس", "آذار", "اذار");
months(4, "أبريل", "ابريل", "إبريل", "أفريل", "افريل", "نيسان"); months(5, "مايو", "ماي", "أيار", "ايار");
months(6, "يونيو", "يونيه", "جوان", "حزيران"); months(7, "يوليو", "يوليوز", "يوليه", "جويلية", "تموز");
months(8, "أغسطس", "اغسطس", "غشت", "أوت", "اوت", "آب", "اب"); months(9, "سبتمبر", "شتنبر", "أيلول", "ايلول");
months(10, "أكتوبر", "اكتوبر", "تشرين الأول", "تشرين الاول"); months(11, "نوفمبر", "نونبر", "تشرين الثاني");
months(12, "ديسمبر", "دجنبر", "كانون الأول", "كانون الاول");

const MONTH_LOOKUP = new Map(MONTH_NAMES.map(([k, v]) => [k, v]));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MONTH_ALT = [...MONTH_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");

function monthNumber(name: string): number | undefined {
  return MONTH_LOOKUP.get(name.toLowerCase().replace(/\.$/, "")) ?? MONTH_LOOKUP.get(name.replace(/\.$/, ""));
}

const NOT_LETTER_BEFORE = "(?<![\\p{L}])";
const NOT_LETTER_AFTER = "(?![\\p{L}])";
const ORD = "(?:er|re|st|nd|rd|th|º|°)?";

const DMY_NAME = new RegExp(
  `(?<![\\p{N}])(\\d{1,2})${ORD}\\.?\\s*(?:de\\s+|of\\s+)?${NOT_LETTER_BEFORE}(${MONTH_ALT})\\.?${NOT_LETTER_AFTER}(?:,?\\s*(?:de\\s+)?(\\d{4})(?![\\p{N}]))?`,
  "giu",
);
const MDY_NAME = new RegExp(
  `${NOT_LETTER_BEFORE}(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{N}:])(?:,?\\s+(\\d{4})(?![\\p{N}]))?`,
  "giu",
);
const YMD_NUM = /(?<![\p{N}])(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\p{N}])/gu;
const ZH_DATE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/gu;
const DMY_NUM = /(?<![\p{N}.,/-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\p{N}])/gu;

export interface DateMatch {
  iso: string;
  index: number;
  end: number;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isRealDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toISO(y: number, m: number, d: number): string | null {
  return isRealDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
}

/** Days since the epoch for a YYYY-MM-DD string (UTC arithmetic only). */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function isoFromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** The UTC calendar day of an instant. */
export function utcDayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Strict YYYY-MM-DD check (real calendar day). */
export function isISODate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return isRealDate(y, m, d);
}

/** Within two years either side of now. */
export function withinWindow(iso: string, now: Date): boolean {
  const diff = dayNumber(iso) - dayNumber(utcDayISO(now));
  return Math.abs(diff) <= 731;
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addPeriod(iso: string, cadence: FindingCadence): string | null {
  switch (cadence) {
    case "weekly":
      return isoFromDayNumber(dayNumber(iso) + 7);
    case "biweekly":
      return isoFromDayNumber(dayNumber(iso) + 14);
    case "monthly":
      return addMonths(iso, 1);
    case "quarterly":
      return addMonths(iso, 3);
    case "semiannual":
      return addMonths(iso, 6);
    case "yearly":
      return addMonths(iso, 12);
    default:
      return null;
  }
}

/** The year that puts month/day closest to the reference day. */
function inferYear(m: number, d: number, refISO: string): number | null {
  const refYear = Number(refISO.slice(0, 4));
  let best: { y: number; dist: number } | null = null;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    if (!isRealDate(y, m, d)) continue;
    const dist = Math.abs(dayNumber(`${y}-${pad2(m)}-${pad2(d)}`) - dayNumber(refISO));
    if (!best || dist < best.dist) best = { y, dist };
  }
  return best?.y ?? null;
}

function year4(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

export interface FindDatesOptions {
  /** Read 11/12/2026 month-first (US English). */
  monthFirst: boolean;
  /** Reference day for dates written without a year (the email's date, or today). */
  refISO: string;
  now: Date;
}

/**
 * Every date in the text, in order, each valid and within the two-year window.
 * Overlapping candidates keep the longest.
 */
export function findDates(text: string, opts: FindDatesOptions): DateMatch[] {
  const raw: (DateMatch & { len: number })[] = [];
  const push = (index: number, len: number, y: number | null, m: number, d: number) => {
    const year = y ?? inferYear(m, d, opts.refISO);
    if (year === null) return;
    const iso = toISO(year, m, d);
    if (!iso || !withinWindow(iso, opts.now)) return;
    raw.push({ iso, index, end: index + len, len });
  };

  for (const m of text.matchAll(YMD_NUM)) push(m.index!, m[0].length, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(ZH_DATE)) push(m.index!, m[0].length, m[1] ? Number(m[1]) : null, Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(DMY_NAME)) {
    const mo = monthNumber(m[2]!);
    if (mo) push(m.index!, m[0].length, m[3] ? Number(m[3]) : null, mo, Number(m[1]));
  }
  for (const m of text.matchAll(MDY_NAME)) {
    const mo = monthNumber(m[1]!);
    if (mo) push(m.index!, m[0].length, m[3] ? Number(m[3]) : null, mo, Number(m[2]));
  }
  for (const m of text.matchAll(DMY_NUM)) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = year4(m[4]!);
    let day: number;
    let month: number;
    if (a > 12) [day, month] = [a, b];
    else if (b > 12) [day, month] = [b, a];
    else if (opts.monthFirst) [day, month] = [b, a];
    else [day, month] = [a, b];
    push(m.index!, m[0].length, y, month, day);
  }

  raw.sort((a, b) => a.index - b.index || b.len - a.len);
  const out: DateMatch[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r.index < last.end) {
      // Overlap: keep the longer reading.
      if (r.end - r.index > last.end - last.index) out[out.length - 1] = { iso: r.iso, index: r.index, end: r.end };
      continue;
    }
    out.push({ iso: r.iso, index: r.index, end: r.end });
  }
  return out;
}

/** One date written in any supported form, validated; null when it is not one. */
export function parseDateLoose(value: unknown, opts: FindDatesOptions): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 80) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    const iso = v.slice(0, 10);
    return isISODate(iso) && withinWindow(iso, opts.now) ? iso : null;
  }
  const found = findDates(v, opts);
  return found.length === 1 ? found[0]!.iso : null;
}

const RFC_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** The calendar day of an RFC 5322 Date header, in the sender's own zone. */
export function dayFromDateHeader(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{2,4})/i.exec(value);
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3]!.length === 2) y += y < 50 ? 2000 : 1900;
  return toISO(y, RFC_MONTHS[m[2]!.toLowerCase()]!, Number(m[1]));
}
