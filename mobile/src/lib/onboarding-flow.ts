/**
 * Onboarding as a model: what each step asks, what it records, where a
 * reopened app resumes, what Connect your data offers, and what the payoff
 * says. The screens (app/onboarding.tsx, components/ConnectSources.tsx) only
 * draw it and run its effects.
 *
 *   currency  defaulted from the phone's region (its currency, else the
 *             locale's); choosing it sets the settings and the default Cash
 *             account together (db.ts setPersonalCurrency).
 *   income    optional. With an income, a first monthly budget can be picked
 *             from it (what the old spending-style step really did).
 *   connect   Gmail and Outlook where the server has them configured, a
 *             statement import, and a bank link only where Plaid serves the
 *             region. Each is optional; what is passed over is remembered for
 *             Home's getting-started checklist (getting-started.ts).
 *   detect    waits for an inbox's first read if one is running, then runs
 *             subscription detection once.
 *   payoff    what was found, in the user's currency and language.
 *
 * The old primary-goal step is gone: the app never led with the answer, it
 * only reached the advisor's prompt. The savings goal moved to its own editor
 * (app/goal.tsx), reached from Home and Settings.
 *
 * Also here, because they are the same few rules as onboarding's: the
 * amount fields of the income and goal editors, and joining a company by
 * invite code. Dependency-free (currencies.ts and the engine's cadence table
 * are data), so onboarding-flow.test.ts holds all of it. Words are returned
 * as keys and values (Msg); the screens put them through t().
 */
import { getCurrencyByCode } from './currencies';
import { monthlyFactor } from './subscriptions/cadence';

/** A sentence to show: a key in the catalogue and what fills it. */
export interface Msg {
  key: string;
  params?: Record<string, unknown>;
}

const msg = (key: string, params?: Record<string, unknown>): Msg => (params ? { key, params } : { key });

// ── The currency the phone's region uses ─────────────────────────────────────

/**
 * ISO 3166-1 alpha-2 region → ISO 4217 currency, for every region a phone can
 * report. Where a region uses more than one, the one its prices are written
 * in. Bulgaria has used the euro since 1 January 2026, Croatia since 2023;
 * Curaçao and Sint Maarten moved to the Caribbean guilder in 2025.
 */
export const REGION_CURRENCY: Readonly<Record<string, string>> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD', AO: 'AOA',
  AR: 'ARS', AS: 'USD', AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR', AZ: 'AZN', BA: 'BAM',
  BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'EUR', BH: 'BHD', BI: 'BIF', BJ: 'XOF',
  BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB', BQ: 'USD', BR: 'BRL', BS: 'BSD', BT: 'BTN',
  BV: 'NOK', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CC: 'AUD', CD: 'CDF', CF: 'XAF',
  CG: 'XAF', CH: 'CHF', CI: 'XOF', CK: 'NZD', CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP',
  CR: 'CRC', CU: 'CUP', CV: 'CVE', CW: 'XCG', CX: 'AUD', CY: 'EUR', CZ: 'CZK', DE: 'EUR',
  DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EC: 'USD', EE: 'EUR', EG: 'EGP',
  EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FJ: 'FJD', FK: 'FKP', FM: 'USD',
  FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP', GD: 'XCD', GE: 'GEL', GF: 'EUR', GG: 'GBP',
  GH: 'GHS', GI: 'GIP', GL: 'DKK', GM: 'GMD', GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR',
  GS: 'GBP', GT: 'GTQ', GU: 'USD', GW: 'XOF', GY: 'GYD', HK: 'HKD', HM: 'AUD', HN: 'HNL',
  HR: 'EUR', HT: 'HTG', HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS', IM: 'GBP', IN: 'INR',
  IO: 'USD', IQ: 'IQD', IR: 'IRR', IS: 'ISK', IT: 'EUR', JE: 'GBP', JM: 'JMD', JO: 'JOD',
  JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW',
  KR: 'KRW', KW: 'KWD', KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF',
  LK: 'LKR', LR: 'LRD', LS: 'LSL', LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD',
  MC: 'EUR', MD: 'MDL', ME: 'EUR', MF: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD', ML: 'XOF',
  MM: 'MMK', MN: 'MNT', MO: 'MOP', MP: 'USD', MQ: 'EUR', MR: 'MRU', MS: 'XCD', MT: 'EUR',
  MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NC: 'XPF',
  NE: 'XOF', NF: 'AUD', NG: 'NGN', NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD',
  NU: 'NZD', NZ: 'NZD', OM: 'OMR', PA: 'PAB', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP',
  PK: 'PKR', PL: 'PLN', PM: 'EUR', PN: 'NZD', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD',
  PY: 'PYG', QA: 'QAR', RE: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR',
  SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR', SJ: 'NOK',
  SK: 'EUR', SL: 'SLE', SM: 'EUR', SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN',
  SV: 'USD', SX: 'XCG', SY: 'SYP', SZ: 'SZL', TC: 'USD', TD: 'XAF', TF: 'EUR', TG: 'XOF',
  TH: 'THB', TJ: 'TJS', TK: 'NZD', TL: 'USD', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY',
  TT: 'TTD', TV: 'AUD', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', UM: 'USD', US: 'USD',
  UY: 'UYU', UZ: 'UZS', VA: 'EUR', VC: 'XCD', VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND',
  VU: 'VUV', WF: 'XPF', WS: 'WST', XK: 'EUR', YE: 'YER', YT: 'EUR', ZA: 'ZAR', ZM: 'ZMW',
  ZW: 'ZWG',
};

