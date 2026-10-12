/**
 * Crash reporting (Sentry), with nothing personal in it.
 *
 * The owner agreed to crash reporting on one condition: it collects no
 * personal data. This module is where that is kept. It is the only place that
 * starts Sentry, it starts it only when a DSN was configured for the build
 * (EXPO_PUBLIC_SENTRY_DSN), and every event and breadcrumb passes through the
 * scrubbers below before it can leave the phone.
 *
 * What is sent: the error's type, its message with anything personal cut out,
 * the stack trace, the app's version, the device model and OS, and a trail of
 * breadcrumbs reduced the same way. The user is an opaque id (the account's
 * random id) and nothing else — never an email or a name.
 *
 * What is not: emails, money amounts, transaction notes and names, request
 * and response bodies, query strings, cookies, auth headers, console output
 * beyond a log line's [tag], screenshots, the view hierarchy, session replay
 * and performance traces.
 *
 * Imports nothing from Sentry at runtime: the root layout hands the SDK in, so
 * the scrubbers are tested with `bun test` like any other pure module.
 */
import type * as SentrySdkModule from '@sentry/react-native';
import { CURRENCIES } from './currencies';

type Breadcrumb = SentrySdkModule.Breadcrumb;
type Event = SentrySdkModule.Event;
type Exception = SentrySdkModule.Exception;
type ReactNativeOptions = SentrySdkModule.ReactNativeOptions;
type StackFrame = SentrySdkModule.StackFrame;
type User = SentrySdkModule.User;

// ── Text ─────────────────────────────────────────────────────────────────────

/** Western and Arabic-Indic digits: the app formats money in both. */
const D = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
/**
 * A number as money is written: 12 · 12.50 · 1,234.56 · 1 234,56 · ١٢٫٥٠.
 * One separator at a time, so a long run of them cannot make it backtrack.
 */
const NUM = `${D}(?:[\\u00a0\\u202f ,.'\\u066B\\u066C]?${D})*`;
const SIGN = '[-−+]?';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const byLengthDesc = (a: string, b: string) => b.length - a.length;

const codes = [...new Set(CURRENCIES.map((c) => c.code))].sort(byLengthDesc);
const symbols = [...new Set(CURRENCIES.map((c) => c.symbol))].filter((s) => !codes.includes(s));
/**
 * Symbols written with letters (kr, Rp, KSh) only count as a currency standing
 * on their own, and single letters (R, K, P, Q, L) not at all: "T" would turn
 * every ISO timestamp into an amount. The ISO code covers those currencies.
 */
const wordSymbols = symbols.filter((s) => /^[A-Za-z.]+$/.test(s) && s.replace('.', '').length >= 2).sort(byLengthDesc);
const markSymbols = symbols.filter((s) => !/^[A-Za-z.]+$/.test(s)).sort(byLengthDesc);
const WORD = `(?:${[...codes, ...wordSymbols].map(escapeRegExp).join('|')})`;
const MARK = `(?:${markSymbols.map(escapeRegExp).join('|')})`;

const AMOUNT = '[amount]';
const MONEY_PATTERNS: [RegExp, string][] = [
  // $12.50 · €5 · ₹1,200 · R$ 30 · -$4
  [new RegExp(`${MARK}\\s?${SIGN}${NUM}`, 'g'), AMOUNT],
  // 12.50 € · 1 234,56 €
  [new RegExp(`${NUM}\\s?${MARK}`, 'g'), AMOUNT],
  // USD 12.50 · kr 40 — a code or worded symbol standing on its own
  [new RegExp(`(^|[^A-Za-z])${WORD}\\s?${SIGN}${NUM}`, 'g'), `$1${AMOUNT}`],
  // 12.50 USD · 40kr
  [new RegExp(`${NUM}\\s?${WORD}(?![A-Za-z])`, 'g'), AMOUNT],
  // amount: 1500 · balance is 20 · total 30 — a bare number named as money
  [
    /\b(amounts?|balances?|totals?|prices?|costs?|budgets?|salary|salaries|income|spent|spend|spending|paid|owed|debt)(\s*[:=]\s*|\s+(?:of|is|was|to)\s+|\s+)[-−+]?\d[\d,.]*/gi,
    `$1$2${AMOUNT}`,
  ],
  // 1,234 · 12.50 · 12,50 — written the way money is, and not part of a
  // version or a time (6.14.0 and 12:30:45.123 are left alone)
  [/(^|[^\d.,])([-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−]?\d+[.,]\d{2})(?![\d]|[.,]\d)/g, `$1${AMOUNT}`],
];

