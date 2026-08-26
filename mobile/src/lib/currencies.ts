// Currency data with symbols and, where one exists, a bundled fallback rate.
//
// The full list is every currency the rates provider quotes (166 of them),
// generated from ICU: names via Intl.DisplayNames, symbols via
// Intl.NumberFormat narrowSymbol, and the minor-unit count via
// resolvedOptions().maximumFractionDigits. That last one is why `decimals`
// exists — the old hardcoded no-decimal list had no notion of the 3-decimal
// currencies (BHD, KWD, OMR, JOD, TND), so those rendered a hundredth of a
// dinar as if it were a cent.
//
// `rate` is a BUNDLED SNAPSHOT and now OPTIONAL. It only exists for the 73
// currencies that shipped before the list was widened, it dates from early
// 2024, and several are badly wrong (TRY and ARS especially). It is the
// offline fallback and nothing else: the live table from /api/rates covers
// every code here and is what anything doing arithmetic gets. A currency with
// no bundled rate simply has no offline fallback — convertCurrency returns the
// amount unchanged rather than inventing a number.
//
// BTC and ETH are the exception and are deliberately kept: the provider quotes
// no crypto, so their 2024 rates can never refresh. They stay so that anyone
// who already picked one does not silently lose their selection.
//
// See lib/rates.ts for fetching, caching and staleness.
export const BUNDLED_RATES_AS_OF = '2024-02-01';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  /** Minor units. Absent means 2. */
  decimals?: number;
  /** Offline fallback only, and absent for most. Prefer the live table. */
  rate?: number;
}

