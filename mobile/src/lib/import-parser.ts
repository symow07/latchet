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

// Parse CSV content into transactions
export function parseCSV(csvContent: string): ParsedTransaction[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header row (deaccented + lowercased so French headers like "Libellé",
  // "Débit", "Crédit", "Montant" on Moroccan/European statements match too).
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => deaccent(h.toLowerCase()).trim());

  // Find column indices
  const dateIdx = headers.findIndex(h =>
    h.includes('date') || h.includes('posted')
  );
  const descIdx = headers.findIndex(h =>
    h.includes('description') || h.includes('memo') || h.includes('merchant') ||
    h.includes('payee') || h.includes('libelle') || h.includes('motif') || h.includes('operation')
  );
  const amountIdx = headers.findIndex(h =>
    h.includes('amount') || h.includes('debit') || h.includes('credit') || h.includes('montant')
  );
  const debitIdx = headers.findIndex(h => h.includes('debit') || h.includes('withdrawal') || h.includes('retrait'));
  const creditIdx = headers.findIndex(h => h.includes('credit') || h.includes('deposit') || h.includes('versement'));

  if (dateIdx === -1 || (amountIdx === -1 && debitIdx === -1)) {
    throw new Error('Could not identify required columns (date, amount)');
  }

  const transactions: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    if (values.length < Math.max(dateIdx, descIdx, amountIdx, debitIdx, creditIdx) + 1) continue;

    const dateStr = values[dateIdx];
    const description = descIdx >= 0 ? values[descIdx] : 'Unknown';

    let amount = 0;
    let type: 'Expense' | 'Income' = 'Expense';

    if (debitIdx >= 0 && creditIdx >= 0) {
      // Separate debit/credit columns
      const debit = parseAmount(values[debitIdx]);
      const credit = parseAmount(values[creditIdx]);

      if (debit > 0) {
        amount = debit;
        type = 'Expense';
      } else if (credit > 0) {
        amount = credit;
        type = 'Income';
      }
    } else {
      // Single amount column
      amount = parseAmount(values[amountIdx]);

      // Negative amounts are typically expenses, positive are income
      if (amount < 0) {
        amount = Math.abs(amount);
        type = 'Expense';
      } else {
        type = 'Income';
      }
    }

    if (amount === 0) continue;

    const dateISO = parseDate(dateStr);
    if (!dateISO) continue;

    const originalData: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (values[idx]) originalData[header] = values[idx];
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
export function parseStatement(content: string, source: ImportSource): ParsedTransaction[] {
  if (source === 'alipay') return parseChineseBill(content, 'alipay');
  if (source === 'wechat') return parseChineseBill(content, 'wechat');
  return parseCSV(content);
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

    const amount = Math.abs(parseAmount(v[amtI]));
    if (!amount) continue;

    const dateISO = parseDate(v[dateI]);
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

// Parse amount string to number. Handles $ £ € ¥ ￥ (CNY), the Chinese 元
// suffix, thousands separators, a leading + sign, and (parentheses) negatives.
function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;

  const cleaned = amountStr
    .replace(/[$£€¥￥元\s+]/g, '')
    // French/Moroccan statements can use space as thousands sep + comma decimal.
    .replace(/ /g, '')
    .replace(/,(?=\d{3}\b)/g, '') // comma thousands sep
    .replace(/,(\d{1,2})$/, '.$1') // comma decimal → dot
    .trim();

  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return -parseFloat(cleaned.slice(1, -1)) || 0;
  }

  return parseFloat(cleaned) || 0;
}

// Strip diacritics so French headers (Libellé, Débit, Crédit) match.
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Parse various date formats
function parseDate(dateStr: string): string | null {
  const cleaned = dateStr.trim();

  // Try YYYY-MM-DD first
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try MM/DD/YYYY or MM-DD-YYYY
  const usMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try parsing as Date object
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
