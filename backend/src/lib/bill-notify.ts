/**
 * The bill-reminder push, in the recipient's own language and currency
 * (Phase 5 decision 2).
 *
 * It used to be English for everyone, with the amount glued to a symbol
 * ("€1200"). The app ships in four languages, and this is a push people are
 * meant to read and act on, so it follows UserSettings.locale the way the
 * household notification does (household-notify.ts): en, fr, zh or ar, and
 * English for anything else. The amount is written the way the app writes
 * money in that language — the same Intl locale tags (mobile
 * lib/i18n/core.ts) and the narrow symbol of the user's currency.
 *
 * Pure, so the wording can be tested without a database or a push service.
 */
import { normalizeNotifyLocale, type NotifyLocale } from "./household-notify";

/** The app's Intl tag for each language (mobile lib/i18n/core.ts INTL_TAGS). */
const INTL_TAGS: Record<NotifyLocale, string> = {
  en: "en-US",
  fr: "fr-FR",
  zh: "zh-CN",
  // Western digits, as the app shows them; ar-EG would not.
  ar: "ar-MA",
};

/** Where a bare symbol goes when the currency code cannot be formatted. */
const SYMBOL_FIRST: Record<NotifyLocale, boolean> = { en: true, fr: false, zh: true, ar: false };

/**
 * `amount` as money in `locale`: by the ISO currency code when Intl knows it
 * (its symbol, placement, grouping and minor units), otherwise the saved
 * symbol beside a number grouped for the locale, and "$" when there is
 * neither — what the push always fell back to.
 */
export function formatBillAmount(
  rawLocale: unknown,
  amount: number,
  currency: string | null | undefined,
  currencySymbol: string | null | undefined
): string {
  const locale = normalizeNotifyLocale(rawLocale);
  const tag = INTL_TAGS[locale];
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(tag, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).format(amount);
    } catch {
      // Not a currency this runtime knows: the symbol below.
    }
  }
  const number = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const symbol = currencySymbol?.trim() || "$";
  return SYMBOL_FIRST[locale] ? `${symbol}${number}` : `${number} ${symbol}`;
}

const TITLE: Record<NotifyLocale, string> = {
  en: "Bill due 💸",
  fr: "Facture à régler 💸",
  zh: "账单到期 💸",
  ar: "فاتورة مستحقة 💸",
};

/** Due on the user's today. */
const DUE_TODAY: Record<NotifyLocale, (name: string, amount: string) => string> = {
  en: (name, amount) => `"${name}" — ${amount} is due today.`,
  fr: (name, amount) => `« ${name} » — ${amount} à régler aujourd’hui.`,
  zh: (name, amount) => `“${name}”（${amount}）今天到期。`,
  ar: (name, amount) => `«${name}» — ${amount} تُستحق اليوم.`,
};

/** Due on a day already past: first noticed late (made with a past date, or the server was down). */
const OVERDUE: Record<NotifyLocale, (name: string, amount: string) => string> = {
  en: (name, amount) => `"${name}" — ${amount} is overdue.`,
  fr: (name, amount) => `« ${name} » — ${amount} en retard de paiement.`,
  zh: (name, amount) => `“${name}”（${amount}）已逾期。`,
  ar: (name, amount) => `«${name}» — ${amount} متأخرة عن موعد استحقاقها.`,
};

export interface BillNotice {
  name: string;
  amount: number;
  /** UserSettings.currency, an ISO 4217 code. */
  currency: string | null | undefined;
  /** UserSettings.currencySymbol, used when the code cannot be formatted. */
  currencySymbol: string | null | undefined;
  /** The due date is before the user's today. */
  overdue: boolean;
}

/** The push for one bill, in `rawLocale` (UserSettings.locale); English for anything else. */
export function billDueNotification(rawLocale: unknown, bill: BillNotice): { title: string; body: string } {
  const locale = normalizeNotifyLocale(rawLocale);
  const amount = formatBillAmount(locale, bill.amount, bill.currency, bill.currencySymbol);
  const body = (bill.overdue ? OVERDUE : DUE_TODAY)[locale](bill.name, amount);
  return { title: TITLE[locale], body };
}