/** Emails, including the URL-encoded form a path carries (simo%40icloud.com). */
const EMAIL = /[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const AUTH_SCHEME = /\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9\-._~+/=]+/gi;
/** A cookie header's whole value: it is a list, so it runs to the end of the line. */
const COOKIE_LINE = /\b(set-cookie|cookie)(\s*:\s*)[^\n]*/gi;
const SECRET_PAIR =
  /\b(access_token|refresh_token|id_token|token|api[_-]?key|password|passwd|secret|session(?:_?id|_?token)?|cookie|set-cookie|authorization)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
/** Everything from a URL's ? or # on: query strings carry searches, emails, tokens. */
const URL_QUERY = /((?:\b[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#"'<>]*)[?#][^\s"'<>]*/gi;
/** Serialized fields that hold what a person typed: "note":"Lunch with Ana". */
const JSON_PERSONAL_FIELD =
  /"([A-Za-z_]*(?:note|name|merchant|payee|memo|description|title|label|comment|category|email|amount|balance|text)[A-Za-z_]*)"\s*:\s*(?:"(?:[^"\\]|\\.)*"|[-−]?\d[\d.eE+-]*)/gi;
/**
 * Quoted prose. A quoted run with a space in it is something someone wrote
 * ("Lunch with Ana", «Courses du samedi»); code in a message is quoted
 * without one ('map', "./a"), so that stays readable.
 */
const QUOTED_PROSE: [RegExp, string][] = [
  [/"[^"\n]*\s[^"\n]*"/g, '"[text]"'],
  [/“[^”\n]*”/g, '“[text]”'],
  [/«[^»\n]*»/g, '«[text]»'],
];

/**
 * Everything personal that can be recognised in free text: emails, auth
 * tokens, query strings, typed fields, quoted prose and money amounts.
 */
export function scrubText(text: string): string {
  let s = text
    .replace(EMAIL, '[email]')
    .replace(AUTH_SCHEME, '$1 [redacted]')
    .replace(COOKIE_LINE, '$1$2[redacted]')
    .replace(SECRET_PAIR, '$1$2[redacted]')
    .replace(URL_QUERY, '$1')
    .replace(JSON_PERSONAL_FIELD, '"$1":"[redacted]"');
  for (const [pattern, replacement] of QUOTED_PROSE) s = s.replace(pattern, replacement);
  for (const [pattern, replacement] of MONEY_PATTERNS) s = s.replace(pattern, replacement);
  return s;
}

/**
 * The lighter pass for device facts (OS version, model, app version): only
 * what identifies a person. The money pass would read "iPhone14,10" or an OS
 * "17.10" as amounts.
 */
function scrubIdentifiers(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(AUTH_SCHEME, '$1 [redacted]')
    .replace(COOKIE_LINE, '$1$2[redacted]')
    .replace(SECRET_PAIR, '$1$2[redacted]')
    .replace(URL_QUERY, '$1');
}

/** A URL with its query string and fragment cut off, and the rest scrubbed. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return scrubText(cut === -1 ? url : url.slice(0, cut));
}

// ── Structured data ──────────────────────────────────────────────────────────

/**
 * Keys whose values are dropped outright wherever free-form data travels
 * (extra, tags, breadcrumb data): credentials, bodies, queries, and the fields
 * that hold what a person typed or how much money moved.
 */
const PERSONAL_KEY =
  /e-?mail|passw|secret|token|cookie|auth|session|api[-_]?key|bod(?:y|ies)|quer(?:y|ies)|fragment|header|param|argument|note|memo|merchant|payee|descr|title|name|label|comment|text|amount|balance|salary|income|price|cost|total|phone|address|iban|card|account|user|request|response|input|value/i;
/**
 * The same for device contexts, which are the device's facts rather than
 * anything typed, so names (os.name: "iOS") stay; credentials and network
 * detail do not. device.name is removed separately: it is the phone's owner's
 * name on older iOS.
 */
const CONTEXT_KEY = /e-?mail|passw|secret|token|cookie|auth|session|api[-_]?key|bod(?:y|ies)|quer(?:y|ies)|fragment|header|ip_?address|phone|iban|user/i;
const MAX_DEPTH = 5;

type Scrub = (text: string) => string;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function scrubValue(value: unknown, keyPattern: RegExp, scrub: Scrub, depth: number): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, keyPattern, scrub, depth + 1));
  if (isPlainObject(value)) return scrubRecord(value, keyPattern, scrub, depth + 1);
  // An Error, a Date, a class instance: only its text form, scrubbed.
  if (typeof value === 'object') return scrub(String(value));
  return undefined; // functions, symbols, bigints
}