/** What expo-localization's getLocales()[0] says about the phone. */
export interface DeviceLocale {
  regionCode?: string | null;
  currencyCode?: string | null;
}

/** The currency a new user starts from when the phone says nothing usable. */
export const FALLBACK_CURRENCY = 'USD';

/** A region as ISO alpha-2, upper case, with the UK spelled GB; null if it is not one. */
export function normalizeRegionCode(region: string | null | undefined): string | null {
  const code = (region ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code === 'UK' ? 'GB' : code;
}

/**
 * The currency onboarding suggests: the region's, else the locale's, else
 * USD — and only one the app can show (`supported`, the currency list).
 */
export function regionCurrency(
  locale: DeviceLocale | null | undefined,
  supported: (code: string) => boolean = (code) => !!getCurrencyByCode(code),
): string {
  const region = normalizeRegionCode(locale?.regionCode);
  const fromRegion = region ? REGION_CURRENCY[region] : undefined;
  if (fromRegion && supported(fromRegion)) return fromRegion;
  const fromLocale = (locale?.currencyCode ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(fromLocale) && supported(fromLocale)) return fromLocale;
  return FALLBACK_CURRENCY;
}

// ── Steps, answers and resuming ──────────────────────────────────────────────

export const ONBOARDING_STEPS = ['currency', 'income', 'connect', 'detect', 'payoff'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** A place the subscriptions can be found in. */
export type SourceId = 'email' | 'statement' | 'bank';
export const SOURCE_IDS: readonly SourceId[] = ['email', 'statement', 'bank'];

/** The old spending-style step's three answers, which pick a first budget from the income. */
export type BudgetStyle = 'frugal' | 'moderate' | 'generous';
export const BUDGET_SHARE: Readonly<Record<BudgetStyle, number>> = { frugal: 0.5, moderate: 0.7, generous: 0.85 };
export const BUDGET_STYLES: readonly BudgetStyle[] = ['frugal', 'moderate', 'generous'];

export interface OnboardingAnswers {
  /** The chosen currency code; null until the currency step is confirmed. */
  currency: string | null;
  /** Null: skipped (nothing is written). */
  monthlyIncome: number | null;
  /** The first budget's share of the income; null: no budget set. */
  budgetStyle: BudgetStyle | null;
  /** Sources connected while onboarding. */
  connected: SourceId[];
  /** Sources offered at Connect and passed over: Home's checklist offers them again. */
  skipped: SourceId[];
}

export interface OnboardingProgress {
  version: 1;
  step: OnboardingStep;
  answers: OnboardingAnswers;
}

export type OnboardingAction =
  | { type: 'confirmCurrency'; code: string }
  | { type: 'setIncome'; monthlyIncome: number; budgetStyle: BudgetStyle | null }
  | { type: 'skipIncome' }
  | { type: 'connected'; source: SourceId }
  /** Leave Connect: whatever was offered and is not connected counts as skipped. */
  | { type: 'finishConnect'; offered: readonly SourceId[]; connected: readonly SourceId[] }
  | { type: 'detected' }
  | { type: 'back' };

export function startProgress(): OnboardingProgress {
  return {
    version: 1,
    step: 'currency',
    answers: { currency: null, monthlyIncome: null, budgetStyle: null, connected: [], skipped: [] },
  };
}

const withStep = (p: OnboardingProgress, step: OnboardingStep): OnboardingProgress => ({ ...p, step });
function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** One answer, and the step it leads to. Never mutates. */
export function reduceOnboarding(p: OnboardingProgress, action: OnboardingAction): OnboardingProgress {
  const a = p.answers;
  switch (action.type) {
    case 'confirmCurrency':
      return { ...p, step: 'income', answers: { ...a, currency: action.code } };
    case 'setIncome': {
      const income = action.monthlyIncome > 0 ? action.monthlyIncome : null;
      return {
        ...p,
        step: 'connect',
        answers: { ...a, monthlyIncome: income, budgetStyle: income === null ? null : action.budgetStyle },
      };
    }
    case 'skipIncome':
      return { ...p, step: 'connect', answers: { ...a, monthlyIncome: null, budgetStyle: null } };
    case 'connected':
      return {
        ...p,
        answers: {
          ...a,
          connected: uniq([...a.connected, action.source]),
          skipped: a.skipped.filter((s) => s !== action.source),
        },
      };
    case 'finishConnect': {
      const connected = uniq([...a.connected, ...action.connected]);
      const skipped = uniq(action.offered.filter((s) => !connected.includes(s)));
      return { ...p, step: 'detect', answers: { ...a, connected, skipped } };
    }
    case 'detected':
      return withStep(p, 'payoff');
    case 'back': {
      // The search and its results are not a place to go back to: back from
      // either returns to Connect.
      if (p.step === 'detect' || p.step === 'payoff') return withStep(p, 'connect');
      const i = ONBOARDING_STEPS.indexOf(p.step);
      return i > 0 ? withStep(p, ONBOARDING_STEPS[i - 1]!) : p;
    }
  }
}

/** Where the bar is: currency, income and connect, then the results as the fourth. */
export function progressPosition(step: OnboardingStep): { index: number; total: number } {
  const index = Math.min(ONBOARDING_STEPS.indexOf(step), 3);
  return { index: Math.max(index, 0), total: 4 };
}

const isStep = (v: unknown): v is OnboardingStep =>
  typeof v === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(v);
const isSource = (v: unknown): v is SourceId => typeof v === 'string' && (SOURCE_IDS as readonly string[]).includes(v);
const isStyle = (v: unknown): v is BudgetStyle =>
  typeof v === 'string' && (BUDGET_STYLES as readonly string[]).includes(v);

/**
 * Saved progress, checked, as it resumes: the step the user left, with the
 * answers they gave. A search or a payoff resumes at the search, which runs
 * again — its result is not saved. Anything malformed is no progress at all.
 */
export function resumeProgress(raw: unknown): OnboardingProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !isStep(r.step) || !r.answers || typeof r.answers !== 'object') return null;
  const a = r.answers as Record<string, unknown>;
  const currency = typeof a.currency === 'string' && /^[A-Z]{3}$/.test(a.currency) ? a.currency : null;
  const income =
    typeof a.monthlyIncome === 'number' && Number.isFinite(a.monthlyIncome) && a.monthlyIncome > 0
      ? a.monthlyIncome
      : null;
  const answers: OnboardingAnswers = {
    currency,
    monthlyIncome: income,
    budgetStyle: income !== null && isStyle(a.budgetStyle) ? a.budgetStyle : null,
    connected: Array.isArray(a.connected) ? uniq(a.connected.filter(isSource)) : [],
    skipped: Array.isArray(a.skipped) ? uniq(a.skipped.filter(isSource)) : [],
  };
  let step: OnboardingStep = r.step === 'payoff' ? 'detect' : r.step;
  // A step past the currency without a currency has nothing to stand on.
  if (step !== 'currency' && !answers.currency) step = 'currency';
  return { version: 1, step, answers };
}

