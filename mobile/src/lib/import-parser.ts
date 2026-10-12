import {
  buildMerchantMemory,
  suggestCategory,
  type LearnableTransaction,
  type MerchantMemory,
} from './merchant-memory';
import { fallbackCategory, mentionsAny } from './category-keywords';
import { convertCurrency } from './currencies';

// Transaction categories matching the app's existing categories
export const CATEGORIES = [
  'Food',
  'Gym',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Other',
] as const;

export type Category = typeof CATEGORIES[number];

export interface ParsedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'Expense' | 'Income';
  /**
   * Free-form, not the built-in union: users create their own categories, and
   * a re-imported export must be able to carry one back in unchanged.
   */
  suggestedCategory: string;
  originalData: Record<string, string>;
  isImpulse: boolean;
  currency?: string;
}

export interface ImportPreview {
  transactions: ParsedTransaction[];
  totalExpenses: number;
  totalIncome: number;
  categoryBreakdown: Record<string, number>;
  dateRange: { start: string; end: string };
  duplicatesFound: number;
}

/**
 * What can help categorise a row the file does not categorise itself.
 *
 *  - `memory`: what this user has filed before (lib/merchant-memory). Their
 *    own history beats any keyword table.
 *  - `currency`: the user's currency. It chooses which regional brand list the
 *    keyword fallback consults (lib/category-keywords), and the scale of the
 *    impulse guess. A row that states its own currency uses that instead.
 */
export interface CategoryContext {
  memory?: MerchantMemory | null;
  currency?: string | null;
}

/**
 * The keyword fallback for a description, as a built-in category.
 *
 * Plain words in English, French, Arabic and Chinese, global brands, and the
 * brands of the region `currency` selects — see lib/category-keywords for the
 * table and its matching rules. "Other" when nothing is recognised.
 */
export function autoCategorize(description: string, currency?: string | null): Category {
  return fallbackCategory(description, currency) ?? 'Other';
}

/**
 * The shopping spend above which a purchase counts as large: $100, expressed
 * in the user's currency. A flat 100 would make every 15-dollar shirt bought
 * in dirhams or yuan an "impulse" and no purchase in yen ever one.
 */
function impulseThreshold(currency?: string | null): number {
  const code = String(currency ?? '').trim().toUpperCase();
  return code ? convertCurrency(100, 'USD', code) : 100;
}

/** Words that suggest a purchase was not planned: delivery apps, sales, flash deals. */
const IMPULSE_WORDS: readonly string[] = [
  'impulse', 'sale', 'flash sale', 'clearance', 'delivery', 'amazon',
  'doordash', 'uber eats', 'ubereats', 'grubhub', 'postmates', 'deliveroo', 'just eat',
  'glovo', 'jumia food',
  'soldes', 'promo', 'livraison',
  'تخفيضات', 'تخفيض', 'توصيل',
  '外卖', '饿了么', '秒杀', '特价', '促销', '冲动',
];

/** Phrases that contain an impulse word and say nothing about impulse. */
const NOT_IMPULSE: readonly string[] = [
  'point of sale', 'pos sale', 'bill of sale', 'non delivery',
];

/**
 * Whether a purchase looks unplanned, from its description and size.
 *
 * `currency` is the user's (it picks the regional brands, as for the
 * category); `amountCurrency` is the one `amount` is written in, when that
 * differs — an Alipay bill is in yuan whatever the user's own currency is.
 */
export function detectImpulse(
  description: string,
  amount: number,
  currency?: string | null,
  amountCurrency: string | null | undefined = currency,
): boolean {
  // A large shopping purchase.
  if (
    amount > impulseThreshold(amountCurrency) &&
    fallbackCategory(description, currency) === 'Shopping'
  ) {
    return true;
  }

  // Food delivery and sales.
  return mentionsAny(description, IMPULSE_WORDS, NOT_IMPULSE);
}

/**
 * A category someone else guessed — the PDF reader's model — unless this user
 * has filed the merchant before. Their own choice beats a model's guess for
 * the same reason it beats the keyword table.
 */
export function preferHistory(description: string, guessed: string, context: CategoryContext): string {
  return (context.memory ? suggestCategory(description, context.memory) : null) || guessed;
}

/**
 * The category ladder for one row: what the file says, then what this user
 * has done before, then the keyword fallback, then "Other".
 */
function suggestFor(
  description: string,
  declared: string,
  context: CategoryContext,
  currency: string | null | undefined,
): string {
  return (
    declared ||
    (context.memory ? suggestCategory(description, context.memory) : null) ||
    autoCategorize(description, currency)
  );
}

// ── Per-file format detection ────────────────────────────────────────────────
// A statement's decimal separator, day/month ordering and sign convention are
// properties of the *file*, not of individual cells. Detect each once from a
// sample of rows, then parse every row the same way.

/** "1,234.56" (us) vs "1.234,56" (european). */
export type DecimalConvention = 'us' | 'european';
/** Day/month ordering for slash- and dash-separated dates. */
export type DateConvention = 'ymd' | 'dmy' | 'mdy';
/**
 * How a single amount column encodes direction.
 *  - `signed`      negative means expense (most US exports)
 *  - `all-expense` every row is a debit (common for unsigned exports)
 *  - `all-income`  every row is a credit
 */
export type SignConvention = 'signed' | 'all-expense' | 'all-income';

export interface CsvFormat {
  decimal: DecimalConvention;
  date: DateConvention;
  sign: SignConvention;
  /** Detection had to fall back to a default — offer the user an override. */
  dateAmbiguous: boolean;
  signAmbiguous: boolean;
  decimalAmbiguous: boolean;
  /**
   * The field separator. Detection always fills it in; a caller may set it to
   * override detection. Absent from bank profiles saved before it existed,
   * which then use the file's detected delimiter.
   */
  delimiter?: CsvDelimiter;
}