export const CURRENCIES: Currency[] = [
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', rate: 3.67 },
  { code: 'AFN', name: 'Afghan Afghani', symbol: '؋' },
  { code: 'ALL', name: 'Albanian Lek', symbol: 'ALL' },
  { code: 'AMD', name: 'Armenian Dram', symbol: '֏' },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', symbol: 'ANG' },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', rate: 875 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', rate: 1.53 },
  { code: 'AWG', name: 'Aruban Florin', symbol: 'AWG' },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM' },
  { code: 'BBD', name: 'Barbadian Dollar', symbol: '$' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', rate: 110 },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', rate: 1.80 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', decimals: 3, rate: 0.38 },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'BIF', decimals: 0 },
  { code: 'BMD', name: 'Bermudan Dollar', symbol: '$' },
  { code: 'BND', name: 'Brunei Dollar', symbol: '$' },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.', rate: 6.91 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', rate: 4.97 },
  { code: 'BSD', name: 'Bahamian Dollar', symbol: '$' },
  { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'BTN' },
  { code: 'BWP', name: 'Botswanan Pula', symbol: 'P' },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: 'BYN' },
  { code: 'BZD', name: 'Belize Dollar', symbol: '$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', rate: 1.36 },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'CDF' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', rate: 0.88 },
  { code: 'CLF', name: 'Chilean Unit of Account (UF)', symbol: 'CLF', decimals: 4 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', decimals: 0, rate: 925 },
  { code: 'CNH', name: 'Chinese Yuan (offshore)', symbol: 'CNH' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', rate: 7.24 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', rate: 3950 },
  { code: 'CRC', name: 'Costa Rican Colon', symbol: '₡', rate: 530 },
  { code: 'CUP', name: 'Cuban Peso', symbol: '$' },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: 'CVE' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', rate: 22.80 },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'DJF', decimals: 0 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', rate: 6.88 },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', rate: 57 },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DZD' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', rate: 30.90 },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'ERN' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', rate: 56.50 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate: 0.92 },
  { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$', rate: 2.25 },
  { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£' },
  { code: 'FOK', name: 'FOK', symbol: 'FOK' },
  { code: 'GBP', name: 'British Pound', symbol: '£', rate: 0.79 },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾' },
  { code: 'GGP', name: 'GGP', symbol: 'GGP' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', rate: 12.50 },
  { code: 'GIP', name: 'Gibraltar Pound', symbol: '£' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'GMD' },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG', decimals: 0 },
  { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', rate: 7.82 },
  { code: 'GYD', name: 'Guyanese Dollar', symbol: '$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', rate: 7.82 },
  { code: 'HNL', name: 'Honduran Lempira', symbol: 'L', rate: 24.70 },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn', rate: 6.95 },
  { code: 'HTG', name: 'Haitian Gourde', symbol: 'HTG' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', rate: 355 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', rate: 15650 },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪', rate: 3.67 },
  { code: 'IMP', name: 'IMP', symbol: 'IMP' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', rate: 83.12 },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD', decimals: 3 },
  { code: 'IRR', name: 'Iranian Rial', symbol: 'IRR' },
  { code: 'ISK', name: 'Icelandic Krona', symbol: 'kr', decimals: 0, rate: 138 },
  { code: 'JEP', name: 'JEP', symbol: 'JEP' },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', rate: 156 },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', decimals: 3, rate: 0.71 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, rate: 149.50 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', rate: 153 },
  { code: 'KGS', name: 'Kyrgyz Som', symbol: '⃀' },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
  { code: 'KID', name: 'KID', symbol: 'KID' },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF', decimals: 0 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0, rate: 1320 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', decimals: 3, rate: 0.31 },
  { code: 'KYD', name: 'Cayman Islands Dollar', symbol: '$' },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸' },
  { code: 'LAK', name: 'Laotian Kip', symbol: '₭' },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'L£' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', rate: 325 },
  { code: 'LRD', name: 'Liberian Dollar', symbol: '$' },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'LSL' },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'LYD', decimals: 3 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', rate: 10.05 },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'MDL' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
  { code: 'MKD', name: 'Macedonian Denar', symbol: 'MKD' },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
  { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮' },
  { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP' },
  { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'MRU' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: 'Rs' },
  { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'MVR' },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MWK' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', rate: 17.15 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', rate: 4.72 },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MZN' },
  { code: 'NAD', name: 'Namibian Dollar', symbol: '$' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', rate: 1550 },
  { code: 'NIO', name: 'Nicaraguan Cordoba', symbol: 'C$', rate: 36.70 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', rate: 10.65 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रू', rate: 133 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', rate: 1.64 },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', decimals: 3, rate: 0.38 },
  { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.', rate: 1 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', rate: 3.72 },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', rate: 3.75 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', rate: 56.20 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', rate: 279 },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', rate: 3.98 },
  { code: 'PYG', name: 'Paraguayan Guarani', symbol: '₲', decimals: 0, rate: 7350 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', rate: 3.64 },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', rate: 4.58 },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'RSD' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', rate: 92.50 },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'RF', decimals: 0 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', rate: 3.75 },
  { code: 'SBD', name: 'Solomon Islands Dollar', symbol: '$' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SCR' },
  { code: 'SDG', name: 'Sudanese Pound', symbol: 'SDG' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', rate: 10.42 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', rate: 1.34 },
  { code: 'SHP', name: 'St. Helena Pound', symbol: '£' },
  { code: 'SLE', name: 'Sierra Leonean Leone', symbol: 'SLE' },
  { code: 'SLL', name: 'Sierra Leonean Leone (1964—2022)', symbol: 'SLL' },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'SOS' },
  { code: 'SRD', name: 'Surinamese Dollar', symbol: '$' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: '£' },
  { code: 'STN', name: 'São Tomé & Príncipe Dobra', symbol: 'Db' },
  { code: 'SYP', name: 'Syrian Pound', symbol: '£' },
  { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'SZL' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', rate: 35.50 },
  { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'TJS' },
  { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'TMT' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'TND', decimals: 3 },
  { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', rate: 32.15 },
  { code: 'TTD', name: 'Trinidad Dollar', symbol: 'TT$', rate: 6.78 },
  { code: 'TVD', name: 'TVD', symbol: 'TVD' },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', rate: 31.50 },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', rate: 2510 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', rate: 37.50 },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimals: 0, rate: 3780 },
  { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', rate: 39.50 },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: 'UZS' },
  { code: 'VES', name: 'Venezuelan Bolivar', symbol: 'Bs', rate: 36.50 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0, rate: 24500 },
  { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VUV', decimals: 0 },
  { code: 'WST', name: 'Samoan Tala', symbol: 'WST' },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', decimals: 0 },
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: '$' },
  { code: 'XCG', name: 'Caribbean guilder', symbol: 'Cg.' },
  { code: 'XDR', name: 'Special Drawing Rights', symbol: 'XDR' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'F CFA', decimals: 0 },
  { code: 'XPF', name: 'CFP Franc', symbol: 'CFPF', decimals: 0 },
  { code: 'YER', name: 'Yemeni Rial', symbol: 'YER' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', rate: 18.65 },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
  { code: 'ZWG', name: 'Zimbabwean Gold', symbol: 'ZWG' },
  { code: 'ZWL', name: 'Zimbabwean Dollar (2009–2024)', symbol: 'ZWL' },
  // Crypto: no live quotes from the provider, so these keep 2024 rates forever.
  { code: 'BTC', name: 'Bitcoin', symbol: '\u20bf', rate: 0.000024 },
  { code: 'ETH', name: 'Ethereum', symbol: '\u039e', rate: 0.00041 },
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

  // Minor units come from the entry, which is generated from ICU. The list
  // this replaces only knew about zero-decimal currencies, so it rendered
  // 0.001 BHD as "0.00" — and it was missing HUF's and ISK's real behaviour
  // besides, both of which ICU reports as 2.
  const decimals = currency.decimals ?? 2;

  return `${currency.symbol}${amount.toFixed(decimals)}`;
}

export function getPopularCurrencies(): Currency[] {
  const popularCodes = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD', 'AED', 'SAR'];
  return popularCodes.map(code => getCurrencyByCode(code)!).filter(Boolean);
}