/** A first monthly budget: the style's share of the income, in whole units of the currency. */
export function suggestedBudget(monthlyIncome: number, style: BudgetStyle): number {
  if (!(monthlyIncome > 0)) return 0;
  return Math.round(monthlyIncome * BUDGET_SHARE[style]);
}

/**
 * What finishing writes to the settings: the income and the budget it picked,
 * when given — and nothing else. The currency was written at its own step;
 * the starting balance is never touched (the old onboarding zeroed it, and
 * Home's "Set a goal" used to rerun onboarding).
 */
export function settingsFromAnswers(a: OnboardingAnswers): {
  monthlyIncome?: number;
  spendingStyle?: BudgetStyle;
  monthlyBudget?: number;
} {
  if (a.monthlyIncome === null || !(a.monthlyIncome > 0)) return {};
  if (!a.budgetStyle) return { monthlyIncome: a.monthlyIncome };
  return {
    monthlyIncome: a.monthlyIncome,
    spendingStyle: a.budgetStyle,
    monthlyBudget: suggestedBudget(a.monthlyIncome, a.budgetStyle),
  };
}

// ── Connect your data ────────────────────────────────────────────────────────

export type ConnectOptionId = 'gmail' | 'outlook' | 'statement' | 'bank';

/** What GET /api/v1/email/connections says the server can connect. */
export interface EmailProvidersInfo {
  gmail: { configured: boolean; verified?: boolean; capReached?: boolean };
  outlook: { configured: boolean };
}