export function detectDecimalConvention(samples: string[]): {
  convention: DecimalConvention;
  ambiguous: boolean;
} {
  let european = 0;
  let us = 0;

  for (const raw of samples) {
    // The currency goes first: the dots of a "د.م." or a "Dh." are not decimal points.
    const s = stripCurrency(raw ?? '')
      .replace(/[^\d.,]/g, '')
      .replace(/[.,]+$/, '');
    if (!s) continue;

    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot === -1 && lastComma === -1) continue;

    // Both separators present: whichever comes last is the decimal point.
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) european++;
      else us++;
      continue;
    }

    const sep = lastDot >= 0 ? '.' : ',';
    const idx = lastDot >= 0 ? lastDot : lastComma;
    const trailing = s.length - idx - 1;
    const occurrences = s.split(sep).length - 1;

    // A separator that repeats can only be grouping thousands.
    if (occurrences > 1) {
      if (sep === '.') european++;
      else us++;
      continue;
    }
    // Exactly three trailing digits is genuinely ambiguous ("1.234" could be
    // one thousand two hundred and thirty-four, or 1.234). No evidence either way.
    if (trailing === 1 || trailing === 2) {
      if (sep === ',') european++;
      else us++;
    }
  }

  if (european === 0 && us === 0) return { convention: 'us', ambiguous: true };
  return {
    convention: european > us ? 'european' : 'us',
    ambiguous: european > 0 && us > 0,
  };
}

export function detectDateConvention(
  samples: string[],
  fallback: DateConvention = 'mdy'
): { convention: DateConvention; ambiguous: boolean } {
  let dmy = 0;
  let mdy = 0;
  let ymd = 0;
  let sawTwoPart = false;

  for (const raw of samples) {
    const s = (raw ?? '').trim();
    if (!s) continue;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) {
      ymd++;
      continue;
    }
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!m) continue;
    sawTwoPart = true;
    const first = Number(m[1]);
    const second = Number(m[2]);
    // Only a value above 12 proves which position holds the day.
    if (first > 12) dmy++;
    else if (second > 12) mdy++;
  }

  if (ymd > 0 && !sawTwoPart) return { convention: 'ymd', ambiguous: false };
  if (dmy > 0 && mdy === 0) return { convention: 'dmy', ambiguous: false };
  if (mdy > 0 && dmy === 0) return { convention: 'mdy', ambiguous: false };
  // Either the file mixes both orderings, or every day in it is 12 or lower.
  return { convention: fallback, ambiguous: sawTwoPart };
}

export function detectSignConvention(amounts: number[]): {
  convention: SignConvention;
  ambiguous: boolean;
} {
  const hasNegative = amounts.some((a) => a < 0);
  const hasPositive = amounts.some((a) => a > 0);

  // A negative anywhere means the file distinguishes direction by sign.
  if (hasNegative) return { convention: 'signed', ambiguous: false };
  // Nothing negative: a single unsigned amount column on a bank export is
  // almost always a list of debits. Treating these as Income — the previous
  // behaviour — turned every statement of this shape into pure income.
  return { convention: 'all-expense', ambiguous: hasPositive };
}

/**
 * Which column holds what. Auto-detected from the header row, and overridable
 * by the user when the header is unrecognisable — a file whose columns cannot
 * be identified should be a question, not a dead end.
 *
 * -1 means "not present".
 */
export interface ColumnMapping {
  dateIdx: number;
  descIdx: number;
  amountIdx: number;
  debitIdx: number;
  creditIdx: number;
  categoryIdx: number;
  typeIdx: number;
  impulseIdx: number;
  currencyIdx: number;
}

/** The columns a file cannot be parsed without. */
export type RequiredColumn = 'date' | 'amount';

export interface CsvInspection {
  /** Header cells as written in the file (not lowercased). */
  headers: string[];
  /** A few data rows, so the user can see what each column actually contains. */
  sampleRows: string[][];
  mapping: ColumnMapping;
  /** Empty when the file is ready to parse. */
  missing: RequiredColumn[];
  format: CsvFormat;
}

// ── Reading the file: delimiter, records and the header row ─────────────────
// A bank export is a table, but not always a comma-separated one, and not
// always at the top of the file. French and Moroccan banks separate fields
// with semicolons, because the comma is their decimal point; some exports use
// tabs; and many put an account summary (account number, balance, download
// date, blank lines) above the table. Detection, the mapping preview and the
// parse all read the file through readTable(), so they agree on the delimiter
// and on the header row — and so on what every column index means.

/** The separators bank exports put between fields. */
export type CsvDelimiter = ',' | ';' | '\t' | '|';

/**
 * Every candidate, in the order a tie is settled: separators that never occur
 * in ordinary text first. The comma comes last because it is also the decimal
 * point of half the world's amounts.
 */
const DELIMITERS: readonly CsvDelimiter[] = ['\t', ';', '|', ','];

/** Records read to choose a delimiter: enough to see past an account summary into the table. */
const DELIMITER_SAMPLE = 100;

/** How far down the file the header row is looked for. */
const HEADER_SCAN = 60;

function isDelimiter(value: unknown): value is CsvDelimiter {
  return DELIMITERS.includes(value as CsvDelimiter);
}

/**
 * The file's text without what comes before the data: a byte-order mark, and
 * the "sep=;" line Excel writes to name the delimiter — which then decides it.
 */
function preamble(content: string): { text: string; hinted: CsvDelimiter | null } {
  const text = (content ?? '').replace(/^\uFEFF/, '');
  const sep = /^"?sep=(.)"?\1*[ ]*(?:\r\n|\n|\r|$)/i.exec(text);
  if (!sep) return { text, hinted: null };
  return { text: text.slice(sep[0].length), hinted: isDelimiter(sep[1]) ? sep[1] : null };
}

/**
 * Split CSV text into records of fields.
 *
 * RFC 4180, read leniently. A field that starts with a quote (after optional
 * spaces) runs to its closing quote and may hold the delimiter, doubled quotes
 * and line breaks — Crédit Agricole writes multi-line libellés that way. A
 * quote anywhere else is an ordinary character, so an inch mark in a
 * description cannot swallow the rest of the file, and neither can a quote
 * that is never closed. Records end at \n, \r\n or \r.
 */
