// Currency data with symbols and exchange rates.
//
// The `rate` values below are a BUNDLED SNAPSHOT, not live data — they are the
// offline fallback used before the first successful fetch of /api/rates and
// whenever the device is offline. They date from early 2024 and several are
// badly wrong by now (TRY and ARS especially), which is exactly why anything
// doing arithmetic must prefer the live table when one is available.
//
// See lib/rates.ts for fetching, caching and staleness.
export const BUNDLED_RATES_AS_OF = '2024-02-01';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  rate: number; // Rate relative to USD
}

export const CURRENCIES: Currency[] = [
  // Major currencies
  { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate: 0.92 },
  { code: 'GBP', name: 'British Pound', symbol: '£', rate: 0.79 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', rate: 149.50 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', rate: 7.24 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', rate: 83.12 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', rate: 1.36 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', rate: 1.53 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', rate: 0.88 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', rate: 7.82 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', rate: 1.34 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', rate: 10.42 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', rate: 1320 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', rate: 10.65 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', rate: 1.64 },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', rate: 17.15 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', rate: 4.97 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', rate: 18.65 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', rate: 92.50 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', rate: 32.15 },

  // Middle East
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', rate: 3.67 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', rate: 3.75 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', rate: 3.64 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', rate: 0.31 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', rate: 0.38 },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', rate: 0.38 },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', rate: 0.71 },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪', rate: 3.67 },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', rate: 30.90 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', rate: 10.05 },

  // Asia
  { code: 'THB', name: 'Thai Baht', symbol: '฿', rate: 35.50 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', rate: 4.72 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', rate: 15650 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', rate: 56.20 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', rate: 24500 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', rate: 279 },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', rate: 110 },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', rate: 325 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रू', rate: 133 },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', rate: 31.50 },

  // Africa
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', rate: 1550 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', rate: 153 },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', rate: 12.50 },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', rate: 2510 },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', rate: 3780 },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', rate: 56.50 },

  // Europe
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', rate: 3.98 },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', rate: 22.80 },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', rate: 355 },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', rate: 4.58 },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', rate: 1.80 },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn', rate: 6.95 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', rate: 6.88 },
  { code: 'ISK', name: 'Icelandic Krona', symbol: 'kr', rate: 138 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', rate: 37.50 },

  // Americas
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', rate: 875 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', rate: 925 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', rate: 3950 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', rate: 3.72 },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', rate: 39.50 },
  { code: 'VES', name: 'Venezuelan Bolivar', symbol: 'Bs', rate: 36.50 },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.', rate: 6.91 },
  { code: 'PYG', name: 'Paraguayan Guarani', symbol: '₲', rate: 7350 },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', rate: 57 },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', rate: 7.82 },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L', rate: 24.70 },
  { code: 'NIO', name: 'Nicaraguan Cordoba', symbol: 'C$', rate: 36.70 },
  { code: 'CRC', name: 'Costa Rican Colon', symbol: '₡', rate: 530 },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.', rate: 1 },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', rate: 156 },
  { code: 'TTD', name: 'Trinidad Dollar', symbol: 'TT$', rate: 6.78 },

  // Oceania
  { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$', rate: 2.25 },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', rate: 3.75 },

  // Crypto (as reference)
  { code: 'BTC', name: 'Bitcoin', symbol: '₿', rate: 0.000024 },
  { code: 'ETH', name: 'Ethereum', symbol: 'Ξ', rate: 0.00041 },
];

export function getCurrencyByCode(code: string): Currency | undefined {
  return CURRENCIES.find(c => c.code === code);
}

/**
 * Live USD-based rates, installed by lib/rates.ts once fetched. Held here (the
 * same pattern as setActiveCurrency in calculations.ts) so convertCurrency can
 * stay synchronous and currencies.ts need not import the network layer.
 */
let activeRates: Record<string, number> | null = null;
let activeRatesAsOf: string = BUNDLED_RATES_AS_OF;

export function setActiveRates(rates: Record<string, number>, asOf: string): void {
  activeRates = rates;
  activeRatesAsOf = asOf;
}

/** Date the rates in use were published. Show this beside any converted figure. */
export function getRatesAsOf(): string {
  return activeRatesAsOf;
}

/** True while still relying on the stale table compiled into the app. */
export function isUsingBundledRates(): boolean {
  return activeRates === null;
}

function rateFor(code: string): number | undefined {
  const live = activeRates?.[code.toUpperCase()];
  if (typeof live === 'number' && live > 0) return live;
  return getCurrencyByCode(code)?.rate;
}

export function convertCurrency(amount: number, fromCode: string, toCode: string): number {
  const fromRate = rateFor(fromCode);
  const toRate = rateFor(toCode);

  if (!fromRate || !toRate) return amount;

  // Convert to USD first, then to target currency
  const amountInUSD = amount / fromRate;
  return amountInUSD * toRate;
}

export function formatCurrencyAmount(amount: number, currencyCode: string): string {
  const currency = getCurrencyByCode(currencyCode);
  if (!currency) return `$${amount.toFixed(2)}`;

  // Handle currencies with no decimal places
  const noDecimalCurrencies = ['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'PYG', 'UGX', 'HUF', 'ISK'];
  const decimals = noDecimalCurrencies.includes(currencyCode) ? 0 : 2;

  return `${currency.symbol}${amount.toFixed(decimals)}`;
}

export function getPopularCurrencies(): Currency[] {
  const popularCodes = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD', 'AED', 'SAR'];
  return popularCodes.map(code => getCurrencyByCode(code)!).filter(Boolean);
}