/** bank-linking.ts bankLinkAvailability's state. */
export type BankRegionState = 'available' | 'outside' | 'not_configured' | 'unknown';

export interface ConnectFacts {
  /** Null: the server could not be asked. */
  providers: EmailProvidersInfo | null;
  /** The user's inboxes, any provider (forwarding counts as connected). */
  emailConnections: readonly { provider: string }[];
  statementImported: boolean;
  bankState: BankRegionState;
  banksLinked: number;
  /** Pro, with the development override already applied (useEntitlement). */
  isPro: boolean;
}

export interface ConnectOption {
  id: ConnectOptionId;
  source: SourceId;
  done: boolean;
  /** False: shown, but cannot be started (Gmail's user cap). */
  available: boolean;
  /** Bank linking is Pro: shown with the mark to a free user. */
  pro: boolean;
  /** Google will show its "not verified" screen first. */
  unverified: boolean;
  /** Gmail's unverified 100-user cap is reached. */
  capReached: boolean;
}

export interface ConnectModel {
  options: ConnectOption[];
  /** The server could not say which inboxes it connects. */
  emailUnreachable: boolean;
  /** Every source with an option on the screen. */
  offered: SourceId[];
  /** Every source already connected, however it got there. */
  connected: SourceId[];
  /** Outlook can be connected here: a full Gmail points to it only then (it is parked without Microsoft keys). */
  outlookOffered: boolean;
}

export function connectModel(f: ConnectFacts): ConnectModel {
  const has = (provider: string) => f.emailConnections.some((c) => c.provider === provider);
  const options: ConnectOption[] = [];
  const base = { pro: false, unverified: false, capReached: false };
  if (f.providers?.gmail.configured) {
    const done = has('gmail');
    const capReached = !!f.providers.gmail.capReached && !done;
    options.push({
      ...base,
      id: 'gmail',
      source: 'email',
      done,
      available: !capReached,
      capReached,
      unverified: f.providers.gmail.verified === false,
    });
  }
  if (f.providers?.outlook.configured) {
    options.push({ ...base, id: 'outlook', source: 'email', done: has('outlook'), available: true });
  }
  options.push({ ...base, id: 'statement', source: 'statement', done: f.statementImported, available: true });
  // Only where Plaid serves this phone's region: "unknown" (the server could
  // not say) and "outside" offer nothing here, where nothing could be checked.
  if (f.bankState === 'available') {
    options.push({ ...base, id: 'bank', source: 'bank', done: f.banksLinked > 0, available: true, pro: !f.isPro });
  }

  const connected: SourceId[] = [];
  if (f.emailConnections.length > 0) connected.push('email');
  if (f.statementImported) connected.push('statement');
  if (f.banksLinked > 0) connected.push('bank');

  return {
    options,
    emailUnreachable: f.providers === null,
    offered: uniq(options.map((o) => o.source)),
    connected,
    outlookOffered: options.some((o) => o.id === 'outlook'),
  };
}

