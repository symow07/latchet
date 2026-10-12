/**
 * Merchant identity: from what a bank, a statement or an email says to who
 * was paid.
 *
 * Bank text is noisy in every country — "PRLV SEPA FREE MOBILE REF:FM100234
 * ICS FR12ZZZ456789", "CARD 4921 XXXX XXXX 1234 SPOTIFY P1A2B3C",
 * "NETFLIX.COM 866-579-7172 CA", "PAYPAL *DISNEYPLUS", "北京爱奇艺科技有限公司".
 * Grouping on the raw text split one subscription into as many as there were
 * reference numbers. Here the noise is stripped (cleanMerchant), and an alias
 * table (./aliases) maps every spelling and sender domain of a known service
 * to one key (merchantKey), so a bank charge, a statement line and an email
 * receipt for the same payment land on the same subscription.
 *
 * Pure and dependency-free; results are memoised per input string.
 */
import { ALIASES, HABIT_FRAGMENTS, HABIT_WORDS, type AliasEntry, type MerchantKind } from './aliases';
import type { BilledVia } from './types';

/** Why a charge can never be a subscription, whoever it is from. */
export type Exclusion = 'transfer' | 'cash' | 'refund' | 'fee' | 'debt' | 'tax';

export interface MerchantInfo {
  /** Canonical, alias-aware identity ('netflix'); '' when the text names nobody. */
  key: string;
  /** The text with the bank noise stripped, for people. */
  display: string;
  kind: MerchantKind | 'unknown';
  /** Charged through Apple, Google Play or PayPal. */
  billedVia: BilledVia | null;
  /** Coffee, groceries, fuel, transport, restaurants: never proposed. */
  habitual: boolean;
  excluded: Exclusion | null;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const SCRIPT_RE = /[\u0600-\u06ff\u3400-\u9fff\uf900-\ufaff]/;

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Lower-case words for matching: accents stripped, `&` dropped (AT&T → att), `+` read as "plus". */
function wordsOf(text: string): string[] {
  return deaccent(text.toLowerCase())
    .replace(/&/g, '')
    .replace(/\+/g, ' plus ')
    // Chinese and Arabic run into Latin without a space ("淘宝88VIP"): split there.
    .replace(/([\u0600-\u06ff\u3400-\u9fff\uf900-\ufaff])(?=[a-z0-9])|([a-z0-9])(?=[\u0600-\u06ff\u3400-\u9fff\uf900-\ufaff])/g, '$1$2 ')
    .replace(/[^a-z0-9\u0600-\u06ff\u3400-\u9fff\uf900-\ufaff]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function titleCase(text: string): string {
  // Only shout-case text is re-cased; a name already written in mixed case
  // ("iCloud", "McDonald's") is the merchant's own spelling.
  if (/[a-z]/.test(text) || !/[A-Z]/.test(text)) return text;
  return text
    .split(' ')
    .map((w) => (/\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

// ── The alias table, compiled ────────────────────────────────────────────────

interface Phrase {
  words: string[];
  compact: string;
  script: boolean;
  weak: boolean;
  entry: AliasEntry;
}

const PHRASES: Phrase[] = ALIASES.flatMap((entry) =>
  entry.names.map((raw) => {
    const weak = raw.startsWith('~');
    const name = weak ? raw.slice(1) : raw;
    const words = wordsOf(name);
    return { words, compact: words.join(''), script: SCRIPT_RE.test(name), weak, entry };
  })
).sort((a, b) => Number(a.weak) - Number(b.weak) || b.compact.length - a.compact.length);

const BY_KEY = new Map<string, AliasEntry>(ALIASES.map((e) => [e.key, e]));
const ALIAS_WORDS = new Set(PHRASES.flatMap((p) => p.words));
const BY_DOMAIN = new Map<string, AliasEntry>();
for (const e of ALIASES) for (const d of e.domains) BY_DOMAIN.set(d, e);

const BILLING_OF: Readonly<Record<string, BilledVia>> = { apple: 'apple', google_play: 'google_play', paypal: 'paypal' };

function hasSequence(words: string[], seq: string[]): boolean {
  outer: for (let i = 0; i + seq.length <= words.length; i++) {
    for (let j = 0; j < seq.length; j++) if (words[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

/** The known merchant these words name, longest name first, parent brands last. */
function lookupAlias(words: string[]): AliasEntry | null {
  if (words.length === 0) return null;
  const compact = words.join('');
  for (const p of PHRASES) {
    if (p.script) {
      if (compact.includes(p.compact)) return p.entry;
      continue;
    }
    if (hasSequence(words, p.words)) return p.entry;
    // "NETFLIXCOM", "YOUTUBEPREMIUM", "DISNEYPLUS": a long name glued to more text.
    if (p.compact.length >= 7 && words.some((w) => w.startsWith(p.compact))) return p.entry;
  }
  return null;
}

function lookupDomain(host: string): AliasEntry | null {
  let h = host.toLowerCase().replace(/^www\./, '');
  while (h.includes('.')) {
    const hit = BY_DOMAIN.get(h);
    if (hit) return hit;
    h = h.slice(h.indexOf('.') + 1);
  }
  return null;
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'gouv', 'ltd', 'plc']);

/** "mailer.acme.co.uk" → "acme". */
function domainBase(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  labels.pop();
  if (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1]!)) labels.pop();
  return labels[labels.length - 1] ?? '';
}

/** A bare domain or an email address, as a sender is given. */
function hostOf(raw: string): string | null {
  const s = raw.trim();
  if (/\s/.test(s)) return null;
  const email = s.match(/^[^@]+@([a-z0-9.-]+\.[a-z]{2,})$/i);
  if (email) return email[1]!;
  const url = s.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})\/?$/i);
  return url ? url[1]! : null;
}

// ── Exclusions: transfers, cash, refunds, fees, debt, tax ────────────────────

const EXCLUSIONS: readonly (readonly [Exclusion, RegExp])[] = [
  ['refund', /\b(?:REFUND|REMBOURSEMENT|REMB|AVOIR|CHARGEBACK|REVERSAL|ANNULATION)\b|退款/],
  ['cash', /\b(?:ATM|RETRAIT|WITHDRAWAL|GAB|DAB|DISTRIBUTEUR)\b|取现|取款/],
  [
    'transfer',
    /\b(?:VIR|VIRT|VRT|VIREMENT|TRANSFER|TRANSFERT|TRF|TFR|XFER|ZELLE|VENMO|CASH\s*APP|INTERAC|E-?TRANSFER|STANDING\s+ORDER|WIRE|REMITTANCE|SAVINGS|EPARGNE|LIVRET|WESTERN\s+UNION|MONEYGRAM|TOP[\s-]?UP)\b|\s(?:FT|TFR|STO|BGC|FPO|FPI)\s*$|\s{2,}SO\s*$|转账|提现|还款|充值|红包|余额宝|零钱通|理财/,
  ],
  [
    'fee',
    /\b(?:FRAIS|COMMISSIONS?|COTISATION|AGIOS|INTERETS|OVERDRAFT|TENUE\s+DE\s+COMPTE|(?:MONTHLY|ANNUAL|ACCOUNT|MAINTENANCE|SERVICE|LATE|PACKAGE|FOREIGN\s+TRANSACTION|ATM)\s+(?:SERVICE\s+)?FEES?)\b|手续费|年费/,
  ],
  [
    'debt',
    /\b(?:LOAN|MORTGAGE|PRET(?!\s+A\s+MANGER)|CREDIT\s+IMMOBILIER|CREDIT\s+CONSO|CREDIT\s+(?:CARD|CRD)\s+(?:PAYMENT|PMT|AUTOPAY|AUTO\s+PAY)|CRD\s+AUTOPAY|CARD\s+PAYMENT\s+TO|PAYMENT\s+THANK\s+YOU|LOYER|RENT|LEASING|LEASE)\b|房租|房贷|车贷/,
  ],
  ['tax', /\b(?:IMPOTS?|DGFIP|TRESOR\s+PUBLIC|HMRC|IRS|TAXES?|TAXE|URSSAF|DGI|AMENDE|COUNCIL\s+TAX)\b/],
];

/**
 * A person, not a business: Alipay and WeChat mask the names of individuals
 * they show as the counterparty ("张*三", "*丽"), and some banks do the same
 * ("J*** S***"). Money sent to a person is a transfer.
 */
const MASKED_PERSON = /^(?=.*\*)(?=.*[㐀-鿿])[㐀-鿿*]{2,6}$|^[A-Z]\*{2,}(?:\s+[A-Z]\*{2,})+$/i;

function exclusionOf(raw: string): Exclusion | null {
  if (MASKED_PERSON.test(raw.trim())) return 'transfer';
  const upper = deaccent(raw.normalize('NFKC')).toUpperCase();
  for (const [why, re] of EXCLUSIONS) if (re.test(upper)) return why;
  return null;
}

// ── Noise ────────────────────────────────────────────────────────────────────

/** Leading payment-method wording, stripped until nothing more matches. */
const PREFIXES: readonly RegExp[] = [
  /^(?:PRLV|PRELEVEMENT|PR[EÉ]L[EÈ]VEMENT)(?:\s+(?:SEPA|EUROP[EÉ]EN|EUROPE|COR1|B2B))*(?=[\s:*]|$)/i,
  /^(?:PAIEMENT|PAYMENT|ACHAT|FACTURE|FACT)\s+(?:PAR\s+|DE\s+)?(?:CARTE|CB|TPE|INTERNET|EN\s+LIGNE|MOBILE|SANS\s+CONTACT)(?:\s*[X*#]?\d{2,4})?(?=\s|$)/i,
  /^(?:CB|CARTE|CARD)(?:\s*[X*#]{1,4}\s?\d{2,4}|\s+\d{4}(?:\s*[X*]{4}){2}\s*\d{4})?(?=[\s*]|$)/i,
  /^(?:VIR(?:EMENT)?|VIRT|VRT)(?:\s+(?:SEPA|INST(?:ANTANE)?|PERMANENT|RE[CÇ]U|[EÉ]MIS|EUROP[EÉ]EN|FAVEUR|DE|VERS|A|À|POUR|CPTE|COMPTE))*(?=[\s:/]|$)/i,
  /^(?:POS(?:\s+(?:PURCHASE|DEBIT|PUR))?|DEBIT\s+CARD(?:\s+PURCHASE)?|DEBIT\s+PURCHASE|CARD\s+PURCHASE|CARD\s+PAYMENT|VISA\s+(?:DEBIT|PURCHASE)|CONTACTLESS(?:\s+PAYMENT)?|CHECKCARD(?:\s+\d{4})?|PURCHASE(?:\s+AUTHORI[SZ]ED\s+ON\s+\d{1,2}\/\d{1,2})?|RECURRING\s+(?:PAYMENT|DEBIT)(?:\s+AUTHORI[SZ]ED\s+ON\s+\d{1,2}\/\d{1,2})?)(?=\s|$)/i,
  /^(?:DIRECT\s+DEBIT|DD|DDR|ACH(?:\s+(?:DEBIT|PMT|PAYMENT|WITHDRAWAL))?|PRE-?AUTHORI[SZ]ED\s+DEBIT|ELECTRONIC\s+(?:PMT|PAYMENT|WITHDRAWAL)|BILL\s+PAY(?:MENT)?|ONLINE\s+PAYMENT|AUTOPAY|EXT\s+WITHDRAWAL)(?=\s|$)/i,
  // Card processors and marketplaces that print their own name first.
  /^(?:SQ|TST|SP|IN|FS|DD|WL|PY|ZTL|IZ|SUMUP|PADDLE(?:\.NET)?|2CO(?:\.COM)?|DNH|LS|EB|SMP|CKO|STRIPE)\s*\*\s*/i,
  /^(?:AMZN\s+MKTP(?:\s+[A-Z]{2})?|AMAZON\s+MKTPL?(?:ACE)?(?:\s+[A-Z]{2})?|AMAZON\s+MARKETPLACE)(?:\s*\*\s*|\s+|$)/i,
  /^(?:RETRAIT(?:\s+(?:DAB|GAB|ESPECES))?|WITHDRAWAL|ATM(?:\s+WITHDRAWAL)?|CASH\s+WITHDRAWAL)(?=\s|$)/i,
  /^(?:REMBOURSEMENT|REMB|AVOIR|REFUND)(?=\s|$)/i,
  /^(?:DU|LE)\s+\d{6}(?=\s|$)/i,
  /^(?:DU|LE)\s+\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?(?=\s|$)/i,
  /^\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?(?=\s|$)/,
  /^\d{6,}(?=\s|$)/,
  /^(?:支付宝|财付通|微信支付|扫二维码付款|二维码收款|收钱码收款)\s*[-—–]?\s*/,
];

/** Billing intermediaries, wherever they appear. */
const INTERMEDIARIES: readonly (readonly [BilledVia, RegExp, RegExp])[] = [
  [
    'apple',
    /\bAPPLE\.COM\/(?:BILL|[A-Z]{2})\b|\bITUNES\.COM\b|^APL\s*\*|\bAPPLE\s+SERVICES\b/i,
    /\bAPPLE\.COM\/(?:BILL|[A-Z]{2})\b|\bITUNES\.COM(?:\/BILL)?\b|^APL\s*\*\s*(?:ITUNES\.COM|APPLE\b)?|\bAPPLE\s+SERVICES\b/gi,
  ],
  [
    'google_play',
    /^GOOGLE\s*\*|\bGOOGLE\s+PLAY\b|\bGOOGLE\s+PAYMENT\b|\bG\.CO\/HELPPAY/i,
    /^GOOGLE\s*\*\s*|\bGOOGLE\s+PLAY(?:\s+STORE)?\b|\bGOOGLE\s+PAYMENT\b|\bG\.CO\/HELPPAY#?/gi,
  ],
  [
    'paypal',
    /\bPAYPAL\b|^PP\s*\*|\bPP\.\d+\.PP\b/i,
    /\bPAYPAL\s*(?:\(EUROPE\)\s*)?(?:EUROPE\s+S\.?\s?A\.?\s?R\.?\s?L\.?\s+ET\s+CIE\.?,?\s*S\.?\s?C\.?\s?A\.?|\*\s*)?|^PP\s*\*\s*|\bPP\.\d+\.PP\b\.?|\b(?:IHR\s+EINKAUF\s+BEI|VOTRE\s+ACHAT\s+(?:CHEZ|AUPR[EÈ]S\s+DE)|YOUR\s+PURCHASE\s+(?:AT|WITH|FROM))\b/gi,
  ],
];

const MONTH_WORDS =
  'JAN|JANV|JANUARY|JANVIER|FEB|FEV|FEVR|FEBRUARY|FEVRIER|MAR|MARS|MARCH|APR|AVR|APRIL|AVRIL|MAY|MAI|JUN|JUIN|JUNE|JUL|JUIL|JULY|JUILLET|AUG|AOU|AOUT|AUGUST|SEP|SEPT|SEPTEMBER|SEPTEMBRE|OCT|OCTOBER|OCTOBRE|NOV|NOVEMBER|NOVEMBRE|DEC|DECEMBER|DECEMBRE';

/** Noise anywhere in the text: card numbers, references, dates, phones, store numbers. */
const NOISE: readonly RegExp[] = [
  /\bCARD\s+\d{4}(?:\s*[X*]{4}){2}\s*\d{4}\b/gi,
  /\b\d{4}(?:[\s-]?[X*]{4}){2}[\s-]?\d{4}\b/gi,
  /(?:^|\s)[X*]{2,}\s?\d{2,4}\b/gi,
  /\bX\d{4}\b/gi,
  /\b(?:CARTE|CB|CARD)\s*(?:ENDING\s+(?:IN\s+)?)?[X*#]?\d{4}\b/gi,
  /\*\d{4,}\b/g,
  // References, mandates and creditor ids (SEPA), invoices, authorisations.
  /\b(?:REF(?:ERENCE)?|R[EÉ]F[EÉ]RENCE|ICS|RUM|MANDAT(?:E)?|MDT|NNT|TRN|TXN|CONF(?:IRMATION)?|AUTH(?:ORI[SZ]ATION)?|APPROVAL|SEQ|INV(?:OICE)?|LIB|ECH|[EÉ]CH[EÉ]ANCE)\s*[:#./]\s*[A-Z0-9][A-Z0-9\-/.]*/gi,
  /\b(?:REF|ICS|RUM|MANDAT|MDT)\s+[A-Z0-9-]*\d[A-Z0-9-]*/gi,
  /\bID\s+(?:EMETTEUR|[EÉ]METTEUR|CREANCIER|CR[EÉ]ANCIER)\s*[:/]?\s*\S+/gi,
  /\b(?:PPD|CCD|WEB|TEL|ARC|BOC|POP|RCK)?\s*ID\s*[:#]\s*\S+/gi,
  /\bMOTIF\s*[:/]?/gi,
  /\bFACT(?:URE)?\.?\s*(?:N[°O]\.?\s*)?\d[\w\-/]*/gi,
  /\bN[°º]\.?\s*\d[\w-]*/gi,
  /\bNO\.\s*\d[\w-]*/gi,
  /\bNUM(?:ERO)?\s*[:.]?\s*\d[\w-]*/gi,
  // Dates and times.
  /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g,
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g,
  new RegExp(`\\b(?:ON\\s+|LE\\s+|DU\\s+)?\\d{1,2}\\s?(?:${MONTH_WORDS})\\.?(?:\\s+\\d{2,4})?(?![A-Z])`, 'gi'),
  /\bDU\s+\d{6}\b/gi,
  /\b\d{1,2}[:hH]\d{2}(?::\d{2})?\b/g,
  // Web addresses with a path ("g.co/helppay#", "amzn.com/bill"), and help desks ("HELP.UBER.COM").
  /\b(?:help|support|billing|pay|contact)\.[\w.-]+\.[a-z]{2,6}\b/gi,
  /\b(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,6}\/\S*/gi,
  /\bWWW\./gi,
  // Store, terminal and branch numbers.
  /#\s*\d+/g,
  /\b(?:STORE|STR|SHOP|BRANCH|LOC|LOCATION|TERMINAL|TERM|UNIT|STE|SUITE|MAGASIN|AGENCE)\s*#?\s*\d+\b/gi,
];

/** Phone numbers: any run of seven or more digits with separators. */
const PHONE = /\+?\(?\d[\d().\s-]{6,}\d/g;

const TLD = /\.(?:com|co\.uk|org\.uk|co|net|org|io|ai|app|tv|me|so|sh|fr|ma|cn|de|nl|ie|es|it|uk|eu|ca|us|be|ch|lu|se)\b/gi;
const DOMAIN_TOKEN = /\b((?:[a-z0-9-]+\.)+(?:com|co\.uk|net|org|io|ai|app|tv|me|so|sh|fr|ma|cn|de|nl|ie|es|it|eu|ca|us|be|ch|lu|se))\b/gi;

/** Bank transaction codes (Barclays BCC, DDR, ...) that trail the merchant. */
const BANK_CODES = new Set(['bcc', 'bgc', 'cpm', 'ddr', 'dd', 'deb', 'ft', 'fpo', 'fpi', 'tfr', 'sto', 'so', 'chq', 'cr', 'dr', 'vis', 'pos', 'chg', 'atm', 'oth', 'dpc', 'cb', 'tpe']);
const CORPORATE = new Set([
  'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'corp', 'corporation', 'co', 'company', 'sa', 'sas',
  'sasu', 'sarl', 'eurl', 'snc', 'sca', 'cie', 'et', 'gmbh', 'ag', 'ab', 'bv', 'nv', 'pty', 'srl', 'spa', 'oy', 'kk',
  'international', 'intl', 'holdings', 'group', 'europe', 'eu', 'emea',
]);
const PLACES = new Set([
  // Countries
  'us', 'usa', 'ca', 'can', 'gb', 'gbr', 'uk', 'fr', 'fra', 'france', 'ma', 'mar', 'maroc', 'morocco', 'cn', 'chn',
  'china', 'nl', 'nld', 'ie', 'irl', 'lu', 'lux', 'se', 'swe', 'de', 'deu', 'es', 'esp', 'it', 'ita', 'be', 'bel',
  'ch', 'che', 'au', 'aus', 'ae', 'are', 'uae',
  // US states and Canadian provinces
  'al', 'ak', 'az', 'ar', 'co', 'ct', 'fl', 'ga', 'hi', 'id', 'il', 'ia', 'ks', 'ky', 'la', 'md', 'mi', 'mn', 'ms',
  'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx',
  'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc', 'on', 'qc', 'bc', 'mb', 'sk', 'ns', 'nb', 'pe',
  // Cities
  'casablanca', 'casa', 'rabat', 'marrakech', 'marrakesh', 'tanger', 'tangier', 'fes', 'fez', 'agadir', 'meknes',
  'oujda', 'kenitra', 'tetouan', 'paris', 'lyon', 'marseille', 'lille', 'toulouse', 'bordeaux', 'nantes', 'nice',
  'strasbourg', 'montpellier', 'rennes', 'london', 'londres', 'manchester', 'birmingham', 'leeds', 'glasgow',
  'edinburgh', 'bristol', 'liverpool', 'dublin', 'amsterdam', 'luxembourg', 'stockholm', 'berlin', 'madrid',
  'barcelona', 'nyc', 'seattle', 'chicago', 'boston', 'austin', 'miami', 'toronto', 'montreal', 'vancouver',
  'calgary', 'ottawa', 'beijing', 'shanghai', 'shenzhen', 'hangzhou', 'guangzhou', 'dubai', 'sunnyvale', 'cupertino',
  'burbank', 'oakland', 'internet', 'online',
]);
const PLACE_PAIRS = new Set(['new york', 'los angeles', 'los gatos', 'san francisco', 'san jose', 'mountain view', 'menlo park', 'palo alto', 'san mateo', 'hong kong']);
/** Payment wording that says nothing about who was paid: dropped everywhere. */
const GENERIC = new Set([
  'payment', 'payments', 'paiement', 'pmt', 'purchase', 'achat', 'recurring', 'recur', 'autopay', 'online', 'bill',
  'billing', 'facture', 'charge', 'www', 'https', 'http', 'sepa', 'prlv',
]);
/**
 * Words that describe the plan rather than name the merchant: kept in the
 * name people read ("Domain Renewal"), left out of the key, so "ACME
 * MONTHLY" and "ACME SUBSCRIPTION" are one merchant.
 */
const DESCRIPTIVE = new Set([
  'subscription', 'subscr', 'subs', 'abonnement', 'abo', 'membership', 'monthly', 'mensuel', 'mensuelle',
  'mensualite', 'annual', 'annuel', 'yearly', 'renewal', 'renouvellement', 'service', 'services', 'digital',
]);
const GENERIC_SCRIPT = /连续包月|自动续费|连续包年|包月|会员|订单|月卡|年卡|充值|支付|vip/gi;

function isTrailingNoise(word: string): boolean {
  const l = deaccent(word.toLowerCase());
  return BANK_CODES.has(l) || CORPORATE.has(l) || PLACES.has(l) || /^\d+$/.test(l);
}

/** Drops trailing bank codes, places, company forms and numbers, keeping at least one word. */
function trimTrailing(input: string[]): string[] {
  let words = input;
  for (let guard = 0; guard < 12 && words.length > 1; guard++) {
    const last2 = deaccent(words.slice(-2).join(' ').toLowerCase());
    if (words.length > 2 && PLACE_PAIRS.has(last2)) words = words.slice(0, -2);
    else if (isTrailingNoise(words[words.length - 1]!)) words = words.slice(0, -1);
    else break;
  }
  // A lone state code or company form is not a merchant ("APPLE.COM/BILL … CA").
  return words.length === 1 && isTrailingNoise(words[0]!) ? [] : words;
}

function stripPrefixes(text: string): string {
  let s = text.trim();
  for (let guard = 0; guard < 12; guard++) {
    const before = s;
    for (const re of PREFIXES) s = s.replace(re, ' ').replace(/^[\s*:\-/.,]+/, '');
    if (s === before) break;
  }
  return s;
}

interface Stages {
  /** After payment wording and noise: what alias matching reads. */
  matchable: string;
  /** Domains named in the text, before their dots are lost. */
  domains: string[];
  /** Fully cleaned, for people. */
  display: string;
  billedVia: BilledVia | null;
}

function stages(raw: string): Stages {
  let s = (raw ?? '').normalize('NFKC');
  s = s.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u00a0\u202f\u3000]/g, ' ');
  // Underscores are how keys and older ids spell spaces.
  s = s.replace(/_/g, ' ');

  // Chinese company boilerplate: 北京爱奇艺科技有限公司 → 爱奇艺.
  s = s
    .replace(/^(?:北京|上海|深圳|广州|杭州|南京|成都|武汉|天津|重庆)(?:市)?/, '')
    .replace(/[(（]中国[)）]/g, '')
    .replace(/(?:网络|信息|计算机|电子商务|文化|传媒|软件|科技|技术|系统)*(?:股份)?有限(?:责任)?公司/g, ' ');

  // A SEPA debit that names its creditor ("DE: FREE MOBILE ID: ... MOTIF: ...").
  const creditor = s.match(/\bDE\s*:\s*(.+?)(?=\s+(?:ID|MOTIF|REF|MANDAT|RUM|NUM|IBAN|BIC)\b|$)/i);
  if (creditor) s = creditor[1]!;

  let billedVia: BilledVia | null = null;
  s = stripPrefixes(s);
  for (const [via, detect, strip] of INTERMEDIARIES) {
    if (!detect.test(s)) continue;
    billedVia ??= via;
    s = s.replace(strip, ' ');
  }
  s = stripPrefixes(s);

  for (const re of NOISE) s = s.replace(re, ' ');
  s = s.replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? ' ' : m));
  s = s.replace(/\b\d{4,}\b/g, ' ');

  const domains = [...s.matchAll(DOMAIN_TOKEN)].map((m) => m[1]!.toLowerCase());
  s = s.replace(TLD, '');
  // Dotted acronyms: S.A.R.L. → SARL, B.V. → BV.
  s = s.replace(/\b(?:[A-Za-z]\.){2,}[A-Za-z]?\.?/g, (m) => m.replace(/\./g, ''));
  s = s.replace(/[*_|\\/:;,"#@=<>{}[\]()!?~^`.·•]+/g, ' ');

  let tokens = s.split(/\s+/).map((t) => t.replace(/^[-'&+]+|[-'&]+$/g, '')).filter(Boolean);
  // Reference-like codes: five or more letters and digits with at least two digits ("P1A2B3C",
  // "FM100234") — unless the word is a name the alias table knows ("88VIP").
  tokens = tokens.filter(
    (t) => ALIAS_WORDS.has(t.toLowerCase()) || !(/^[a-z0-9]{5,}$/i.test(t) && /\d.*\d/.test(t) && /[a-z]/i.test(t))
  );
  const matchable = tokens.join(' ');

  // For people: drop generic words, then trailing codes, places, company forms and numbers.
  let words = tokens.filter((t) => !GENERIC.has(deaccent(t.toLowerCase())));
  words = words.map((t) => (SCRIPT_RE.test(t) ? t.replace(GENERIC_SCRIPT, '') : t)).filter(Boolean);
  // "SPOTIFY AB SPOTIFY AB" (PayPal repeats the payee): say it once.
  const half = words.length / 2;
  if (words.length >= 2 && Number.isInteger(half) && words.slice(0, half).join(' ').toLowerCase() === words.slice(half).join(' ').toLowerCase()) {
    words = words.slice(0, half);
  }
  words = trimTrailing(words);
  const display = titleCase(words.slice(0, 5).join(' ').replace(/^[-'&+\s]+|[-'&\s]+$/g, ''));
  return { matchable, domains, display, billedVia };
}

// ── Public API ───────────────────────────────────────────────────────────────

const MEMO = new Map<string, MerchantInfo>();
const MEMO_LIMIT = 20_000;

/** At most three naming words, re-trimmed so that applying merchantKey to a key gives it back. */
function keyFromWords(words: string[]): string {
  const naming = trimTrailing(words.filter((w) => !DESCRIPTIVE.has(w)));
  return trimTrailing(naming.slice(0, 3)).join('_');
}

function habitualWords(words: string[]): boolean {
  if (words.some((w) => HABIT_WORDS.has(w))) return true;
  const compact = words.join('');
  return HABIT_FRAGMENTS.some((f) => compact.includes(f));
}

function compute(raw: string): MerchantInfo {
  const text = (raw ?? '').trim();
  const excluded = text ? exclusionOf(text) : null;
  if (!text) return { key: '', display: '', kind: 'unknown', billedVia: null, habitual: false, excluded };

  // A sender domain or address: "account.netflix.com", "no-reply@spotify.com".
  const host = hostOf(text);
  if (host) {
    const entry = lookupDomain(host);
    if (entry) {
      return { key: entry.key, display: entry.name, kind: entry.kind, billedVia: BILLING_OF[entry.key] ?? null, habitual: entry.kind === 'habit', excluded: null };
    }
    const base = domainBase(host);
    const words = wordsOf(base.replace(/-/g, ' '));
    const named = lookupAlias(words);
    if (named) return { key: named.key, display: named.name, kind: named.kind, billedVia: BILLING_OF[named.key] ?? null, habitual: named.kind === 'habit', excluded: null };
    return { key: keyFromWords(words), display: titleCase(base.toUpperCase()), kind: 'unknown', billedVia: null, habitual: false, excluded: null };
  }

  const st = stages(text);
  const words = wordsOf(st.matchable);

  let entry: AliasEntry | null = null;
  for (const d of st.domains) {
    const hit = lookupDomain(d);
    if (hit && hit.kind !== 'billing') {
      entry = hit;
      break;
    }
  }
  entry ??= lookupAlias(words);

  if (entry) {
    const billedVia = BILLING_OF[entry.key] ?? st.billedVia;
    return { key: entry.key, display: st.display || entry.name, kind: entry.kind, billedVia, habitual: entry.kind === 'habit', excluded };
  }

  const displayWords = wordsOf(st.display);
  const key = keyFromWords(displayWords);
  if (!key) {
    // Nothing but the intermediary: "APPLE.COM/BILL 866-712-7753 CA".
    if (st.billedVia) {
      const via = ALIASES.find((e) => BILLING_OF[e.key] === st.billedVia)!;
      return { key: via.key, display: via.name, kind: 'billing', billedVia: st.billedVia, habitual: false, excluded };
    }
    return { key: '', display: '', kind: 'unknown', billedVia: null, habitual: false, excluded };
  }
  return {
    key,
    display: st.display,
    kind: 'unknown',
    billedVia: st.billedVia,
    habitual: habitualWords(words),
    excluded,
  };
}

/** Everything known about a merchant string; memoised. */
export function merchantInfo(raw: string): MerchantInfo {
  const k = raw ?? '';
  const hit = MEMO.get(k);
  if (hit) return hit;
  const info = compute(k);
  if (MEMO.size >= MEMO_LIMIT) MEMO.clear();
  MEMO.set(k, info);
  return info;
}

/** The text with bank noise stripped, readable: "PRLV SEPA FREE MOBILE REF:…" → "Free Mobile". */
export function cleanMerchant(raw: string): string {
  return merchantInfo(raw).display;
}

/**
 * The canonical, alias-aware identity of a merchant, from bank text, a
 * merchant name or a sender domain: "NETFLIX.COM 866-579-7172 CA", "Netflix",
 * "netflix.com", "account.netflix.com" and "PAYPAL *NETFLIX" are all
 * 'netflix'. '' when the text names nobody. Applying it to a key gives the
 * key back.
 */
export function merchantKey(rawOrDomain: string): string {
  return merchantInfo(rawOrDomain).key;
}

/** The known merchant behind a key, if it is one. */
export function aliasFor(key: string): AliasEntry | null {
  return BY_KEY.get(key) ?? null;
}

/** The proper name for a key ("disney_plus" → "Disney+"); unknown keys use the cleaned text. */
export function displayNameFor(key: string, fallbackRaw?: string): string {
  const entry = BY_KEY.get(key);
  if (entry) return entry.name;
  const cleaned = fallbackRaw ? cleanMerchant(fallbackRaw) : '';
  if (cleaned) return cleaned;
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The older normaliser's output (upper-case, at most three words), kept only
 * so rows it named can be matched to their merchant's new key.
 */
const LEGACY_NOISE = new Set([
  'pos', 'payment', 'online', 'purchase', 'debit', 'credit', 'card', 'transaction', 'transfer', 'charge', 'fee',
  'refund', 'sale', 'checkcard', 'recurring', 'autopay', 'auto', 'pay', 'bill', 'billing', 'www', 'com', 'net', 'org',
  'inc', 'llc', 'ltd',
]);

export function legacyNormalize(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[*/\-_.,#@!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 1 && !LEGACY_NOISE.has(token.toLowerCase()))
    .slice(0, 3)
    .join(' ');
}
