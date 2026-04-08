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

  // Parse header row
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().trim());

  // Find column indices
  const dateIdx = headers.findIndex(h =>
    h.includes('date') || h.includes('posted') || h.includes('transaction date')
  );
  const descIdx = headers.findIndex(h =>
    h.includes('description') || h.includes('memo') || h.includes('merchant') || h.includes('payee')
  );
  const amountIdx = headers.findIndex(h =>
    h.includes('amount') || h.includes('debit') || h.includes('credit')
  );
  const debitIdx = headers.findIndex(h => h.includes('debit') || h.includes('withdrawal'));
  const creditIdx = headers.findIndex(h => h.includes('credit') || h.includes('deposit'));

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

// Parse amount string to number
function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;

  // Remove currency symbols, commas, and whitespace
  const cleaned = amountStr.replace(/[$£€,\s]/g, '').trim();

  // Handle parentheses for negative numbers
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return -parseFloat(cleaned.slice(1, -1)) || 0;
  }

  return parseFloat(cleaned) || 0;
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