/** Why an inbox did not connect, as connectEmailProvider reports it, worded. */
export function connectFailure(result: { result: string; reason?: string }, outlookOffered = true): Msg | null {
  if (result.result === 'success' || result.result === 'cancel') return null;
  if (result.result === 'denied') return msg('onboardingFlow.connect.errors.denied');
  switch (result.reason) {
    case 'not_configured':
      return msg('onboardingFlow.connect.errors.notConfigured');
    case 'cap_reached':
      return msg(outlookOffered ? 'onboardingFlow.connect.errors.capReached' : 'onboardingFlow.connect.errors.capReachedNoOutlook');
    case 'locked':
      return msg('onboardingFlow.connect.errors.locked');
    case 'network':
    case 'timeout':
      return msg('onboardingFlow.connect.errors.offline');
    default:
      return msg('onboardingFlow.connect.errors.failed');
  }
}

// ── The first search ─────────────────────────────────────────────────────────

export interface InboxState {
  provider: string;
  status: string;
  syncState: string;
  backfillDoneAt: string | null;
  messagesScanned: number;
}

/**
 * Whether an inbox is still reading its first year, and how far it has got.
 * Only a read that is running counts: an idle connection whose first read
 * never finished (the server slept) is not worth a wait.
 */
export function inboxReading(connections: readonly InboxState[]): { reading: boolean; scanned: number } {
  const running = connections.filter(
    (c) =>
      (c.provider === 'gmail' || c.provider === 'outlook') &&
      c.status === 'active' &&
      !c.backfillDoneAt &&
      (c.syncState === 'backfilling' || c.syncState === 'syncing'),
  );
  return {
    reading: running.length > 0,
    scanned: running.reduce((n, c) => n + (Number(c.messagesScanned) || 0), 0),
  };
}

// ── Money, in the user's currency and language ───────────────────────────────

/**
 * An amount in `currency` for `intlTag`. `whole` drops the minor units — the
 * payoff's monthly total is an estimate, and "£47/month" reads as one.
 */