function scrubRecord(
  record: Record<string, unknown>,
  keyPattern: RegExp,
  scrub: Scrub,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keyPattern.test(key)) continue;
    const scrubbed = scrubValue(value, keyPattern, scrub, depth);
    if (scrubbed !== undefined) out[key] = scrubbed;
  }
  return out;
}

/** The free-form data scrub: drops personal keys, scrubs every string left. */
export function scrubData(data: Record<string, unknown>): Record<string, unknown> {
  return scrubRecord(data, PERSONAL_KEY, scrubText);
}

/** The user as Sentry may see them: an opaque id, or no one. */
export function opaqueUser(user: User | null | undefined): User | undefined {
  const id = user?.id;
  if (typeof id === 'string' && id.length > 0) return { id };
  if (typeof id === 'number') return { id: String(id) };
  return undefined;
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

const HTTP_CATEGORIES = new Set(['fetch', 'xhr', 'http']);

/**
 * A log line's leading [tag] — "[sign-out]", "[mobile:gate:db]" — written in
 * code, so it says where without saying what about whom. The rest of the line
 * is dropped: the app logs user ids, emails and server answers.
 */
function consoleTag(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const match = /^\s*(\[[^\]\n]{1,60}\])/.exec(message);
  return match ? scrubText(match[1]) : null;
}

/** Only what a request breadcrumb needs: its method, where (no query), and the status. */
function scrubHttpData(data: Breadcrumb['data']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data) return out;
  if (typeof data.method === 'string') out.method = data.method.slice(0, 10).toUpperCase();
  if (typeof data.url === 'string') out.url = scrubUrl(data.url);
  if (typeof data.status_code === 'number') out.status_code = data.status_code;
  return out;
}

/**
 * A breadcrumb with nothing personal in it, or null to drop it.
 *
 * Console breadcrumbs keep their level and [tag] only, and only for warnings
 * and errors. Request breadcrumbs keep method, URL without its query, and the
 * status — never bodies or headers. Anything else keeps its kind and a
 * scrubbed message, and its data loses every personal key.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const { type, category, level, timestamp, message, data } = breadcrumb;
  const base: Breadcrumb = {};
  if (type !== undefined) base.type = type;
  if (category !== undefined) base.category = category;
  if (level !== undefined) base.level = level;
  if (timestamp !== undefined) base.timestamp = timestamp;

  if (category === 'console') {
    if (level !== 'warning' && level !== 'error' && level !== 'fatal') return null;
    const tag = consoleTag(message);
    return tag ? { ...base, message: tag } : null;
  }

  if (typeof message === 'string') base.message = scrubText(message);
  if (type === 'http' || (category !== undefined && HTTP_CATEGORIES.has(category))) {
    base.data = scrubHttpData(data);
  } else if (data && isPlainObject(data)) {
    base.data = scrubData(data);
  }
  return base;
}

/** scrubBreadcrumb, except that a scrubber failure drops the breadcrumb instead of throwing. */
export function scrubBreadcrumbSafely(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    return scrubBreadcrumb(breadcrumb);
  } catch {
    return null;
  }
}

// ── Events ───────────────────────────────────────────────────────────────────

type MechanismData = NonNullable<Exception['mechanism']>['data'];

/** A stack frame keeps where it is in the code; local variables, if any, go. */
function scrubFrame(frame: StackFrame): StackFrame {
  const { vars: _vars, ...rest } = frame;
  return rest;
}

function scrubFrames<T extends { frames?: StackFrame[] }>(stacktrace: T | undefined): T | undefined {
  if (!stacktrace) return stacktrace;
  return { ...stacktrace, frames: stacktrace.frames?.map(scrubFrame) };
}