function readRecords(text: string, delimiter: string, limit = Infinity): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let literalQuoteAt = -1;
  const n = text.length;
  let i = 0;

  while (i < n && records.length < limit) {
    const c = text.charAt(i);

    if (c === '"' && i !== literalQuoteAt && field.trim() === '') {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < n) {
        const quote = text.indexOf('"', j);
        if (quote === -1) break;
        value += text.slice(j, quote);
        if (text.charAt(quote + 1) === '"') {
          value += '"';
          j = quote + 2;
          continue;
        }
        closed = true;
        j = quote + 1;
        break;
      }
      if (!closed) {
        // Never closed: read this quote again, as an ordinary character.
        literalQuoteAt = i;
        continue;
      }
      // Spaces before the opening quote are padding, not content.
      field = value;
      i = j;
      continue;
    }

    if (c === delimiter) {
      record.push(field);
      field = '';
      i++;
      continue;
    }

    if (c === '\n' || c === '\r') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += c === '\r' && text.charAt(i + 1) === '\n' ? 2 : 1;
      continue;
    }

    // An ordinary run, up to the next character that means something.
    let j = i + 1;
    while (j < n) {
      const next = text.charAt(j);
      if (next === delimiter || next === '\n' || next === '\r' || next === '"') break;
      j++;
    }
    field += text.slice(i, j);
    i = j;
  }

  if (records.length < limit && (field !== '' || record.length > 0)) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** A record with nothing in it: a blank line, or a row of bare delimiters. */
function isBlank(record: readonly string[]): boolean {
  return record.every((cell) => cell.trim() === '');
}

/**
 * A cell as text to show and to match: a line break inside a quoted field
 * becomes a space, and invisible direction marks go.
 */
