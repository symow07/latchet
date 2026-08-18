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

// Keywords for auto-categorization
const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  Food: [
    'restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'burger', 'pizza',
    'doordash', 'uber eats', 'grubhub', 'grocery', 'supermarket', 'walmart',
    'whole foods', 'trader joe', 'kroger', 'safeway', 'food', 'meal', 'lunch',
    'dinner', 'breakfast', 'bakery', 'deli', 'chipotle', 'subway', 'wendy',
    'taco', 'sushi', 'chinese', 'thai', 'indian', 'italian', 'mexican',
  ],
  Gym: [
    'gym', 'fitness', 'planet fitness', 'la fitness', 'equinox', 'crossfit',
    'yoga', 'pilates', 'workout', 'training', 'personal trainer', 'peloton',
    'orange theory', 'anytime fitness', 'gold gym', '24 hour fitness',
  ],
  Transport: [
    'uber', 'lyft', 'taxi', 'gas', 'fuel', 'shell', 'chevron', 'exxon', 'bp',
    'parking', 'transit', 'metro', 'bus', 'train', 'airline', 'flight',
    'delta', 'united', 'american airlines', 'southwest', 'car wash', 'toll',
    'dmv', 'registration', 'insurance', 'auto', 'vehicle',
  ],
  Shopping: [
    'amazon', 'target', 'walmart', 'costco', 'best buy', 'apple store',
    'clothing', 'shoes', 'nike', 'adidas', 'zara', 'h&m', 'nordstrom',
    'macys', 'kohls', 'ross', 'tjmaxx', 'marshalls', 'ebay', 'etsy',
    'ikea', 'home depot', 'lowes', 'furniture', 'electronics', 'retail',
  ],
  Subscriptions: [
    'netflix', 'spotify', 'hulu', 'disney', 'hbo', 'apple music', 'youtube',
    'amazon prime', 'subscription', 'membership', 'recurring', 'monthly',
    'annual', 'adobe', 'microsoft', 'dropbox', 'icloud', 'google one',
    'gym membership', 'software', 'saas', 'cloud',
  ],
  Other: [], // Fallback category
};

export interface ParsedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'Expense' | 'Income';
  suggestedCategory: Category;
  originalData: Record<string, string>;
  isImpulse: boolean;
}

export interface ImportPreview {
  transactions: ParsedTransaction[];
  totalExpenses: number;
  totalIncome: number;
  categoryBreakdown: Record<string, number>;
  dateRange: { start: string; end: string };
  duplicatesFound: number;
}

// Auto-categorize based on description
export function autoCategorize(description: string): Category {
  const lowerDesc = description.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'Other') continue;

    for (const keyword of keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) {
        return category as Category;
      }
    }
  }

  return 'Other';
}

// Detect if a purchase might be an impulse buy based on description
export function detectImpulse(description: string, amount: number): boolean {
  const lowerDesc = description.toLowerCase();

  // High-value shopping or entertainment
  if (amount > 100 && CATEGORY_KEYWORDS.Shopping.some(k => lowerDesc.includes(k))) {
    return true;
  }

  // Late-night food delivery indicators
  const impulseKeywords = [
    'doordash', 'uber eats', 'grubhub', 'postmates', 'delivery',
    'amazon', 'impulse', 'sale', 'clearance', 'flash sale',
  ];

  return impulseKeywords.some(k => lowerDesc.includes(k));
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

/** Column indices and header row, shared by detection and parsing. */
function locateColumns(lines: string[]) {
  const headers = parseCSVLine(lines[0]!).map((h) => deaccent(h.toLowerCase()).trim());

  const dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('posted'));
  const descIdx = headers.findIndex(
    (h) =>
      h.includes('description') || h.includes('memo') || h.includes('merchant') ||
      h.includes('payee') || h.includes('libelle') || h.includes('motif') || h.includes('operation')
  );
  const amountIdx = headers.findIndex(
    (h) => h.includes('amount') || h.includes('debit') || h.includes('credit') || h.includes('montant')
  );
  const debitIdx = headers.findIndex(
    (h) => h.includes('debit') || h.includes('withdrawal') || h.includes('retrait')
  );
  const creditIdx = headers.findIndex(
    (h) => h.includes('credit') || h.includes('deposit') || h.includes('versement')
  );

  return { headers, dateIdx, descIdx, amountIdx, debitIdx, creditIdx };
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
  fallbackDate: DateConvention = 'mdy'
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

  const { dateIdx, amountIdx, debitIdx, creditIdx } = locateColumns(lines);

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
  } else if (debitIdx >= 0 && creditIdx === -1) {
    // A debit column with no credit column is all outflow, whatever the sign.
    sign = { convention: 'all-expense', ambiguous: false };
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

// Parse CSV content into transactions
export function parseCSV(
  csvContent: string,
  overrides: Partial<CsvFormat> = {}
): ParsedTransaction[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const format: CsvFormat = {
    ...detectCsvFormat(csvContent, overrides.date),
    ...overrides,
  };

  // Parse header row (deaccented + lowercased so French headers like "Libellé",
  // "Débit", "Crédit", "Montant" on Moroccan/European statements match too).
  const { headers, dateIdx, descIdx, amountIdx, debitIdx, creditIdx } = locateColumns(lines);

  if (dateIdx === -1 || (amountIdx === -1 && debitIdx === -1)) {
    throw new Error('Could not identify required columns (date, amount)');
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
    } else {
      const raw = parseAmount(values[amountIdx]!, format.decimal);

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

    if (amount === 0) continue;

    const dateISO = parseDate(dateStr, format.date);
    if (!dateISO) continue;

    const originalData: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (values[idx]) originalData[header] = values[idx]!;
    });

    transactions.push({
      id: `import_${Date.now()}_${i}`,
      date: dateISO,
      description: description.trim(),
      amount,
      type,
      suggestedCategory: autoCategorize(description),
      originalData,
      isImpulse: detectImpulse(description, amount),
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
  overrides: Partial<CsvFormat> = {}
): ParsedTransaction[] {
  if (source === 'alipay') return parseChineseBill(content, 'alipay');
  if (source === 'wechat') return parseChineseBill(content, 'wechat');
  return parseCSV(content, overrides);
}

function parseChineseBill(content: string, kind: 'alipay' | 'wechat'): ParsedTransaction[] {
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
      suggestedCategory: autoCategorize(description),
      originalData: {},
      isImpulse: detectImpulse(description, amount),
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

// Generate import preview
export function generateImportPreview(
  transactions: ParsedTransaction[],
  existingTransactionIds: Set<string>
): ImportPreview {
  let duplicatesFound = 0;
  const uniqueTransactions = transactions.filter(tx => {
    // Simple duplicate detection based on date, amount, description
    const key = `${tx.date}_${tx.amount}_${tx.description.substring(0, 20)}`;
    if (existingTransactionIds.has(key)) {
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