function scrubContexts(contexts: NonNullable<Event['contexts']>): Event['contexts'] {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, context] of Object.entries(contexts)) {
    // A failed request's response, the request itself, app state: none of it goes.
    if (name === 'response' || name === 'request' || name === 'state' || name === 'user') continue;
    if (!isPlainObject(context)) continue;
    const scrubbed = scrubRecord(context, CONTEXT_KEY, scrubIdentifiers);
    if (name === 'device') delete scrubbed.name;
    out[name] = scrubbed;
  }
  return out as Event['contexts'];
}

/**
 * An event with nothing personal in it. Pure: returns a new event and leaves
 * the one it was given alone.
 */
export function scrubEvent<T extends Event>(event: T): T {
  const out: T = { ...event };

  const user = opaqueUser(event.user);
  if (user) out.user = user;
  else delete out.user;

  // The request (URL, headers, cookies, body, query) — kept only as where it went.
  if (event.request) {
    const url = typeof event.request.url === 'string' ? scrubUrl(event.request.url) : undefined;
    if (url) out.request = { url, method: event.request.method };
    else delete out.request;
  }
  delete out.server_name;

  if (typeof event.message === 'string') out.message = scrubText(event.message);
  if (event.logentry) {
    // The template's parameters are the values that went into it: dropped.
    out.logentry = typeof event.logentry.message === 'string' ? { message: scrubText(event.logentry.message) } : {};
  }
  if (typeof event.transaction === 'string') out.transaction = scrubUrl(event.transaction);

  if (event.exception?.values) {
    out.exception = {
      ...event.exception,
      values: event.exception.values.map((value) => ({
        ...value,
        type: typeof value.type === 'string' ? scrubText(value.type) : value.type,
        value: typeof value.value === 'string' ? scrubText(value.value) : value.value,
        stacktrace: scrubFrames(value.stacktrace),
        mechanism: value.mechanism && {
          ...value.mechanism,
          data: value.mechanism.data && (scrubData(value.mechanism.data) as MechanismData),
        },
      })),
    };
  }
  if (event.threads?.values) {
    out.threads = {
      ...event.threads,
      values: event.threads.values.map((thread) => ({ ...thread, stacktrace: scrubFrames(thread.stacktrace) })),
    };
  }

  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumbSafely)
      .filter((b): b is Breadcrumb => b !== null);
  }
  if (event.extra) out.extra = scrubData(event.extra);
  if (event.tags) {
    out.tags = scrubData(event.tags) as T['tags'];
  }
  if (event.contexts) out.contexts = scrubContexts(event.contexts);
  if (event.fingerprint) out.fingerprint = event.fingerprint.map(scrubText);
  delete out.spans;

  // Tell Sentry not to store the IP address the event arrives from.
  out.sdk = { ...event.sdk, settings: { infer_ip: 'never' } } as T['sdk'];
  return out;
}

/**
 * What is left when the scrubber itself fails: the error's type and where it
 * was thrown, with every message replaced, so the crash is still counted
 * without risking a datum the scrubber did not get to.
 */
function skeletonEvent<T extends Event>(event: T): T {
  const frames = (stacktrace: { frames?: StackFrame[] } | undefined) =>
    stacktrace?.frames && {
      frames: stacktrace.frames.map(({ filename, function: fn, lineno, colno, in_app }) => ({
        filename,
        function: fn,
        lineno,
        colno,
        in_app,
      })),
    };
  const skeleton: Event = {
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    user: opaqueUser(event.user),
    tags: { scrubber: 'failed' },
    sdk: { ...event.sdk, settings: { infer_ip: 'never' } } as Event['sdk'],
  };
  if (event.exception?.values) {
    skeleton.exception = {
      values: event.exception.values.map((value) => ({
        type: typeof value.type === 'string' ? value.type.replace(/[^A-Za-z0-9_$.]/g, '') : 'Error',
        value: '[scrubber failed]',
        stacktrace: frames(value.stacktrace),
      })),
    };
  } else {
    skeleton.message = '[scrubber failed]';
  }
  return { ...skeleton, type: event.type } as T;
}