function cellText(cell: string | undefined): string {
  return stripBidi(cell ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * How well a delimiter explains the start of the file.
 *
 *  - `rows`: records it splits into fields. The true delimiter splits the
 *    header and every row of the table, and usually the summary above it.
 *  - `consistent`: how many of those share the commonest width — the rows of
 *    a table are all as wide as each other.
 *  - `width`: that commonest width. Of two delimiters that split the same rows
 *    as evenly, the true one splits them into more fields.
 *
 * A comma between a digit and one or two more digits ("19,99") is a decimal
 * comma, not a delimiter, and is not counted as a split: every row of a
 * semicolon export holds one, and counting them would make the comma look as
 * good a delimiter as the semicolon.
 */
function delimiterFit(text: string, delimiter: CsvDelimiter) {
  const widths = new Map<number, number>();
  let rows = 0;
  for (const record of readRecords(text, delimiter, DELIMITER_SAMPLE)) {
    if (record.length < 2 || isBlank(record)) continue;
    let splits = record.length - 1;
    if (delimiter === ',') {
      for (let k = 0; k + 1 < record.length; k++) {
        if (/\d$/.test(record[k]!) && /^\d{1,2}(?!\d)/.test(record[k + 1]!)) splits--;
      }
    }
    if (splits < 1) continue;
    rows++;
    widths.set(record.length, (widths.get(record.length) ?? 0) + 1);
  }

  let consistent = 0;
  let width = 0;
  for (const [w, count] of widths) {
    if (count > consistent || (count === consistent && w > width)) {
      consistent = count;
      width = w;
    }
  }
  return { rows, consistent, width };
}

function delimiterIn(text: string): CsvDelimiter {
  let best: CsvDelimiter = ',';
  let top = { rows: 0, consistent: 0, width: 0 };
  for (const delimiter of DELIMITERS) {
    const fit = delimiterFit(text, delimiter);
    const better =
      fit.rows !== top.rows
        ? fit.rows > top.rows
        : fit.consistent !== top.consistent
          ? fit.consistent > top.consistent
          : fit.width > top.width;
    if (better) {
      best = delimiter;
      top = fit;
    }
  }
  return best;
}

/**
 * The delimiter a CSV file uses: comma, semicolon, tab or pipe.
 *
 * Read from the file itself — the header and the first rows, respecting
 * quotes — because nothing else says: a French bank writes semicolons, a US
 * one commas, and both call the file .csv. An Excel "sep=" line decides it
 * outright. A file with no delimiter in it at all reads as comma-separated.
 */
export function detectDelimiter(csvContent: string): CsvDelimiter {
  const { text, hinted } = preamble(csvContent);
  return hinted ?? delimiterIn(text);
}

// ── Column names ─────────────────────────────────────────────────────────────
// Header cells are compared folded: lower case, without accents or Arabic
// vowel marks, spaces collapsed. "Libellé", "LIBELLE" and "Libelle" are one
// name, and so are "Débit" and the "D\uFFFDbit" a Windows-1252 export becomes
// when read as UTF-8 — the only accented letter in these names is é.

function fold(s: string): string {
  return stripBidi(s)
    .replace(/\uFFFD/g, 'e')
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u0640\u064b-\u065f\u0670]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const folded = (words: readonly string[]): string[] => words.map(fold);

const DATE_WORDS = folded(['date', 'تاريخ']);
/** A value date (date de valeur): when the bank settled, not when the user paid. */
const VALUE_DATE_WORDS = folded(['valeur', 'value', 'dateval', 'القيمة']);
const DESCRIPTION_WORDS = folded([
  'description', 'memo', 'merchant', 'payee', 'libellé', 'motif', 'label', 'narrative',
  'bénéficiaire', 'intitulé', 'البيان', 'بيان', 'الوصف', 'وصف',
]);
/** Names that describe the row only when nothing better does (see locateColumns). */
const WEAK_DESCRIPTION_WORDS = folded(['opération', 'détail', 'تفاصيل', 'العملية']);
const AMOUNT_WORDS = folded(['amount', 'montant', 'مبلغ']);
const DEBIT_WORDS = folded(['débit', 'withdrawal', 'retrait', 'paid out', 'money out', 'مدين', 'سحب']);
const CREDIT_WORDS = folded(['crédit', 'deposit', 'versement', 'paid in', 'money in', 'دائن', 'إيداع']);
/** A column that states each row's direction: our own export's Type, a French "Sens". */
const DIRECTION_HEADERS = folded(['type', 'sens', 'd/c']);
const CURRENCY_HEADERS = folded(['currency', 'devise', 'العملة']);

const INCOME_WORDS = folded(['income', 'crédit', 'دائن']);
const EXPENSE_WORDS = folded(['expense', 'débit', 'مدين']);
/** Letter codes a Sens or D/C column writes. Too terse to trust under a plain "Type". */
const INCOME_CODES = ['c', 'cr'];
const EXPENSE_CODES = ['d', 'db', 'dr'];

const mentions = (h: string, words: readonly string[]) => words.some((w) => h.includes(w));

/**
 * A folded header naming money: an amount, a debit or a credit column. Never
 * one that says "date" — "Date de débit" is when a deferred card is charged,
 * not how much — though "Posted Amount" is still an amount.
 */
function isAmountHeader(h: string): boolean {
  return (
    !mentions(h, DATE_WORDS) &&
    (mentions(h, AMOUNT_WORDS) || mentions(h, DEBIT_WORDS) || mentions(h, CREDIT_WORDS))
  );
}

/** A folded header naming a date: "Date", "Date opération", "تاريخ العملية", "Posted", a bare "Valeur". */
function isDateHeader(h: string): boolean {
  return (mentions(h, DATE_WORDS) || h.includes('posted') || h === 'valeur') && !isAmountHeader(h);
}

/** Column indices and folded header names, shared by detection and parsing. */
function locateColumns(header: readonly string[]) {
  const headers = header.map(fold);
  const find = (test: (h: string, i: number) => boolean) => headers.findIndex(test);

  // The day the user paid. French and Moroccan exports give a "Date valeur"
  // beside the "Date opération"; it is only the fallback.
  const paidOn = find((h) => isDateHeader(h) && !mentions(h, VALUE_DATE_WORDS));
  const dateIdx = paidOn >= 0 ? paidOn : find(isDateHeader);

  // "Opération" names the description column only when nothing better does:
  // French and Moroccan banks also write "Date opération" for the date, and
  // taking that as the description files every row under its own date.
  // "Détail" waits too: a US export's "Details" column says DEBIT or CREDIT.
  const strongDescIdx = find((h, i) => i !== dateIdx && mentions(h, DESCRIPTION_WORDS));
  const descIdx =
    strongDescIdx >= 0
      ? strongDescIdx
      : find((h, i) => i !== dateIdx && !isDateHeader(h) && mentions(h, WEAK_DESCRIPTION_WORDS));
  const amountIdx = find(isAmountHeader);
  const debitIdx = find((h) => !mentions(h, DATE_WORDS) && mentions(h, DEBIT_WORDS));
  const creditIdx = find((h) => !mentions(h, DATE_WORDS) && mentions(h, CREDIT_WORDS));

  // Columns our own export writes. Present in a re-imported backup, absent in
  // a bank statement — when they are there they are authoritative, because
  // re-deriving them loses information the user already corrected by hand.
  const categoryIdx = find((h) => h.startsWith('categor'));
  const typeIdx = find((h) => DIRECTION_HEADERS.includes(h));
  const impulseIdx = find((h) => h.includes('impulse'));
  const currencyIdx = find((h) => CURRENCY_HEADERS.includes(h));

  return {
    headers,
    dateIdx,
    descIdx,
    amountIdx,
    debitIdx,
    creditIdx,
    categoryIdx,
    typeIdx,
    impulseIdx,
    currencyIdx,
  };
}

/**
 * The direction a Type or Sens cell states, if it states one. `header` is the
 * column's folded name: single letters count only under Sens or D/C.
 */
function declaredDirection(value: string | undefined, header: string): 'Income' | 'Expense' | null {
  const v = fold(value ?? '');
  if (!v) return null;
  if (INCOME_WORDS.includes(v)) return 'Income';
  if (EXPENSE_WORDS.includes(v)) return 'Expense';
  if (header !== 'type') {
    if (INCOME_CODES.includes(v)) return 'Income';
    if (EXPENSE_CODES.includes(v)) return 'Expense';
  }
  return null;
}

// ── Finding the table ────────────────────────────────────────────────────────

const DATE_VALUE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

function looksLikeDate(cell: string): boolean {
  return DATE_VALUE.test(stripBidi(cell).trim());
}

function looksLikeAmount(cell: string): boolean {
  const s = stripCurrency(stripBidi(cell)).replace(/[\s\u00a0\u202f'\u2019]/g, '');
  return /\d/.test(s) && /^[-+(]?[\d.,]+\)?-?$/.test(s) && !looksLikeDate(cell);
}

/** A row of the table: a date in one cell and an amount in another. */
function looksLikeEntry(record: readonly string[]): boolean {
  const dateAt = record.findIndex(looksLikeDate);
  return dateAt >= 0 && record.some((cell, i) => i !== dateAt && looksLikeAmount(cell));
}

/** A row of column names: at least two, and none of them a number or a date. */
function looksLikeHeader(record: readonly string[]): boolean {
  const named = record.filter((cell) => cell.trim() !== '');
  return named.length >= 2 && !named.some((cell) => looksLikeDate(cell) || looksLikeAmount(cell));
}

/** A header this parser reads without help: it names a date column and a money column. */
function namesDateAndAmount(record: readonly string[]): boolean {
  if (!looksLikeHeader(record)) return false;
  const headers = record.map(fold);
  const dateAt = headers.findIndex(isDateHeader);
  return dateAt >= 0 && headers.some((h, i) => i !== dateAt && isAmountHeader(h));
}

/**
 * Which record is the header row.
 *
 * Banks put an account summary above the table — "Téléchargement du …",
 * "Compte de dépôt n° …", "Solde au …;2 345,67 €" — and the header is the
 * first row that names both a date and a money column. A header in a language
 * the names above do not cover is the row of names directly above the first
 * entry. Failing both, the first row, as it always was.
 */
function findHeaderRow(records: readonly string[][]): number {
  const scan = Math.min(records.length, HEADER_SCAN);
  for (let r = 0; r < scan; r++) {
    if (namesDateAndAmount(records[r]!)) return r;
  }
  for (let r = 0; r < scan; r++) {
    if (looksLikeEntry(records[r]!)) {
      return r > 0 && looksLikeHeader(records[r - 1]!) ? r - 1 : 0;
    }
  }
  return 0;
}

interface CsvTable {
  delimiter: CsvDelimiter;
  /** The header row's cells as the bank wrote them. Empty for an empty file. */
  header: string[];
  /** Every non-blank record below the header. */
  rows: string[][];
}

function tableOf(text: string, delimiter: CsvDelimiter): CsvTable {
  const records = readRecords(text, delimiter).filter((record) => !isBlank(record));
  if (records.length === 0) return { delimiter, header: [], rows: [] };
  const at = findHeaderRow(records);
  return { delimiter, header: records[at]!, rows: records.slice(at + 1) };
}

/**
 * The file as a table. `delimiter` overrides detection, unless it does not
 * split the header row at all — a delimiter remembered for a bank that has
 * since changed its export cannot be the file's, and the file's own is used.
 */
function readTable(csvContent: string, delimiter?: CsvDelimiter | null): CsvTable {
  const { text, hinted } = preamble(csvContent);
  if (isDelimiter(delimiter)) {
    const table = tableOf(text, delimiter);
    if (table.header.length >= 2) return table;
  }
  return tableOf(text, hinted ?? delimiterIn(text));
}

/** Interpret a boolean-ish cell ("true", "1", "yes", "y"). */
function parseBooleanCell(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'y';
}

/**
 * Infer a file's delimiter, decimal, date and sign conventions from its own
 * contents.
 *
 * `fallbackDate` decides the day/month ordering only when the file itself is
 * ambiguous (every day 12 or lower). Callers should pass 'dmy' for non-US
 * users — most of the world writes day first.
 */
export function detectCsvFormat(
  csvContent: string,
  fallbackDate: DateConvention = 'mdy',
  /**
   * Columns the user mapped by hand. Detection must sample *those* columns:
   * inferring the decimal and sign conventions from auto-located columns that
   * were never found means inferring them from nothing.
   */
  mappingOverride?: Partial<ColumnMapping>,
  /** The delimiter, when the user has chosen one. Detected from the file otherwise. */
  delimiter?: CsvDelimiter
): CsvFormat {
  return formatOf(readTable(csvContent, delimiter), fallbackDate, mappingOverride);
}

function formatOf(
  table: CsvTable,
  fallbackDate: DateConvention = 'mdy',
  mappingOverride?: Partial<ColumnMapping>
): CsvFormat {
  if (table.rows.length === 0) {
    return {
      decimal: 'us',
      date: fallbackDate,
      sign: 'signed',
      dateAmbiguous: true,
      signAmbiguous: true,
      decimalAmbiguous: true,
      delimiter: table.delimiter,
    };
  }

  const located = locateColumns(table.header);
  const dateIdx = mappingOverride?.dateIdx ?? located.dateIdx;
  const amountIdx = mappingOverride?.amountIdx ?? located.amountIdx;
  const debitIdx = mappingOverride?.debitIdx ?? located.debitIdx;
  const creditIdx = mappingOverride?.creditIdx ?? located.creditIdx;
  const typeIdx = mappingOverride?.typeIdx ?? located.typeIdx;
  const typeHeader = typeIdx >= 0 ? (located.headers[typeIdx] ?? '') : '';

  const amountCells: string[] = [];
  const dateCells: string[] = [];
  // A few hundred rows is plenty of evidence and keeps large files fast.
  for (const values of table.rows.slice(0, 300)) {
    if (dateIdx >= 0 && values[dateIdx]) dateCells.push(values[dateIdx]!);
    for (const idx of [amountIdx, debitIdx, creditIdx]) {
      if (idx >= 0 && values[idx]) amountCells.push(values[idx]!);
    }
  }

  const decimal = detectDecimalConvention(amountCells);
  // A decimal comma, or a semicolon between fields, comes from a country that
  // writes the day first — France, Morocco, the rest of Europe: nowhere that
  // writes 19,99 writes 10/05 for the fifth of October. When every day in the
  // file is 12 or lower, that says more than the user's settings do. The date
  // stays flagged ambiguous, so the user can still say otherwise.
  const dayFirst =
    (decimal.convention === 'european' && !decimal.ambiguous) || table.delimiter === ';';
  const date = detectDateConvention(dateCells, dayFirst ? 'dmy' : fallbackDate);

  // Sign only matters when a single column carries both directions. With
  // separate debit and credit columns the direction is explicit.
  let sign: { convention: SignConvention; ambiguous: boolean };
  if (debitIdx >= 0 && creditIdx >= 0) {
    sign = { convention: 'signed', ambiguous: false };
  } else if (debitIdx >= 0 && creditIdx === -1 && amountIdx === debitIdx) {
    // A debit column with no credit column is all outflow, whatever the sign.
    sign = { convention: 'all-expense', ambiguous: false };
  } else if (creditIdx >= 0 && debitIdx === -1 && amountIdx === creditIdx) {
    // ...and the mirror image: a credit column alone is all inflow.
    sign = { convention: 'all-income', ambiguous: false };
  } else {
    const parsed = amountCells.map((c) => parseAmount(c, decimal.convention));
    sign = detectSignConvention(parsed);
    // A Sens or Type column that states each row's direction settles what
    // an unsigned amount means, row by row (see parseCSV).
    const stated =
      typeIdx >= 0 &&
      table.rows.slice(0, 300).some((values) => declaredDirection(values[typeIdx], typeHeader));
    if (stated) sign = { ...sign, ambiguous: false };
  }

  return {
    decimal: decimal.convention,
    date: date.convention,
    sign: sign.convention,
    dateAmbiguous: date.ambiguous,
    signAmbiguous: sign.ambiguous,
    decimalAmbiguous: decimal.ambiguous,
    delimiter: table.delimiter,
  };
}

/**
 * Look at a file without committing to parsing it.
 *
 * Never throws. When `missing` is non-empty the caller should ask the user to
 * map those columns and pass the result back through `parseCSV`. `headers` and
 * `sampleRows` come from the real table, below any account summary, so the
 * column indices the user picks are the ones `parseCSV` reads.
 */
export function inspectCsv(
  csvContent: string,
  fallbackDate: DateConvention = 'mdy',
  /** The delimiter, when the user has chosen one. Detected from the file otherwise. */
  delimiter?: CsvDelimiter
): CsvInspection {
  const table = readTable(csvContent, delimiter);
  const format = formatOf(table, fallbackDate);

  if (table.header.length === 0) {
    return {
      headers: [],
      sampleRows: [],
      mapping: emptyMapping(),
      missing: ['date', 'amount'],
      format,
    };
  }

  const located = locateColumns(table.header);
  const mapping: ColumnMapping = {
    dateIdx: located.dateIdx,
    descIdx: located.descIdx,
    amountIdx: located.amountIdx,
    debitIdx: located.debitIdx,
    creditIdx: located.creditIdx,
    categoryIdx: located.categoryIdx,
    typeIdx: located.typeIdx,
    impulseIdx: located.impulseIdx,
    currencyIdx: located.currencyIdx,
  };

  return {
    // Raw header text, so the user recognises their own bank's wording.
    headers: table.header.map(cellText),
    sampleRows: table.rows.slice(0, 5).map((row) => row.map(cellText)),
    mapping,
    missing: missingColumns(mapping),
    format,
  };
}

export function emptyMapping(): ColumnMapping {
  return {
    dateIdx: -1,
    descIdx: -1,
    amountIdx: -1,
    debitIdx: -1,
    creditIdx: -1,
    categoryIdx: -1,
    typeIdx: -1,
    impulseIdx: -1,
    currencyIdx: -1,
  };
}

/** A file needs a date, and some column carrying an amount. */
export function missingColumns(mapping: ColumnMapping): RequiredColumn[] {
  const missing: RequiredColumn[] = [];
  if (mapping.dateIdx === -1) missing.push('date');
  if (mapping.amountIdx === -1 && mapping.debitIdx === -1 && mapping.creditIdx === -1) {
    missing.push('amount');
  }
  return missing;
}

// Parse CSV content into transactions
export function parseCSV(
  csvContent: string,
  /**
   * Conventions the user (or a remembered bank profile) has settled, the
   * delimiter among them. Anything left out is detected from the file.
   */
  overrides: Partial<CsvFormat> = {},
  /**
   * Explicit column mapping, from the manual mapping UI. When omitted the
   * columns are auto-detected from the header row.
   */
  mappingOverride?: Partial<ColumnMapping>,
  /**
   * What the user has categorised before, and their currency. Their own
   * history beats the keyword fallback; the currency picks the fallback's
   * regional brands — see CategoryContext.
   */
  context: CategoryContext = {}
): ParsedTransaction[] {
  const table = readTable(csvContent, overrides.delimiter);
  if (table.rows.length === 0) return [];

  const format: CsvFormat = {
    ...formatOf(table, overrides.date, mappingOverride),
    ...overrides,
    // A profile saved before delimiters were detected has none; the file's own applies.
    delimiter: table.delimiter,
  };

  // Header names are folded (lowercased, deaccented) so French and Arabic
  // headers like "Libellé", "Débit", "Crédit", "المبلغ" on Moroccan and
  // European statements match too.
  const located = locateColumns(table.header);
  const headers = located.headers;

  // Anything the user mapped by hand wins over detection.
  const {
    dateIdx,
    descIdx,
    amountIdx,
    debitIdx,
    creditIdx,
    categoryIdx,
    typeIdx,
    impulseIdx,
    currencyIdx,
  }: ColumnMapping = {
    dateIdx: located.dateIdx,
    descIdx: located.descIdx,
    amountIdx: located.amountIdx,
    debitIdx: located.debitIdx,
    creditIdx: located.creditIdx,
    categoryIdx: located.categoryIdx,
    typeIdx: located.typeIdx,
    impulseIdx: located.impulseIdx,
    currencyIdx: located.currencyIdx,
    ...mappingOverride,
  };

  // Nothing to parse without a date and an amount. Returning empty rather than
  // throwing lets the caller offer the mapping UI instead of dead-ending the
  // file — see inspectCsv().
  if (dateIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    return [];
  }

  const typeHeader = typeIdx >= 0 ? (headers[typeIdx] ?? '') : '';
  const transactions: ParsedTransaction[] = [];

  for (let r = 0; r < table.rows.length; r++) {
    const values = table.rows[r]!;
    if (values.length <= dateIdx) continue;
    // Some banks drop the empty fields at the end of a row, so a debit row
    // stops before the Crédit column. A missing cell is an empty one.
    const cell = (idx: number): string => (idx >= 0 ? (values[idx] ?? '') : '');

    const dateStr = cell(dateIdx);
    const description = descIdx >= 0 ? cellText(cell(descIdx)) : 'Unknown';

    let amount = 0;
    let type: 'Expense' | 'Income' = 'Expense';

    if (debitIdx >= 0 && creditIdx >= 0) {
      // Separate debit/credit columns — direction is explicit.
      const debit = Math.abs(parseAmount(cell(debitIdx), format.decimal));
      const credit = Math.abs(parseAmount(cell(creditIdx), format.decimal));

      if (debit > 0) {
        amount = debit;
        type = 'Expense';
      } else if (credit > 0) {
        amount = credit;
        type = 'Income';
      }
    } else if (amountIdx === -1 && creditIdx >= 0) {
      // A credit column with no debit column is all inflow.
      amount = Math.abs(parseAmount(cell(creditIdx), format.decimal));
      type = 'Income';
    } else {
      const column = amountIdx >= 0 ? amountIdx : debitIdx;
      const raw = parseAmount(cell(column), format.decimal);

      if (format.sign === 'all-expense') {
        amount = Math.abs(raw);
        type = 'Expense';
      } else if (format.sign === 'all-income') {
        amount = Math.abs(raw);
        type = 'Income';
      } else {
        // Signed: negative is an expense, positive is income.
        amount = Math.abs(raw);
        type = raw < 0 ? 'Expense' : 'Income';
      }
    }

    // An explicit Type (or Sens) column beats inferring direction from the
    // sign — our own export writes both, and a bank that writes one is
    // telling us something more reliable than a guess.
    if (typeIdx >= 0) {
      const declared = declaredDirection(cell(typeIdx), typeHeader);
      if (declared) type = declared;
    }

    if (amount === 0) continue;

    const dateISO = parseDate(dateStr, format.date);
    if (!dateISO) continue;

    const originalData: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (values[idx]) originalData[header] = values[idx]!;
    });

    // A category the file states is one the user already chose — re-guessing
    // it from the description throws that away. Same for the impulse flag,
    // which cannot be recovered from the text at all.
    const declaredCategory = categoryIdx >= 0 ? cellText(cell(categoryIdx)) : '';
    const declaredCurrency = currencyIdx >= 0 ? cellText(cell(currencyIdx)) : '';
    // A row that names its currency says where it was spent better than the
    // user's settings do. Only an ISO code counts; a stray symbol does not.
    const currency = /^[a-z]{3}$/i.test(declaredCurrency) ? declaredCurrency : context.currency;

    transactions.push({
      id: `import_${Date.now()}_${r + 1}`,
      date: dateISO,
      description,
      amount,
      type,
      suggestedCategory: suggestFor(description, declaredCategory, context, currency),
      originalData,
      isImpulse:
        impulseIdx >= 0
          ? parseBooleanCell(cell(impulseIdx))
          : detectImpulse(description, amount, currency),
      ...(declaredCurrency ? { currency: declaredCurrency } : {}),
    });
  }

  return transactions;
}

// ── Alipay / WeChat Pay bill import ──────────────────────────────────────────
// Both apps let the user export their transaction bill (账单) as a CSV. Those
// files have ~10-25 metadata rows before the real header, Chinese column names,
// and a 收/支 (income/expense) column. We locate the header row, map columns by
// their Chinese names, and normalize into ParsedTransaction. Files must be UTF-8
// (WeChat exports UTF-8; for Alipay choose the UTF-8 / email export).

export type ImportSource = 'bank' | 'alipay' | 'wechat';

/** Route file content to the right parser based on the source the user picked. */
export function parseStatement(
  content: string,
  source: ImportSource,
  overrides: Partial<CsvFormat> = {},
  context: CategoryContext = {}
): ParsedTransaction[] {
  if (source === 'alipay') return parseChineseBill(content, 'alipay', context);
  if (source === 'wechat') return parseChineseBill(content, 'wechat', context);
  return parseCSV(content, overrides, undefined, context);
}

function parseChineseBill(
  content: string,
  kind: 'alipay' | 'wechat',
  context: CategoryContext,
): ParsedTransaction[] {
  // Both apps write commas; a quoted 备注 may hold one, or a line break.
  const records = readRecords(preamble(content).text, ',');

  // The header row is the first line that names both a time and an amount column.
  const headerIdx = records.findIndex((record) => {
    const line = record.join(',');
    return /交易(创建)?时间/.test(line) && /金额/.test(line);
  });
  if (headerIdx === -1) return [];

  const headers = records[headerIdx]!.map((h) => h.trim());
  const col = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));

  const dateI = col('交易创建时间', '交易时间', '付款时间');
  const amtI = col('金额');
  const typeI = col('收/支', '收支');
  const descI = col('商品说明', '商品名称', '商品', '交易对方', '对方');

  if (dateI === -1 || amtI === -1) return [];

  const out: ParsedTransaction[] = [];
  for (let i = headerIdx + 1; i < records.length; i++) {
    const v = records[i]!.map((x) => x.trim());
    if (isBlank(v)) continue;
    if (v.length <= amtI) continue;

    // 收/支: 收入 → Income, 支出 → Expense; skip neutral rows (不计收支, "/", 其他).
    const flag = typeI >= 0 ? (v[typeI] ?? '') : '';
    if (flag && !/收入|支出/.test(flag)) continue;
    const type: 'Expense' | 'Income' = /收入/.test(flag) ? 'Income' : 'Expense';

    // Alipay and WeChat both export dot decimals and ISO timestamps.
    const amount = Math.abs(parseAmount(v[amtI] ?? '', 'us'));
    if (!amount) continue;

    const dateISO = parseDate(v[dateI] ?? '', 'ymd');
    if (!dateISO) continue;

    const description =
      cellText(descI >= 0 ? v[descI] : '') || (kind === 'alipay' ? '支付宝' : '微信支付');

    out.push({
      id: `${kind}_${Date.now()}_${i}`,
      date: dateISO,
      description,
      amount,
      type,
      // The user's currency, not the bill's: Chinese brands are recognised
      // from the Chinese text whatever the currency, and the user's own
      // region still applies to a merchant abroad written in Latin letters.
      suggestedCategory: suggestFor(description, '', context, context.currency),
      originalData: {},
      // Both apps bill in yuan, so that is the scale of "a large purchase".
      isImpulse: detectImpulse(description, amount, context.currency, 'CNY'),
    });
  }
  return out;
}

