/**
 * Currencies: the ISO 4217 list, the markers people write next to amounts, and
 * the rules for ambiguous ones. Unknown stays unknown — a bare "$" becomes USD
 * only with US evidence, a bare "¥" becomes CNY only with Chinese context.
 */

/** Active ISO 4217 currency codes (fund, metal and test codes left out). */
export const ISO_4217 = new Set(
  (
    "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD " +
    "CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP " +
    "GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD " +
    "KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN " +
    "NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP " +
    "SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES " +
    "VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG"
  ).split(" "),
);

/** Codes that are also everyday English words; only trusted as a suffix/prefix code in capitals beside a number. */
const WORDLIKE_CODES = new Set(["ALL", "TOP", "CUP", "PEN", "SOS", "BAM", "BOB", "MOP", "GEL", "NAD", "LAK", "WST", "DOP", "PAB"]);

/** Currencies whose everyday amounts run into the thousands or millions. */
export const HIGH_UNIT_CURRENCIES = new Set(
  "JPY KRW VND IDR IRR COP CLP HUF ISK INR PKR LKR NGN KZT UZS UGX TZS MMK KHR LAK PYG IQD LBP SYP MNT RUB PHP THB TWD AMD RSD DZD XOF XAF KES ETB CRC ARS MGA GNF SLE".split(
    " ",
  ),
);

/** Normal ceiling for an amount; generous for yearly plans, low enough to reject phone numbers. */
export function amountCeiling(currency: string | null): number {
  return currency && HIGH_UNIT_CURRENCIES.has(currency) ? 1_000_000_000 : 200_000;
}

export interface CurrencyContext {
  /** Han characters and no kana, or a .cn sender, or 元/人民币/RMB. */
  chinese: boolean;
  /** Kana, 円, JPY or a .jp sender. */
  japanese: boolean;
  /** Evidence that a bare "$" means US dollars. */
  usDollar: boolean;
  /** A dollar currency other than USD named in the email or implied by the sender's country. */
  dollarCode: string | null;
  /** UAE context turns a dirham into AED; otherwise it is Moroccan. */
  emirati: boolean;
}

/**
 * Explicit markers: each resolves without context. Longest first so "US$"
 * wins over "$". Keys are matched case-sensitively unless noted.
 */
export const EXPLICIT_MARKERS: [string, string][] = [
  ["US$", "USD"], ["U$S", "USD"], ["USD$", "USD"], ["C$", "CAD"], ["CA$", "CAD"], ["CAD$", "CAD"], ["A$", "AUD"], ["AU$", "AUD"],
  ["NZ$", "NZD"], ["HK$", "HKD"], ["S$", "SGD"], ["SG$", "SGD"], ["MX$", "MXN"], ["NT$", "TWD"], ["R$", "BRL"],
  ["CN¥", "CNY"], ["JP¥", "JPY"], ["€", "EUR"], ["£", "GBP"], ["₹", "INR"], ["₩", "KRW"], ["₺", "TRY"], ["₽", "RUB"],
  ["₪", "ILS"], ["₱", "PHP"], ["₫", "VND"], ["฿", "THB"], ["₦", "NGN"], ["₴", "UAH"], ["zł", "PLN"], ["Kč", "CZK"],
  ["E£", "EGP"], ["円", "JPY"], ["日元", "JPY"], ["人民币", "CNY"], ["港元", "HKD"], ["港币", "HKD"], ["新台币", "TWD"],
  ["美元", "USD"], ["欧元", "EUR"], ["英镑", "GBP"], ["澳元", "AUD"], ["加元", "CAD"], ["RMB", "CNY"],
  ["د.م.", "MAD"], ["د.م", "MAD"], ["د.إ", "AED"], ["ر.س", "SAR"], ["ر.ق", "QAR"], ["د.ك", "KWD"], ["ج.م", "EGP"],
  ["د.ت", "TND"], ["د.ج", "DZD"], ["ر.ع", "OMR"], ["د.ب", "BHD"],
];

/** Words written after an amount ("12 euros", "99 dirhams", "25 yuan"). Case-insensitive. */
export const WORD_MARKERS: [RegExp, string | "DIRHAM" | "DOLLAR" | "YEN"][] = [
  [/^euros?$/i, "EUR"],
  [/^(?:pounds?|livres? sterling)$/i, "GBP"],
  [/^(?:dirhams?|dhs?|درهم|دراهم|درهما)$/i, "DIRHAM"],
  [/^(?:yuan|renminbi)$/i, "CNY"],
  [/^(?:dollars?|dólares)$/i, "DOLLAR"],
  [/^(?:元|块|圆)$/, "YEN"],
  [/^(?:ريال|ريالات)$/, "SAR"],
  [/^(?:جنيه)$/, "EGP"],
];

/** Resolve a marker as written beside an amount. Returns null when the email does not make it evident. */
export function resolveMarker(marker: string, ctx: CurrencyContext): string | null {
  const m = marker.trim();
  if (!m) return null;
  for (const [k, code] of EXPLICIT_MARKERS) if (m === k) return code;
  const upper = m.toUpperCase();
  if (upper === "DH" || upper === "DHS" || upper === "MAD" || /^(?:dirhams?|درهم|دراهم|درهما)$/i.test(m)) {
    if (upper === "MAD") return "MAD";
    return ctx.emirati ? "AED" : "MAD";
  }
  if (/^[A-Z]{3}$/.test(m) && ISO_4217.has(m)) return m;
  if (m === "$") return ctx.dollarCode ?? (ctx.usDollar ? "USD" : null);
  if (m === "¥" || m === "￥") {
    if (ctx.japanese && !ctx.chinese) return "JPY";
    if (ctx.chinese) return "CNY";
    return null;
  }
  if (m === "元" || m === "块" || m === "圆") return ctx.japanese && !ctx.chinese ? null : "CNY";
  for (const [re, code] of WORD_MARKERS) {
    if (!re.test(m)) continue;
    if (code === "DIRHAM") return ctx.emirati ? "AED" : "MAD";
    if (code === "DOLLAR") return ctx.dollarCode ?? (ctx.usDollar ? "USD" : null);
    if (code === "YEN") return ctx.japanese && !ctx.chinese ? null : "CNY";
    return code;
  }
  return null;
}

/** Normalise a currency the AI (or anything else) produced: an ISO code, a symbol or a word. */
export function normalizeCurrency(value: unknown, ctx: CurrencyContext): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (/^[A-Za-z]{3}$/.test(v)) {
    const code = v.toUpperCase();
    if (code === "RMB") return "CNY";
    return ISO_4217.has(code) ? code : null;
  }
  return resolveMarker(v, ctx);
}

export function isWordlikeCode(code: string): boolean {
  return WORDLIKE_CODES.has(code);
}

/** Currencies with three minor digits, where "12,500" can be a decimal amount. */
export const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** The sender's country implies which dollar a bare "$" means. */
export function dollarCodeForDomain(domain: string | null): string | null {
  if (!domain) return null;
  const tld = domain.split(".").slice(-2).join(".");
  const last = domain.split(".").pop() ?? "";
  if (last === "ca") return "CAD";
  if (last === "au") return "AUD";
  if (last === "nz") return "NZD";
  if (last === "hk") return "HKD";
  if (last === "sg") return "SGD";
  if (last === "mx") return "MXN";
  if (last === "tw") return "TWD";
  if (tld === "com.ar") return "ARS";
  return null;
}