export function formatMoney(amount: number, currency: string, intlTag: string, whole = false): string {
  const decimals = whole ? 0 : (getCurrencyByCode(currency)?.decimals ?? 2);
  const value = whole ? Math.round(amount) : amount;
  try {
    return new Intl.NumberFormat(intlTag, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    const symbol = getCurrencyByCode(currency)?.symbol ?? currency;
    return `${symbol}${value.toFixed(decimals)}`;
  }
}

// ── The payoff ───────────────────────────────────────────────────────────────

/** The fields of a found subscription the payoff reads (db.ts Subscription). */
export interface PayoffSubscription {
  id: string;
  merchantDisplay: string;
  typicalAmount: number;
  cadence: string;
  currency: string;
  status: string;
  nextExpectedAt?: string | null;
  trialEndsAt?: string | null;
}

export type NotificationPermission = 'granted' | 'undetermined' | 'denied';

export interface PayoffInput {
  /** runDetection's DetectionSummary. */
  summary: {
    active: readonly PayoffSubscription[];
    monthlyTotal: number;
    currency: string;
    notInTotal: number;
  };
  /** The user's currency, when the summary could not say. */
  currency: string;
  intlTag: string;
  emailConnected: boolean;
  /** The first read of an inbox had not finished when the search ran. */
  inboxStillReading: boolean;
  /** Anything at all connected: email, a statement or a bank. */
  anySource: boolean;
  /** Null: not known yet. */
  permission: NotificationPermission | null;
}

export interface PayoffItem {
  id: string;
  name: string;
  /** "£9.99 a month", or the trial's wording. */
  line: Msg;
  trial: boolean;
}

export interface PayoffModel {
  found: number;
  headline: Msg;
  body: Msg | null;
  /** Subscriptions left out of the total for want of an exchange rate. */
  note: Msg | null;
  items: PayoffItem[];
  /** How many were found beyond the listed few. */
  more: number;
  /**
   * ask: offer the one permission prompt (there is something to remind
   * about, and the phone can still ask); on: already allowed; off: refused;
   * none: nothing to remind about, so nothing is said or asked.
   */
  reminders: 'ask' | 'on' | 'off' | 'none';
  remindersLine: Msg | null;
}

/** How many found subscriptions the payoff lists by name. */
export const PAYOFF_LISTED = 3;

const PER_CADENCE: Readonly<Record<string, string>> = {
  weekly: 'onboardingFlow.payoff.perWeek',
  biweekly: 'onboardingFlow.payoff.perTwoWeeks',
  monthly: 'onboardingFlow.payoff.perMonth',
  quarterly: 'onboardingFlow.payoff.perQuarter',
  semiannual: 'onboardingFlow.payoff.perHalfYear',
  yearly: 'onboardingFlow.payoff.perYear',
};

export function payoffModel(input: PayoffInput): PayoffModel {
  const { summary } = input;
  const currency = summary.currency || input.currency;
  const active = summary.active;
  const found = active.length;

  // The most expensive first, in the user's currency; another currency's
  // figures cannot be compared without a rate, so they follow.
  const monthly = (s: PayoffSubscription) => (Number(s.typicalAmount) || 0) * (monthlyFactor(s.cadence) || 1);
  const ranked = [...active].sort((a, b) => {
    const mineA = a.currency === currency ? 0 : 1;
    const mineB = b.currency === currency ? 0 : 1;
    if (mineA !== mineB) return mineA - mineB;
    return monthly(b) - monthly(a) || a.merchantDisplay.localeCompare(b.merchantDisplay);
  });
  const items: PayoffItem[] = ranked.slice(0, PAYOFF_LISTED).map((s) => {
    const amount = formatMoney(Number(s.typicalAmount) || 0, s.currency || currency, input.intlTag);
    const trial = s.status === 'trial' || !!s.trialEndsAt;
    const key = trial ? 'onboardingFlow.payoff.trialThen' : PER_CADENCE[s.cadence] ?? 'onboardingFlow.payoff.amountOnly';
    return { id: s.id, name: s.merchantDisplay, line: msg(key, { amount }), trial };
  });

  let headline: Msg;
  let body: Msg | null = null;
  let note: Msg | null = null;
  if (found > 0) {
    const counted = found - summary.notInTotal;
    headline =
      counted > 0
        ? msg('onboardingFlow.payoff.found', {
            count: found,
            total: formatMoney(summary.monthlyTotal, currency, input.intlTag, summary.monthlyTotal >= 10),
          })
        : msg('onboardingFlow.payoff.foundNoTotal', { count: found });
    if (summary.notInTotal > 0 && counted > 0) {
      note = msg('onboardingFlow.payoff.notInTotal', { count: summary.notInTotal });
    }
  } else {
    headline = msg('onboardingFlow.payoff.noneTitle');
    if (input.emailConnected && input.inboxStillReading) body = msg('onboardingFlow.payoff.noneStillReading');
    else if (input.emailConnected) body = msg('onboardingFlow.payoff.noneWatching');
    else if (input.anySource) body = msg('onboardingFlow.payoff.noneConnectEmail');
    else body = msg('onboardingFlow.payoff.noneNothing');
  }

  // Something to remind about: a charge with a next date, or a trial's end.
  const remindable = active.some((s) => !!s.nextExpectedAt || !!s.trialEndsAt);
  let reminders: PayoffModel['reminders'] = 'none';
  let remindersLine: Msg | null = null;
  if (remindable) {
    if (input.permission === 'granted') {
      reminders = 'on';
      remindersLine = msg('onboardingFlow.payoff.remindOn');
    } else if (input.permission === 'undetermined') {
      reminders = 'ask';
      remindersLine = msg('onboardingFlow.payoff.remindAsk');
    } else if (input.permission === 'denied') {
      reminders = 'off';
      remindersLine = msg('onboardingFlow.payoff.remindOff');
    }
  }

  return {
    found,
    headline,
    body,
    note,
    items,
    more: Math.max(0, found - items.length),
    reminders,
    remindersLine,
  };
}

// ── Profile settings: the income and goal editors ────────────────────────────

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * A typed amount, however it was typed: "1 234,50", "1,234.50", "1.234,50",
 * "47", Arabic-Indic digits. The last separator followed by one or two digits
 * is the decimal one; groups of three are thousands. Null for anything that is
 * not a non-negative amount.
 */
export function parseAmountInput(raw: string): number | null {
  let s = (raw ?? '')
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/٬/g, ',') // Arabic thousands separator
    .replace(/[\s  ']/g, '');
  // Symbols and codes around the number go; a sign stays to be refused.
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || s.includes('-')) return null;
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  let normalized: string;
  if (last === -1) {
    normalized = s;
  } else {
    const sep = s[last]!;
    const tail = s.slice(last + 1);
    const occurrences = s.split(sep).length - 1;
    const other = sep === '.' ? ',' : '.';
    const decimal =
      s.includes(other) // both kinds: the last one is the decimal separator
        ? true
        : occurrences === 1 && tail.length !== 3; // "12,5" and "12.50" are decimals; "1,234" groups
    const whole = s.slice(0, last).replace(/[.,]/g, '');
    // "12." while typing is twelve.
    normalized = !decimal ? s.replace(/[.,]/g, '') : tail ? `${whole || '0'}.${tail}` : whole;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 1e12) return null;
  return Math.round(value * 100) / 100;
}

/** What each editor writes: its own field and nothing else (never the starting balance). */
export function profileEdit(
  field: 'goal' | 'income',
  value: number | null,
): { savingsGoal: number } | { monthlyIncome: number } {
  const amount = value !== null && value > 0 ? value : 0;
  return field === 'goal' ? { savingsGoal: amount } : { monthlyIncome: amount };
}

// ── Joining a company ────────────────────────────────────────────────────────

/** An invite code as the server stores it: upper case, no spaces or dashes. */
export function normalizeInviteCode(raw: string): string {
  return (raw ?? '').replace(/[\s\-_]/g, '').toUpperCase();
}

/**
 * What is wrong with a code before it is sent, or null. The server's codes
 * are six characters (routes/business.ts generateCode).
 */
export function inviteCodeProblem(code: string): 'empty' | 'format' | null {
  const c = normalizeInviteCode(code);
  if (!c) return 'empty';
  return /^[A-Z0-9]{6}$/.test(c) ? null : 'format';
}

export type JoinFailure = 'wrongCode' | 'rateLimited' | 'alreadyMember' | 'offline' | 'other';

/**
 * Why joining failed, from the ApiFailure businessApi rejects with: an
 * unknown code (404), too many tries (429, five a quarter hour), already in
 * that company (409: a member, or its owner), or no connection.
 */
export function joinFailure(e: unknown): JoinFailure {
  const err = (e ?? {}) as { kind?: unknown; status?: unknown };
  const kind = typeof err.kind === 'string' ? err.kind : null;
  const status = typeof err.status === 'number' ? err.status : null;
  if (kind === 'notFound' || status === 404 || kind === 'validation' || status === 400) return 'wrongCode';
  if (kind === 'rateLimited' || status === 429) return 'rateLimited';
  if (kind === 'conflict' || status === 409) return 'alreadyMember';
  if (kind === 'network' || kind === 'timeout') return 'offline';
  return 'other';
}

export function joinErrorMessage(problem: JoinFailure | 'empty' | 'format'): Msg {
  return msg(`onboardingFlow.join.errors.${problem}`);
}