/**
 * scrubEvent for beforeSend: never throws, and never lets an unscrubbed event
 * through. If the scrubber fails the skeleton goes instead; if even that
 * fails, nothing does.
 */
export function scrubEventSafely<T extends Event>(event: T): T | null {
  try {
    return scrubEvent(event);
  } catch {
    try {
      return skeletonEvent(event);
    } catch {
      return null;
    }
  }
}

// ── Start-up ─────────────────────────────────────────────────────────────────

/** The parts of the Sentry SDK this module uses. The root layout passes the real one. */
export type SentrySdk = Pick<typeof SentrySdkModule, 'init' | 'getClient' | 'setUser'>;

export interface CrashReportingConfig {
  /** EXPO_PUBLIC_SENTRY_DSN. Absent or empty: crash reporting stays off. */
  dsn?: string;
  /** EXPO_PUBLIC_SENTRY_ENVIRONMENT, set per build profile in eas.json. */
  environment?: string;
}

/**
 * Switches for sentry-cocoa itself. Its own breadcrumbs are recorded natively,
 * where beforeBreadcrumb never sees them, and ride along with a native crash:
 * network breadcrumbs carry every request URL with its query, and touch
 * breadcrumbs carry the touched view's description — a text field's includes
 * what was typed in it, a button's its title. Both are off, so every
 * breadcrumb that leaves the phone came through scrubBreadcrumb. The React
 * Native SDK hands this options object to the native SDK as it is
 * (SentryOptions initWithDict reads both keys).
 */
type NativeOptions = { enableNetworkBreadcrumbs: boolean; enableAutoBreadcrumbTracking: boolean };

/** The build's configuration, read where Expo inlines EXPO_PUBLIC_ variables. */
export function crashReportingConfig(): CrashReportingConfig {
  return {
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  };
}

function defaultEnvironment(): string {
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production';
}

/** Sentry's options: no default PII, nothing recorded beyond the error itself, every datum scrubbed. */
export function crashReportingOptions(dsn: string, environment?: string): ReactNativeOptions & NativeOptions {
  return {
    dsn,
    environment: environment?.trim() || defaultEnvironment(),
    sendDefaultPii: false,
    // Nothing of the screen: no screenshots, no view hierarchy, no replay
    // (replaysSessionSampleRate / replaysOnErrorSampleRate stay unset).
    attachScreenshot: false,
    attachViewHierarchy: false,
    // No performance traces (tracesSampleRate stays unset), so no span ever
    // carries a URL or a timing; beforeSendTransaction below drops any anyway.
    enableAutoPerformanceTracing: false,
    enableUserInteractionTracing: false,
    // Failed requests would be sent with their headers and bodies.
    enableCaptureFailedRequests: false,
    enableNetworkBreadcrumbs: false,
    enableAutoBreadcrumbTracking: false,
    maxBreadcrumbs: 50,
    beforeSend: (event) => scrubEventSafely(event),
    beforeSendTransaction: () => null,
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumbSafely(breadcrumb),
  };
}

/** The SDK once started, for setting the user; null while crash reporting is off. */
let sdk: SentrySdk | null = null;

/**
 * Starts crash reporting if this build has a DSN. Returns whether it is on.
 *
 * Safe to call again: a fast refresh re-runs the root layout, and Sentry keeps
 * its client on the global object, so a second call finds it and does not
 * start a second one. Never throws — crash reporting failing to start must
 * not be what crashes the app.
 */
export function initCrashReporting(Sentry: SentrySdk, config: CrashReportingConfig = crashReportingConfig()): boolean {
  const dsn = config.dsn?.trim();
  if (!dsn) return false;
  try {
    if (!Sentry.getClient()) Sentry.init(crashReportingOptions(dsn, config.environment));
    sdk = Sentry;
    return true;
  } catch (e) {
    console.warn('[crash-reporting] start failed', e instanceof Error ? e.name : typeof e);
    return false;
  }
}

/**
 * Who the crashes belong to, as an opaque id: the signed-in account's random
 * id, or no one after sign-out. Does nothing while crash reporting is off.
 */
export function setCrashReportingUser(userId: string | null): void {
  if (!sdk) return;
  try {
    sdk.setUser(userId ? { id: userId } : null);
  } catch {
    // Not knowing who a crash belongs to is not worth a crash.
  }
}
