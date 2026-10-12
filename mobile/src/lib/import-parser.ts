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
}

export function detectDecimalConvention(samples: string[]): {
  convention: DecimalConvention;
  ambiguous: boolean;
} {
  let european = 0;
  let us = 0;

  for (const raw of samples) {
    const s = (raw ?? '').replace(/[^\d.,]/g, '');
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

/** Column indices and header row, shared by detection and parsing. */
function locateColumns(lines: string[]) {
  const headers = parseCSVLine(lines[0]!).map((h) => deaccent(h.toLowerCase()).trim());

  const dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('posted'));
  // "Opération" names the description column only when nothing better does:
  // French and Moroccan banks also write "Date opération" for the date, and
  // taking that as the description files every row under its own date.
  const isDescription = (h: string, i: number) =>
    i !== dateIdx &&
    (h.includes('description') || h.includes('memo') || h.includes('merchant') ||
      h.includes('payee') || h.includes('libelle') || h.includes('motif'));
  const strongDescIdx = headers.findIndex(isDescription);
  const descIdx =
    strongDescIdx >= 0
      ? strongDescIdx
      : headers.findIndex((h, i) => i !== dateIdx && h.includes('operation'));
  const amountIdx = headers.findIndex(
    (h) => h.includes('amount') || h.includes('debit') || h.includes('credit') || h.includes('montant')
  );
  const debitIdx = headers.findIndex(
    (h) => h.includes('debit') || h.includes('withdrawal') || h.includes('retrait')
  );
  const creditIdx = headers.findIndex(
    (h) => h.includes('credit') || h.includes('deposit') || h.includes('versement')
  );

  // Columns our own export writes. Present in a re-imported backup, absent in
  // a bank statement — when they are there they are authoritative, because
  // re-deriving them loses information the user already corrected by hand.
  const categoryIdx = headers.findIndex((h) => h.startsWith('categor'));
  const typeIdx = headers.findIndex((h) => h === 'type');
  const impulseIdx = headers.findIndex((h) => h.includes('impulse'));
  const currencyIdx = headers.findIndex(
    (h) => h === 'currency' || h === 'devise'
  );

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

/** Interpret a boolean-ish cell ("true", "1", "yes", "y"). */
function parseBooleanCell(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'y';
}

/**
 * Infer a file's decimal, date and sign conventions from its own contents.
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
  mappingOverride?: Partial<ColumnMapping>
): CsvFormat {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) {
    return {
      decimal: 'us',
      date: fallbackDate,
      sign: 'signed',
      dateAmbiguous: true,
      signAmbiguous: true,
      decimalAmbiguous: true,
    };
  }

  const located = locateColumns(lines);
  const dateIdx = mappingOverride?.dateIdx ?? located.dateIdx;
  const amountIdx = mappingOverride?.amountIdx ?? located.amountIdx;
  const debitIdx = mappingOverride?.debitIdx ?? located.debitIdx;
  const creditIdx = mappingOverride?.creditIdx ?? located.creditIdx;

  const amountCells: string[] = [];
  const dateCells: string[] = [];
  // A few hundred rows is plenty of evidence and keeps large files fast.
  const limit = Math.min(lines.length, 300);
  for (let i = 1; i < limit; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    if (dateIdx >= 0 && values[dateIdx]) dateCells.push(values[dateIdx]!);
    for (const idx of [amountIdx, debitIdx, creditIdx]) {
      if (idx >= 0 && values[idx]) amountCells.push(values[idx]!);
    }
  }

  const decimal = detectDecimalConvention(amountCells);
  const date = detectDateConvention(dateCells, fallbackDate);

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
  }

  return {
    decimal: decimal.convention,
    date: date.convention,
    sign: sign.convention,
    dateAmbiguous: date.ambiguous,
    signAmbiguous: sign.ambiguous,
    decimalAmbiguous: decimal.ambiguous,
  };
}

/**
 * Look at a file without committing to parsing it.
 *
 * Never throws. When `missing` is non-empty the caller should ask the user to
 * map those columns and pass the result back through `parseCSV`.
 */
export function inspectCsv(
  csvContent: string,
  fallbackDate: DateConvention = 'mdy'
): CsvInspection {
  const lines = csvContent.trim().split('\n').filter((l) => l.trim());
  const format = detectCsvFormat(csvContent, fallbackDate);

  if (lines.length === 0) {
    return {
      headers: [],
      sampleRows: [],
      mapping: emptyMapping(),
      missing: ['date', 'amount'],
      format,
    };
  }

  const located = locateColumns(lines);
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
    headers: parseCSVLine(lines[0]!).map((h) => h.trim()),
    sampleRows: lines.slice(1, 6).map((l) => parseCSVLine(l).map((v) => v.trim())),
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
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const format: CsvFormat = {
    ...detectCsvFormat(csvContent, overrides.date, mappingOverride),
    ...overrides,
  };

  // Parse header row (deaccented + lowercased so French headers like "Libellé",
  // "Débit", "Crédit", "Montant" on Moroccan/European statements match too).
  const located = locateColumns(lines);
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

  const transactions: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    if (values.length < Math.max(dateIdx, descIdx, amountIdx, debitIdx, creditIdx) + 1) continue;

    const dateStr = values[dateIdx]!;
    const description = descIdx >= 0 ? values[descIdx]! : 'Unknown';

    let amount = 0;
    let type: 'Expense' | 'Income' = 'Expense';

    if (debitIdx >= 0 && creditIdx >= 0) {
      // Separate debit/credit columns — direction is explicit.
      const debit = Math.abs(parseAmount(values[debitIdx]!, format.decimal));
      const credit = Math.abs(parseAmount(values[creditIdx]!, format.decimal));

      if (debit > 0) {
        amount = debit;
        type = 'Expense';
      } else if (credit > 0) {
        amount = credit;
        type = 'Income';
      }
    } else if (amountIdx === -1 && creditIdx >= 0) {
      // A credit column with no debit column is all inflow.
      amount = Math.abs(parseAmount(values[creditIdx]!, format.decimal));
      type = 'Income';
    } else {
      const column = amountIdx >= 0 ? amountIdx : debitIdx;
      const raw = parseAmount(values[column]!, format.decimal);

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

    // An explicit Type column beats inferring direction from the sign — our
    // own export writes both, and a bank that writes one is telling us
    // something more reliable than a guess.
    if (typeIdx >= 0) {
      const declared = (values[typeIdx] ?? '').trim().toLowerCase();
      if (declared === 'income') type = 'Income';
      else if (declared === 'expense') type = 'Expense';
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
    const declaredCategory = categoryIdx >= 0 ? (values[categoryIdx] ?? '').trim() : '';
    const declaredCurrency = currencyIdx >= 0 ? (values[currencyIdx] ?? '').trim() : '';
    // A row that names its currency says where it was spent better than the
    // user's settings do. Only an ISO code counts; a stray symbol does not.
    const currency = /^[a-z]{3}$/i.test(declaredCurrency) ? declaredCurrency : context.currency;

    transactions.push({
      id: `import_${Date.now()}_${i}`,
      date: dateISO,
      description: description.trim(),
      amount,
      type,
      suggestedCategory: suggestFor(description, declaredCategory, context, currency),
      originalData,
      isImpulse:
        impulseIdx >= 0
          ? parseBooleanCell(values[impulseIdx])
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
  const lines = content.split(/\r?\n/);

  // The header row is the first line that names both a time and an amount column.
  const headerIdx = lines.findIndex(
    (l) => /交易(创建)?时间/.test(l) && /金额/.test(l),
  );
  if (headerIdx === -1) return [];

  const headers = parseCSVLine(lines[headerIdx]).map((h) => h.trim());
  const col = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));

  const dateI = col('交易创建时间', '交易时间', '付款时间');
  const amtI = col('金额');
  const typeI = col('收/支', '收支');
  const descI = col('商品说明', '商品名称', '商品', '交易对方', '对方');

  if (dateI === -1 || amtI === -1) return [];

  const out: ParsedTransaction[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const v = parseCSVLine(raw).map((x) => x.trim());
    if (v.length <= amtI) continue;

    // 收/支: 收入 → Income, 支出 → Expense; skip neutral rows (不计收支, "/", 其他).
    const flag = typeI >= 0 ? v[typeI] : '';
    if (flag && !/收入|支出/.test(flag)) continue;
    const type: 'Expense' | 'Income' = /收入/.test(flag) ? 'Income' : 'Expense';

    // Alipay and WeChat both export dot decimals and ISO timestamps.
    const amount = Math.abs(parseAmount(v[amtI], 'us'));
    if (!amount) continue;

    const dateISO = parseDate(v[dateI], 'ymd');
    if (!dateISO) continue;

    const description = (descI >= 0 ? v[descI] : '').trim() || (kind === 'alipay' ? '支付宝' : '微信支付');

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

// Parse a CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

/**
 * Parse an amount under a known decimal convention.
 *
 * The convention must be decided per file, not per value: "1.234,56" and
 * "1,234.56" are the same number written two ways, and guessing per-cell gets
 * it wrong for round figures. Previously one set of regexes tried to serve
 * both and turned 1.234,56 into 1.23.
 *
 * Handles $ £ € ¥ ￥ MAD DH, the Chinese 元 suffix, thousands separators,
 * a leading +, (parentheses) negatives and trailing-minus negatives.
 */
export function parseAmount(
  amountStr: string,
  convention: DecimalConvention = 'us'
): number {
  if (!amountStr) return 0;

  let s = amountStr
    .replace(/[$£€¥￥元]/g, '')
    .replace(/\b(?:MAD|DHS?|EUR|USD|GBP|CNY|RMB)\b/gi, '')
    // \s misses the non-breaking and narrow no-break spaces that French-locale
    // exports use as thousands separators, so list them explicitly.
    .replace(/[\s  ]/g, '')
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

// Strip diacritics so French headers (Libellé, Débit, Crédit) match.
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
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
  const cleaned = (dateStr ?? '').trim();
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
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return toISO(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
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
