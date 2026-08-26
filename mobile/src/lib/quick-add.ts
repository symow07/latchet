/**
 * Turning what someone typed into a notification into a transaction.
 *
 * The evening streak reminder carries a text field, so "12.50 coffee" can be
 * logged from the lock screen without opening the app. That text is free-form
 * and typed one-handed, so the parsing is deliberately forgiving — and
 * deliberately refuses rather than guessing when there is no number in it.
 *
 * Dependency-free so the parsing rules can be tested without a device.
 */

export interface QuickAdd {
  amount: number;
  type: 'Expense' | 'Income';
  note: string;
}

/**
 * The first number in the text, read as a whole even when it is grouped.
 *
 * The trailing `\d{3}` groups matter: a bare separator class would glue "20 30"
 * into 2030, a silent hundred-fold error on a field people type one-handed.
 * Requiring exactly three digits after a separator means only real grouping —
 * "1,234.56", "1.234,56", "1 234,56" — is absorbed, and two separate figures
 * stay separate.
 */
const NUMBER = /\d+(?:[\u00a0\u202f .,]\d{3})*(?:[.,]\d{1,2})?/;

/**
 * Read a number the way the person typing it meant it.
 *
 * "1,234.56" and "1.234,56" are the same amount in different conventions, and
 * the app is used in both. The last separator that has exactly two digits after
 * it is the decimal point; anything else is grouping and is discarded. The
 * locale is not consulted on purpose — someone can type either way regardless
 * of what their phone is set to.
 */
function readAmount(raw: string): number {
  const cleaned = raw.replace(/[  \s]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const sep = Math.max(lastComma, lastDot);

  let normalised: string;
  if (sep >= 0 && cleaned.length - sep - 1 <= 2 && cleaned.length - sep - 1 > 0) {
    normalised = cleaned.slice(0, sep).replace(/[.,]/g, '') + '.' + cleaned.slice(sep + 1);
  } else {
    // No decimal part: every separator is grouping. "1.234" is one thousand
    // two hundred and thirty-four, not 1.234.
    normalised = cleaned.replace(/[.,]/g, '');
  }
  const n = Number(normalised);
  return isFinite(n) ? Math.abs(n) : NaN;
}

/** Words that mean money came in. Matched whole, so "paid" alone stays an expense. */
const INCOME_WORDS = /(^|\s)(got paid|paid me|received|refund|refunded|income|earned|salary|bonus)(\s|$)/i;

/**
 * Parse one line of quick-add text.
 *
 * Returns null when there is no amount to be found. Logging a transaction with
 * no figure would be worse than dropping it — a zero-value row in the ledger is
 * noise the user then has to find and delete.
 */
export function parseQuickAdd(input: string): QuickAdd | null {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const match = NUMBER.exec(text);
  if (!match) return null;

  const amount = readAmount(match[0]);
  if (!isFinite(amount) || amount <= 0) return null;

  // A leading "+" is the explicit form; the words are the natural one.
  const explicitIncome = /(^|\s)\+\s*$/.test(text.slice(0, match.index));
  const type: 'Expense' | 'Income' =
    explicitIncome || INCOME_WORDS.test(text) ? 'Income' : 'Expense';

  const note = (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
    // Currency symbols and the leading sign carry no information once the
    // amount and direction have been read.
    .replace(/[+\-$€£¥₹¢₽₩₪₺؋]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return { amount, type, note };
}