/**
 * Text without bidirectional controls. Spreadsheets exported in Arabic put
 * invisible right-to-left marks around cells, and one before "-199,00" hides
 * the minus sign from everything that reads it.
 */
function stripBidi(s: string): string {
  return s.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

/** An amount without its currency: symbols, ISO codes, DH, and the Arabic د.م. and درهم. */
function stripCurrency(s: string): string {
  return s
    .replace(/[$£€¥￥元]/g, '')
    .replace(/\b(?:MAD|DHS?|EUR|USD|GBP|CNY|RMB)\b/gi, '')
    .replace(/د\.\s?م\.?|دراهم|درهم/g, '');
}

/**
 * Parse an amount under a known decimal convention.
 *
 * The convention must be decided per file, not per value: "1.234,56" and
 * "1,234.56" are the same number written two ways, and guessing per-cell gets
 * it wrong for round figures. Previously one set of regexes tried to serve
 * both and turned 1.234,56 into 1.23.
 *
 * Handles $ £ € ¥ ￥ MAD DH د.م., the Chinese 元 suffix, thousands separators
 * (including the spaces of "1 234,56"), a leading +, (parentheses) negatives
 * and trailing-minus negatives.
 */
export function parseAmount(
  amountStr: string,
  convention: DecimalConvention = 'us'
): number {
  if (!amountStr) return 0;

  let s = stripCurrency(stripBidi(amountStr))
    // \s misses the non-breaking and narrow no-break spaces that French-locale
    // exports use as thousands separators, so list them explicitly — and the
    // apostrophes of a Swiss "1'234.50".
    .replace(/[\s\u00a0\u202f'\u2019]/g, '')
    .replace(/\+/g, '')
    .trim();

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    // Some European exports write the sign after the number.
    negative = true;
    s = s.slice(0, -1);
  }

  if (convention === 'european') {
    // '.' groups thousands, ',' is the decimal point.
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // ',' groups thousands, '.' is the decimal point.
    s = s.replace(/,/g, '');
  }

  const value = parseFloat(s);
  if (!isFinite(value)) return 0;
  return negative ? -value : value;
}

/** True when y-m-d names a real calendar date (rejects 31 Feb, month 15, ...). */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function toISO(year: number, month: number, day: number): string | null {
  if (!isRealDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTHS =
  'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|' +
  'sep|sept|september|oct|october|nov|november|dec|december';
const WEEKDAYS =
  'mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|' +
  'sat|saturday|sun|sunday';
/** An English month, written out or abbreviated, as a word of its own. */
const MONTH_NAME = new RegExp(`\\b(?:${MONTHS})\\b`, 'i');
/** How a written-out date begins: with its day, its month or its weekday. */
const TEXTUAL_DATE_START = new RegExp(`^(?:\\d|(?:${MONTHS}|${WEEKDAYS})\\b)`, 'i');

/**
 * Parse a date under a known day/month ordering.
 *
 * The ordering has to come from the file, not from each value: 01/09/2026 is
 * 1 September on a French or Moroccan statement and 9 January on a US one, and
 * nothing in the string itself says which. The previous implementation always
 * assumed month-first, so it silently shifted every European date — and for
 * days past the 12th it emitted strings like "2026-15-03", an impossible month
 * that went straight into the database.
 */
export function parseDate(
  dateStr: string,
  convention: DateConvention = 'mdy'
): string | null {
  const cleaned = stripBidi(dateStr ?? '').trim();
  if (!cleaned) return null;

  // Explicit year-first is unambiguous whatever the file's convention.
  const isoMatch = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    return toISO(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const parts = cleaned.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    let year = Number(parts[3]);
    if (parts[3]!.length === 2) year += year < 70 ? 2000 : 1900;

    // A component above 12 can only be the day, whatever the file's convention.
    let day: number;
    let month: number;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      day = second;
      month = first;
    } else if (convention === 'dmy') {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    return toISO(year, month, day);
  }

  // Textual formats ("15 Jan 2026", "Jan 15, 2026") — unambiguous by name.
  // Only a string that is one: the engine's own parser reads anything it can,
  // and took "Solde au 12/10/2026", a balance line under a French table, for
  // the 10th of December — a balance imported as a transaction.
  if (TEXTUAL_DATE_START.test(cleaned) && MONTH_NAME.test(cleaned)) {
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return toISO(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }
  }

  return null;
}

// ── What the user already has ────────────────────────────────────────────────

/** A transaction already in the app, as an import reads it. */
export interface ExistingTransaction extends LearnableTransaction {
  dateISO: string;
  amount: number;
}

/**
 * The key a row is matched on to skip one already imported: its date, its
 * amount and the start of its description.
 */
export function duplicateKey(
  dateISO: string,
  amount: number,
  description: string | null | undefined,
): string {
  return `${dateISO}_${amount}_${(description ?? '').substring(0, 20)}`;
}

export interface ImportHistory {
  /** The duplicateKey of every transaction already in the app. */
  existingKeys: Set<string>;
  /** What every parse of the file is given: how this user files each merchant, and their currency. */
  context: CategoryContext;
}

/**
 * What the user's own transactions tell an import: which rows are already in,
 * and how they file each merchant.
 *
 * The import screen used to pass the parser only the currency, so a CSV import
 * ignored the history that Siri, quick-add and shared receipts all learn from:
 * Carrefour filed under Shopping a hundred times still arrived as the keyword
 * table's Food. Built once per file from the transactions the screen already
 * reads for duplicates, and given to every parse of that file — the first, and
 * each re-parse after a corrected convention or column.
 */
export function importHistory(
  existing: readonly ExistingTransaction[],
  currency: string | null | undefined,
): ImportHistory {
  return {
    existingKeys: new Set(existing.map((tx) => duplicateKey(tx.dateISO, tx.amount, tx.note))),
    context: { memory: buildMerchantMemory(existing), currency: currency ?? null },
  };
}

// Generate import preview
export function generateImportPreview(
  transactions: ParsedTransaction[],
  existingTransactionIds: Set<string>
): ImportPreview {
  let duplicatesFound = 0;
  const uniqueTransactions = transactions.filter(tx => {
    // Simple duplicate detection based on date, amount, description
    if (existingTransactionIds.has(duplicateKey(tx.date, tx.amount, tx.description))) {
      duplicatesFound++;
      return false;
    }
    return true;
  });

  const totalExpenses = uniqueTransactions
    .filter(tx => tx.type === 'Expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalIncome = uniqueTransactions
    .filter(tx => tx.type === 'Income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const categoryBreakdown: Record<string, number> = {};
  uniqueTransactions
    .filter(tx => tx.type === 'Expense')
    .forEach(tx => {
      categoryBreakdown[tx.suggestedCategory] =
        (categoryBreakdown[tx.suggestedCategory] || 0) + tx.amount;
    });

  const dates = uniqueTransactions.map(tx => tx.date).sort();
  const dateRange = {
    start: dates[0] || '',
    end: dates[dates.length - 1] || '',
  };

  return {
    transactions: uniqueTransactions,
    totalExpenses,
    totalIncome,
    categoryBreakdown,
    dateRange,
    duplicatesFound,
  };
}
