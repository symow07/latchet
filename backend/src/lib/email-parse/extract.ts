/**
 * Rules-first extraction: is this a bill, which kind, from whom, for how much,
 * how often and on which dates. The AI is a fallback only for billing-looking
 * mail the rules cannot read, and its answer goes through the same validator.
 */

import { dollarCodeForDomain, type CurrencyContext } from "./currency";
import { addPeriod, findDates, utcDayISO, type DateMatch } from "./dates";
import { detectBilledVia, findMerchant, isPersonalSender } from "./merchant";
import { findMoney, type MoneyMatch } from "./money";
import { detectLanguage, hasHan, hasKana, lineAt, lineWindow, normalizeForAnalysis, type Lang } from "./normalize";
import {
  COMPLETED_RE,
  FOOTER_RE,
  KIND_ORDER,
  KIND_RES,
  MARKETING_RE,
  NON_BILLING_RE,
  OTHER_BILLING_RE,
  UPCOMING_RE,
  looksLikeBilling,
  type RuleKind,
} from "./terms";
import { validateFinding, type RawFinding, type ValidationContext } from "./validate";
import type { AiExtractor, EmailFinding, EmailKind, FindingCadence, ParsedMessage } from "./types";

/** Below this the rules' finding is "low confidence" and the AI may help. */
export const AI_THRESHOLD = 0.6;
/** Text sent to the AI is cut to this many characters. */
export const AI_TEXT_LIMIT = 6_000;

export interface Analysis {
  msg: ParsedMessage;
  now: Date;
  subject: string;
  /** subject \n\n body \n\n attachments, normalised. */
  full: string;
  /** Where the body starts and the footer (if any) begins, in `full`. */
  bodyStart: number;
  footerStart: number;
  bodyEnd: number;
  /** Subject, body before the footer, and attachments: where kind phrases count. */
  head: string;
  lang: Lang;
  currency: CurrencyContext;
  monthFirst: boolean;
  refISO: string;
}

const US_STATE = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_EVIDENCE = new RegExp(
  `(?<![\\p{L}])(?:USD|US\\$|United States(?: of America)?|U\\.S\\.A?\\.|USA)(?![\\p{L}])|\\b(?:${US_STATE}),?\\s+\\d{5}(?:-\\d{4})?\\b|\\bsales tax\\b`,
  "u",
);
const DOLLAR_CODES: [RegExp, string][] = [
  [/(?<![\p{L}])(?:CAD|CA\$|C\$)/u, "CAD"],
  [/(?<![\p{L}])(?:AUD|AU\$|A\$)/u, "AUD"],
  [/(?<![\p{L}])(?:NZD|NZ\$)/u, "NZD"],
  [/(?<![\p{L}])(?:HKD|HK\$)/u, "HKD"],
  [/(?<![\p{L}])(?:SGD|SG\$|S\$)/u, "SGD"],
  [/(?<![\p{L}])(?:MXN|MX\$)/u, "MXN"],
  [/(?<![\p{L}])(?:TWD|NT\$)/u, "TWD"],
];

/** Signs that a "$" is not the US dollar: another dollar country's taxes, places or postcodes. */
const NON_US_DOLLAR =
  /(?<![\p{L}])(?:GST|HST|QST|PST|ABN|Canada|Canadian|Australia|Australian|New\s+Zealand|Singapore|Hong\s+Kong|Mexico|México|Ontario|Qu[ée]bec|British\s+Columbia|Alberta)(?![\p{L}])|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b(?:NSW|VIC|QLD|TAS|ACT)\s+\d{4}\b/u;

/**
 * The context that resolves ambiguous markers. A bare "$" is USD with US
 * evidence (an address, "USD", sales tax) or in English mail that shows no
 * sign of another dollar country — the way a person reads it; it is never
 * USD in, say, French-Canadian or Mexican mail without such evidence, and an
 * email without any currency marker never becomes USD.
 */
function currencyContext(text: string, domain: string | null, lang: Lang): CurrencyContext {
  const kana = hasKana(text);
  const tld = domain?.split(".").pop() ?? "";
  const chinese = (hasHan(text) && !kana) || /人民币|RMB|CNY/.test(text) || tld === "cn";
  const japanese = kana || /円|JPY/.test(text) || tld === "jp";
  const named = DOLLAR_CODES.filter(([re]) => re.test(text)).map(([, code]) => code);
  const usNamed = /(?<![\p{L}])(?:USD|US\$)/u.test(text);
  let dollarCode: string | null = null;
  if (named.length === 1 && !usNamed) dollarCode = named[0]!;
  else if (named.length === 0 && !usNamed) dollarCode = dollarCodeForDomain(domain);
  const usDollar = dollarCode === null && (US_EVIDENCE.test(text) || tld === "us" || (lang === "en" && !NON_US_DOLLAR.test(text)));
  const emirati = /(?<![\p{L}])(?:AED|UAE)(?![\p{L}])|د\.إ|الإمارات|Dubai|دبي|Abu Dhabi|أبوظبي/u.test(text) || tld === "ae";
  return { chinese, japanese, usDollar, dollarCode, emirati };
}

/** Billing facts sit near the top; past this the text is legal footers and newsletters. */
export const ANALYSIS_BODY_LIMIT = 30_000;
export const ANALYSIS_ATTACHMENT_LIMIT = 15_000;
/** Amounts and dates read per email: a bill has a handful; a catalogue has thousands. */
const MAX_MONEY = 300;
const MAX_DATES = 200;

export function analyze(msg: ParsedMessage, now: Date): Analysis {
  const subject = normalizeForAnalysis((msg.subject ?? "").slice(0, 500));
  const body = normalizeForAnalysis((msg.text ?? "").slice(0, ANALYSIS_BODY_LIMIT));
  const attachments = msg.attachmentsText.map((t) => normalizeForAnalysis(t.slice(0, ANALYSIS_ATTACHMENT_LIMIT))).join("\n\n");
  const bodyStart = subject.length + 2;
  const full = `${subject}\n\n${body}${attachments ? `\n\n${attachments}` : ""}`;
  const bodyEnd = bodyStart + body.length;

  // The footer starts at the first footer phrase past the first third of the body.
  let footerStart = bodyEnd;
  const minFooter = Math.min(Math.floor(body.length * 0.3), 1500);
  const footerRe = new RegExp(FOOTER_RE.source, "giu");
  for (const m of body.matchAll(footerRe)) {
    if (m.index! >= minFooter) {
      footerStart = bodyStart + lineAt(body, m.index!).start;
      break;
    }
  }
  const head = `${subject}\n\n${full.slice(bodyStart, footerStart)}${attachments ? `\n\n${attachments}` : ""}`;
  const lang = detectLanguage(`${subject}\n${body}`);
  const currency = currencyContext(full, msg.senderDomain, lang);
  const monthFirst =
    lang === "en" &&
    (currency.usDollar || /(?<![\p{L}])(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}/iu.test(full));
  const refISO = msg.dateISO ?? utcDayISO(now);
  return { msg, now, subject, full, bodyStart, footerStart, bodyEnd, head, lang, currency, monthFirst, refISO };
}

function globalRe(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
}

/** A clause that only supposes the thing: "if you have cancelled…", "如需取消…", "إذا قمت بإلغاء…". */
const CONDITIONAL =
  /(?<![\p{L}])(?:if|unless|si|sauf\s+si|wenn|falls|cuando)(?![\p{L}])[^.!?\n]{0,48}$|(?:如果|如需|如不|若|倘若|假如)[^。！？\n]{0,24}$|(?:إذا|اذا|لو|في\s+حال)[^.!؟\n]{0,48}$/iu;

/** Matches of a kind regex that are not inside an "if you have cancelled…" clause. */
function realHits(re: RegExp, text: string): number {
  let n = 0;
  for (const m of text.matchAll(globalRe(re))) {
    const before = text.slice(Math.max(0, m.index! - 60), m.index!);
    if (CONDITIONAL.test(before)) continue;
    n++;
  }
  return n;
}

const SUBSCRIPTION_CONTEXT =
  /(?<![\p{L}])(?:your\s+(?:subscription|membership|plan|account)|subscription|membership|abonnement|forfait|suscripción|mitgliedschaft|abo)(?![\p{L}])|订阅|会员|套餐|اشتراك/iu;

const PRICE_WORD = /(?<![\p{L}])(?:price|pricing|rate|cost|fee|prix|tarif|mensualité|precio|tarifa|preis|beitrag)(?![\p{L}])|价格|价|资费|费用|السعر|سعر|الرسوم/iu;

function hasPriceTransition(a: Analysis): boolean {
  const money = findMoney(a.full, a.currency)
    .filter((m) => !m.negative && (m.index < a.footerStart || m.index >= a.bodyEnd))
    .slice(0, MAX_MONEY);
  for (let i = 0; i + 1 < money.length; i++) {
    const m1 = money[i]!;
    const m2 = money[i + 1]!;
    if (m1.amount === m2.amount || (m1.currency && m2.currency && m1.currency !== m2.currency)) continue;
    if (!TRANSITION.test(a.full.slice(m1.end, m2.index))) continue;
    const sentence = a.full.slice(Math.max(lineAt(a.full, m1.index).start, m1.index - 120), m1.index);
    const fromWord = /(?<![\p{L}])(?:from|de|von|desde)\s*$|(?:由|从|من)\s*$/iu.test(sentence);
    if ((PRICE_WORD.test(sentence) || fromWord) && SUBSCRIPTION_CONTEXT.test(a.head)) return true;
  }
  return false;
}

export interface KindDecision {
  kind: EmailKind | null;
  completed: boolean;
  upcoming: boolean;
  /** Marketing words around a body-only kind: kept only if the email states its own dates. */
  promotional: boolean;
}

export function classify(a: Analysis): KindDecision {
  const subject = a.subject;
  const head = a.head;
  const completedSubject = COMPLETED_RE.test(subject);
  const none: KindDecision = { kind: null, completed: false, upcoming: false, promotional: false };

  if (NON_BILLING_RE.test(subject) && !completedSubject) return none;

  const subjectKinds = KIND_ORDER.filter((k) => realHits(KIND_RES[k], subject) > 0);
  const headKinds = KIND_ORDER.filter((k) => realHits(KIND_RES[k], head) > 0);
  let kind: RuleKind | "other" | null = subjectKinds[0] ?? headKinds[0] ?? null;
  // A cancellation stated in the body outranks a receipt or renewal subject line.
  if (kind && kind !== "cancellation" && headKinds.includes("cancellation") && subjectKinds.length === 0) kind = "cancellation";
  // "…price will go from €13.49 to €14.99" with no stock phrase is still a price change.
  if (!kind && hasPriceTransition(a)) kind = "price_change";
  if (!kind && OTHER_BILLING_RE.test(head)) kind = "other";
  if (!kind) return none;

  const completedHead = COMPLETED_RE.test(head);
  const upcomingSubject = UPCOMING_RE.test(subject);
  const upcomingHead = UPCOMING_RE.test(head);

  // Shipping notices and newsletters that merely mention money.
  const bodyNonBilling = NON_BILLING_RE.test(head) && subjectKinds.length === 0 && !completedHead;
  if (bodyNonBilling) return none;
  // Promotions: a marketing subject is never a bill; marketing words in the body
  // sink a body-only kind unless the email also names its own dates (checked later).
  if (MARKETING_RE.test(subject) && !completedSubject && kind !== "cancellation" && kind !== "trial_ending") return none;
  const promotional = MARKETING_RE.test(head) && subjectKinds.length === 0 && !completedHead && kind !== "cancellation" && kind !== "trial_ending";
  if (kind === "price_change" && subjectKinds[0] !== "price_change" && !SUBSCRIPTION_CONTEXT.test(head)) return none;

  let completed = false;
  let upcoming = false;
  if (kind === "receipt") {
    completed = !upcomingSubject || completedSubject;
    upcoming = !completed;
  } else if (kind === "renewal" || kind === "other") {
    if (completedSubject) completed = true;
    else if (upcomingSubject) upcoming = true;
    else if (completedHead && !upcomingHead) completed = true;
    else if (upcomingHead) upcoming = true;
    else completed = kind === "renewal";
  }
  return { kind, completed, upcoming, promotional };
}

// ── Amounts ────────────────────────────────────────────────────────────────

const INCLUSIVE =
  /incl(?:\.|uding|uded|usive)?\s*(?:of\s+)?(?:vat|tax(?:es)?|gst)|(?:vat|taxes?|tva|gst)\s+(?:incl(?:\.|uded|use|uses)?|comprises?)|(?<![\p{L}])ttc(?![\p{L}])|toutes\s+taxes\s+comprises|含税|شامل\s+(?:ال)?ضريب[ةه]|inkl\.?\s*mwst|iva\s+incluido/giu;
const NEG_LABEL =
  /sub-?total|sous-?total|(?<![\p{L}])(?:tax(?:es)?|vat|tva|gst|hst|pst|qst|ht|mwst|ust|iva)(?![\p{L}])|sales\s+tax|hors\s+tax|before\s+tax|excl(?:\.|uding)?\s+(?:vat|tax)|discount|remise|réduction|rabais|coupon|promo|(?<![\p{L}])credit|crédit|refund|rembours|saving|économi|(?<![\p{L}])save(?![\p{L}])|balance|solde|deposit|tip|pourboire|shipping|livraison|frais\s+de\s+port|(?<![\p{L}])was(?![\p{L}])|previously|instead\s+of|au\s+lieu\s+de|regular\s+price|normally|(?:old|current|previous)\s+price|(?:prix|tarif)\s+actuel|ancien\s+(?:prix|tarif)|税额|税费|税|优惠|折扣|减免|抵扣|红包|运费|原价|ضريبة|الضريبة|(?<!(?:سيتم|تم|يتم|سوف\s+يتم)\s)خصم|الخصم|descuento|rabatt/iu;
const TOTAL_LABEL =
  /total|amount|montant|(?<![\p{L}])(?:prix|price|tarif)(?![\p{L}])|à\s+payer|net\s+à\s+payer|importe|betrag|gesamt|summe|合计|总计|总额|实付|实付款|金额|应付|费用|价格|المبلغ|المجموع|الإجمالي|المستحق|السعر/iu;
const STRONG_TOTAL = /grand\s+total|order\s+total|total\s+(?:paid|charged|due)|amount\s+(?:paid|charged|due)|ttc|montant\s+(?:total|prélevé|débité|payé|à\s+payer)|net\s+à\s+payer|实付|扣款金额|扣费金额|支付金额|付款金额|المبلغ\s+(?:الإجمالي|المدفوع|المستحق)|الإجمالي/iu;
const CHARGE_VERB =
  /charged|charge\s+you|(?:we['’]ll|we\s+will)\s+charge|will\s+be\s+(?:charged|billed|taken|collected)|billed|renew(?:s|ed|al)?(?:\s+[^.!?\n]{0,40}?)?\s+(?:at|for)\s*$|paid|payment\s+of|prélev|débit|factur|(?<![\p{L}])pay(?![\p{L}])|扣款|扣费|续费|支付|付款|سيتم\s+خصم|تم\s+خصم|تم\s+دفع|خصم|اقتطاع|تجديد/iu;
const MARKETING_LINE =
  /refer|referral|parrain|invite|(?<![\p{L}])earn|gift|cadeau|bonus|gagnez|(?<![\p{L}])win(?![\p{L}])|upgrade|switch\s+to|passez\s+à|(?<![\p{L}])(?:get|obtenez)\s|推荐|邀请|赠送|领取|هدية|offer|offre|(?<![\p{L}])off(?![\p{L}])/iu;
const CADENCE_AFTER =
  /^\s*(?:\/\s*\p{L}|(?:per|a|an|par|al|pro|每|كل|في)\s+\p{L}|(?:monthly|yearly|annually|weekly|mensuel|annuel|mensual|anual|monatlich|jährlich|شهري|سنوي|每月|每年))/iu;

/** Start of the nearest non-blank line above the line holding `index` (or that line's start). */
function prevLineStart(text: string, index: number): number {
  const line = lineAt(text, index);
  let pos = line.start - 1;
  while (pos > 0) {
    const prev = lineAt(text, pos);
    if (prev.line.trim()) return prev.start;
    pos = prev.start - 1;
  }
  return line.start;
}

/**
 * The sentence holding `index` (bounded): a promotion after "renews on 2 Nov for
 * $9.99." must not count against that amount. A "." ends a sentence only when
 * followed by a space, so "9.99" stays whole.
 */
function sentenceAt(text: string, index: number, radius = 160): string {
  const from = Math.max(0, index - radius);
  const to = Math.min(text.length, index + radius);
  let start = from;
  for (let i = index - 1; i >= from; i--) {
    const c = text[i]!;
    if (c === "\n" || "!?。！？".includes(c) || (c === "." && /\s/.test(text[i + 1] ?? ""))) {
      start = i + 1;
      break;
    }
  }
  let end = to;
  for (let i = index; i < to; i++) {
    const c = text[i]!;
    if (c === "\n" || "!?。！？".includes(c) || (c === "." && (i + 1 >= text.length || /\s/.test(text[i + 1]!)))) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

function segmentBefore(text: string, m: MoneyMatch, prevEnd: number): string {
  // Labels sit on the same line, or alone on the line above when the amount starts its line.
  const line = lineAt(text, m.index);
  const startsLine = !text.slice(line.start, m.index).trim();
  const start = Math.max(prevEnd, m.index - 90, startsLine ? prevLineStart(text, m.index) : line.start);
  return text.slice(start, m.index);
}

interface Scored {
  m: MoneyMatch;
  score: number;
  total: boolean;
}

function scoreAmounts(a: Analysis, matches: MoneyMatch[]): Scored[] {
  const out: Scored[] = [];
  let prevEnd = 0;
  for (const m of matches) {
    const segment = segmentBefore(a.full, m, prevEnd);
    prevEnd = m.end;
    const line = sentenceAt(a.full, m.index);
    const after = a.full.slice(m.end, Math.min(a.full.length, m.end + 30));
    const cleaned = segment.replace(INCLUSIVE, " ");
    let score = 0;
    let total = false;
    if (m.index < a.bodyStart) score += 2;
    if (NEG_LABEL.test(cleaned)) score -= 6;
    else if (TOTAL_LABEL.test(cleaned)) {
      score += 5;
      total = true;
      if (STRONG_TOTAL.test(segment)) score += 1;
    }
    if (CHARGE_VERB.test(segment)) score += 3;
    if (CADENCE_AFTER.test(after)) score += 2;
    if (MARKETING_LINE.test(line) && !total) score -= 4;
    if (m.index >= a.footerStart && m.index < a.bodyEnd) score -= 3;
    if (m.bare) score -= 1;
    // The email's own words win a tie with a PDF's.
    if (m.index >= a.bodyEnd) score -= 0.5;
    if (!m.bare && m.currency === null) score -= 0.5;
    out.push({ m, score, total });
  }
  return out;
}

function pickAmount(scored: Scored[]): MoneyMatch | null {
  if (!scored.length) return null;
  const best = Math.max(...scored.map((s) => s.score));
  if (best < 0) return null;
  const top = scored.filter((s) => s.score === best);
  // Several totals: the grand total is the largest of them.
  if (top.every((s) => s.total)) return top.reduce((x, y) => (y.m.amount > x.m.amount ? y : x)).m;
  return top[0]!.m;
}

const TRANSITION =
  /^\s*(?:(?:\/\s*\p{L}+\.?|(?:per|a|an|par|al|pro|every|chaque)\s+\p{L}+|TTC|HT|monthly|par\s+mois|每月|شهريا)\s*,?\s*)?(?:to|à|a|auf|bis|→|->|=>|until\s+now,?\s+now|调整为|调整至|调整到|涨至|涨到|上调至|上调为|上调到|变为|变更为|改为|升至|增至|至|为|إلى|الى)\s*$/iu;
const NEW_PRICE_LABEL =
  /(?:new|updated)\s+(?:monthly\s+|annual\s+|yearly\s+)?(?:price|rate|amount)|nouveaux?\s+(?:prix|tarifs?)|nouvelle\s+(?:mensualité|tarification)|新价格|调整后(?:的)?(?:价格|费用)|السعر\s+الجديد|nuevo\s+precio|neuer\s+preis/iu;
const OLD_PRICE_LABEL =
  /(?:current|old|previous|existing)\s+(?:monthly\s+|annual\s+)?(?:price|rate)|(?:prix|tarif)\s+(?:actuel|précédent)|ancien\s+(?:prix|tarif)|原价(?:格)?|当前价格|现价|السعر\s+(?:الحالي|القديم|السابق)|precio\s+actual|alter\s+preis|(?<![\p{L}])was(?![\p{L}])|au\s+lieu\s+de|instead\s+of/iu;

function pickPriceChange(a: Analysis, matches: MoneyMatch[]): { amount: MoneyMatch | null; previous: MoneyMatch | null } {
  for (let i = 0; i + 1 < matches.length; i++) {
    const m1 = matches[i]!;
    const m2 = matches[i + 1]!;
    if (m1.currency && m2.currency && m1.currency !== m2.currency) continue;
    const between = a.full.slice(m1.end, m2.index);
    if (between.length <= 40 && TRANSITION.test(between) && m1.amount !== m2.amount) return { amount: m2, previous: m1 };
  }
  let amount: MoneyMatch | null = null;
  let previous: MoneyMatch | null = null;
  let prevEnd = 0;
  for (const m of matches) {
    const seg = segmentBefore(a.full, m, prevEnd);
    prevEnd = m.end;
    if (!amount && NEW_PRICE_LABEL.test(seg)) amount = m;
    else if (!previous && OLD_PRICE_LABEL.test(seg)) previous = m;
  }
  if (amount) return { amount, previous: previous && previous.amount !== amount.amount ? previous : null };
  return { amount: null, previous: null };
}

function dominantCurrency(matches: MoneyMatch[]): string | null {
  const counts = new Map<string, number>();
  for (const m of matches) if (m.currency) counts.set(m.currency, (counts.get(m.currency) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

// ── Cadence ────────────────────────────────────────────────────────────────

const CADENCE_PHRASES: [Exclude<FindingCadence, "unknown">, RegExp][] = [
  ["semiannual", /semi-?annual(?:ly)?|half-?year(?:ly)?|every\s+(?:6|six)\s+months|six-?month(?:ly)?|semestriel(?:le)?|tous\s+les\s+(?:6|six)\s+mois|semestral|halbjährlich|每半年|半年(?:卡|度|费|付|会员)?|نصف\s+سنوي/giu],
  ["quarterly", /quarterly|every\s+(?:3|three)\s+months|3-month|trimestriel(?:le)?|par\s+trimestre|tous\s+les\s+(?:3|trois)\s+mois|trimestral|vierteljährlich|quartalsweise|每季度?|季度|包季|连续包季|季卡|ربع\s+سنوي|كل\s+(?:3|ثلاثة)\s+أشهر/giu],
  ["biweekly", /bi-?weekly|every\s+(?:2|two)\s+weeks|fortnight(?:ly)?|toutes\s+les\s+(?:2|deux)\s+semaines|quincenal|zweiwöchentlich|每两周|双周|كل\s+أسبوعين/giu],
  ["weekly", /(?<![\p{L}-])weekly|per\s+week|a\s+week|\/\s*(?:week|wk|semaine|semana|woche|أسبوع)(?![\p{L}])|\/\s*周|every\s+week|hebdomadaire|par\s+semaine|semanal|wöchentlich|每周|周卡|包周|أسبوعي/giu],
  ["yearly", /(?<![\p{L}-])annual(?:ly)?|yearly|per\s+year|a\s+year|\/\s*(?:year|yr|an|année|año|jahr|سنة)(?![\p{L}])|\/\s*年|every\s+year|12[- ]month|annuel(?:le)?|par\s+an(?![\p{L}])|(?<![\p{L}])anual|jährlich|(?<!半)年(?:卡|费|度|付)|包年|连续包年|每年|(?<!ربع\s|نصف\s)سنوي|السنوي|في\s+السنة/giu],
  ["monthly", /monthly|per\s+month|a\s+month|\/\s*(?:month|mo|mth|mois|mes|monat|شهر)(?![\p{L}])|\/\s*月|every\s+(?:month|4\s+weeks|four\s+weeks)|mensuel(?:le)?|mensualité|par\s+mois|chaque\s+mois|toutes\s+les\s+4\s+semaines|mensual|al\s+mes|monatlich|pro\s+monat|每月|月度|包月|连续包月|月卡|月费|按月|شهري|الشهري|في\s+الشهر|كل\s+شهر/giu],
];
const BILLED_EVERY: [Exclude<FindingCadence, "unknown">, RegExp][] = [
  ["monthly", /(?:billed|paid|charged|payable)\s+monthly|(?:facturée?|payée?|prélevée?)\s+(?:mensuellement|chaque\s+mois|tous\s+les\s+mois)|按月(?:扣费|付费|支付)|يدفع\s+شهريا/iu],
  ["yearly", /(?:billed|paid|charged|payable)\s+(?:annually|yearly)|(?:facturée?|payée?|prélevée?)\s+(?:annuellement|chaque\s+année)|按年(?:扣费|付费|支付)|يدفع\s+سنويا/iu],
];

function cadenceFromSpan(dates: DateMatch[], text: string): FindingCadence | null {
  for (let i = 0; i + 1 < dates.length; i++) {
    const d1 = dates[i]!;
    const d2 = dates[i + 1]!;
    const between = text.slice(d1.end, d2.index);
    if (between.length > 12 || !/^\s*(?:[-–—~]|to|au|à|jusqu['’]au|até|bis|至|到|إلى|-)\s*$/iu.test(between)) continue;
    const days = (Date.UTC(+d2.iso.slice(0, 4), +d2.iso.slice(5, 7) - 1, +d2.iso.slice(8, 10)) - Date.UTC(+d1.iso.slice(0, 4), +d1.iso.slice(5, 7) - 1, +d1.iso.slice(8, 10))) / 86_400_000;
    if (days >= 6 && days <= 8) return "weekly";
    if (days >= 13 && days <= 15) return "biweekly";
    if (days >= 27 && days <= 32) return "monthly";
    if (days >= 85 && days <= 95) return "quarterly";
    if (days >= 178 && days <= 186) return "semiannual";
    if (days >= 360 && days <= 370) return "yearly";
  }
  return null;
}

/** A cadence written right beside an amount: "£7.99 a month", "149 DH/mois", "monthly price: $9.99". */
const CADENCE_ADJACENT = CADENCE_PHRASES.map(([cadence, re]) => ({
  cadence,
  after: new RegExp(re.source, "iu"),
  before: new RegExp(`(?:${re.source})\\s*(?:price|fee|charge|plan|subscription|prix|tarif|abonnement|费用?|价格|会员)?\\s*[:：]?\\s*$`, "iu"),
}));

function adjacentCadence(text: string, m: MoneyMatch): FindingCadence | null {
  const after = text.slice(m.end, Math.min(text.length, m.end + 24));
  const before = text.slice(Math.max(0, m.index - 30), m.index);
  for (const c of CADENCE_ADJACENT) {
    const adj = c.after.exec(after);
    if (adj && adj.index <= 4) return c.cadence;
    if (c.before.test(before)) return c.cadence;
  }
  return null;
}

const UPSELL_LINE = /upgrade|switch\s+to|passez\s+à|(?<![\p{L}])save(?![\p{L}])|économisez|special\s+offer|offre\s+spéciale|(?<![\p{L}])off(?![\p{L}])|refer|parrain|升级|推荐|ترقية/iu;

function detectCadence(a: Analysis, amount: MoneyMatch | null, dates: DateMatch[], money: MoneyMatch[]): FindingCadence {
  const text = a.full;
  if (amount) {
    const own = adjacentCadence(text, amount);
    if (own) return own;
    // The same price written elsewhere with its period ("£7.99 a month" … "payment of £7.99").
    for (const m of money) {
      if (m === amount || m.amount !== amount.amount || (m.currency && amount.currency && m.currency !== amount.currency)) continue;
      if (m.index >= a.footerStart && m.index < a.bodyEnd) continue;
      const c = adjacentCadence(text, m);
      if (c) return c;
    }
  }
  for (const [cadence, re] of BILLED_EVERY) if (re.test(a.head)) return cadence;
  const span = cadenceFromSpan(dates, text);
  if (span) return span;

  const hits: { cadence: FindingCadence; index: number }[] = [];
  const headEnd = a.footerStart;
  for (const [cadence, re] of CADENCE_PHRASES) {
    for (const m of text.matchAll(re)) {
      if (m.index! >= headEnd && m.index! < a.bodyEnd) continue;
      if (UPSELL_LINE.test(lineWindow(text, m.index!))) continue;
      hits.push({ cadence, index: m.index! });
    }
  }
  if (!hits.length) return "unknown";
  const inSubject = hits.filter((h) => h.index < a.bodyStart);
  if (inSubject.length) return inSubject.sort((x, y) => x.index - y.index)[0]!.cadence;
  if (amount) {
    hits.sort((x, y) => Math.abs(x.index - amount.index) - Math.abs(y.index - amount.index));
    return hits[0]!.cadence;
  }
  return hits.sort((x, y) => x.index - y.index)[0]!.cadence;
}

// ── Dates ──────────────────────────────────────────────────────────────────

const TRIAL_LABEL =
  /trial[^.\n]{0,40}?(?:ends?|ending|expires?|will\s+end|is\s+over)(?:\s+on)?|end\s+of\s+(?:your\s+|the\s+)?(?:free\s+)?trial|essai[^.\n]{0,40}?(?:se\s+termine|prend\s+fin|expire|s['’]achève|jusqu['’]au)|période\s+d['’]essai[^.\n]{0,30}?|fin\s+de\s+(?:votre\s+|la\s+|l['’])?\s*(?:période\s+d['’]essai|essai)|prueba[^.\n]{0,30}?(?:termina|finaliza|vence)|(?:testzeitraum|testphase|probezeit)[^.\n]{0,20}?(?:endet|bis)|试用(?:期|会员)?.{0,12}?(?:将于|至|到期(?:时间|日)?|截止|结束(?:时间)?|到)?|免费试用.{0,10}?(?:至|到)|体验期至|(?:الفترة|فترة|فترتك)\s+(?:ال)?تجريبية[^.\n]{0,40}?|(?:تنتهي|ستنتهي)[^.\n]{0,40}?/iu;
const NEXT_LABEL =
  /next\s+(?:billing|payment|charge|renewal|bill|invoice)(?:\s+date)?|(?<![\p{L}])(?:renews?|renewal(?:\s+date)?)(?![\p{L}])(?:\s+on)?|will\s+(?:automatically\s+)?(?:renew|be\s+(?:charged|billed|renewed|debited|taken|collected))(?:\s+on)?|auto-?renews?(?:\s+on)?|(?:payment\s+)?due(?:\s+date|\s+on)?|(?:prochain(?:e)?|nouvelle)\s+(?:prélèvement|paiement|renouvellement|facturation|échéance|débit|facture)(?:\s+(?:le|au|prévue?\s+le))?|renouvellement\s+(?:le|au|prévu\s+le|automatique\s+le)|sera\s+(?:automatiquement\s+)?(?:renouvelée?|prélevée?|débitée?|facturée?|reconduite?)(?:\s+automatiquement)?\s+le|prélèvement\s+sera\s+(?:effectué|réalisé)\s+le|date\s+de\s+(?:renouvellement|prélèvement|prochain)|échéance|se\s+renovará\s+el|próximo\s+(?:cobro|pago)|nächste\s+(?:zahlung|abbuchung)|verlängert\s+sich\s+am|下次(?:扣款|扣费|续费|续订|付款)(?:日期|时间|日)?|下一(?:个|次)(?:扣费日|扣款日|续费日)|续费日期|扣费日期|扣款日期|将于|到期(?:时间|日期|日)?|有效期至|会员有效期(?:至)?|التجديد\s+(?:القادم|التالي)|تاريخ\s+التجديد(?:\s+القادم)?|الدفعة\s+(?:القادمة|التالية)|موعد\s+(?:التجديد|الدفع|الاقتطاع)|سيتم\s+(?:تجديد|خصم|اقتطاع)[^.\n]{0,40}?|تاريخ\s+الاستحقاق|صالح\s+حتى/iu;
const CHARGED_LABEL =
  /(?:charged|billed|paid|purchased|renewed|processed)(?:\s+on)?|date\s+of\s+(?:purchase|payment|invoice)|(?:purchase|order|invoice|payment|billing|transaction)\s+date|date\s+paid|(?:^|[\s(])date\s*[:：]?|date\s+de\s+(?:paiement|facturation|commande|facture|la\s+facture|prélèvement|débit|la\s+transaction|l['’]achat|l['’]opération)|(?:a\s+été\s+|été\s+)?(?:payée?|réglée?|facturée?|prélevée?|débitée?|renouvelée?)(?:\s+avec\s+succès)?\s+le|fecha(?:\s+de\s+(?:pago|compra|factura))?|rechnungsdatum|zahlungsdatum|(?:扣款|扣费|支付|付款|交易|下单|订单|续费|开通|购买|账单)(?:时间|日期)|日期|تاريخ\s+(?:الدفع|الفاتورة|المعاملة|الشراء|العملية)|التاريخ/iu;
const EFFECTIVE_LABEL =
  /(?:starting|effective|beginning|from|as\s+of|commencing)(?:\s+on|\s+from)?|à\s+(?:compter|partir)\s+du|dès\s+le|avec\s+effet\s+(?:au|le)|a\s+partir\s+del|ab\s+dem|(?<![\p{L}])ab(?![\p{L}])|自|从|起|اعتبارا\s+من|اعتبارًا\s+من|ابتداء\s+من|بدءا\s+من|ابتداءً\s+من/iu;
const UNTIL_LABEL = /until|through|jusqu['’](?:au|à)|valable\s+jusqu['’]au|hasta|(?<![\p{L}])bis(?![\p{L}])|حتى|لغاية/iu;

type DateRole = "trial" | "next" | "charged" | "effective" | "until" | null;

/** Each label, ending at most 30 non-digit characters before the date; first match wins. */
const NEAR_LABELS: [Exclude<DateRole, null>, RegExp][] = (
  [
    ["trial", TRIAL_LABEL],
    ["effective", EFFECTIVE_LABEL],
    ["until", UNTIL_LABEL],
    ["next", NEXT_LABEL],
    ["charged", CHARGED_LABEL],
  ] as const
).map(([role, re]) => [role, new RegExp(`(?:${re.source})[^\\d\\n]{0,30}$`, "iu")]);

function roleOf(text: string, d: DateMatch, prevEnd: number): DateRole {
  const line = lineAt(text, d.index);
  let before = text.slice(Math.max(line.start, prevEnd, d.index - 80), d.index);
  if (!before.trim() && line.start > 0) {
    // A label on the line above ("Next billing date" / "12 Nov 2026").
    const start = prevLineStart(text, d.index);
    before = text.slice(start, line.start).trim().slice(-80);
  }
  for (const [role, re] of NEAR_LABELS) if (re.test(before)) return role;
  return null;
}

interface DateRoles {
  trial: string | null;
  next: string | null;
  charged: string | null;
  effective: string | null;
  unlabeledFuture: string | null;
}

function assignDates(a: Analysis, dates: DateMatch[]): DateRoles {
  const out: DateRoles = { trial: null, next: null, charged: null, effective: null, unlabeledFuture: null };
  let prevEnd = 0;
  for (const d of dates) {
    if (d.index >= a.footerStart && d.index < a.bodyEnd) {
      prevEnd = d.end;
      continue;
    }
    const role = roleOf(a.full, d, prevEnd);
    prevEnd = d.end;
    if (role === "trial") out.trial ??= d.iso;
    else if (role === "next" && d.iso <= a.refISO) out.charged ??= d.iso;
    else if (role === "next") out.next ??= d.iso;
    else if (role === "charged") out.charged ??= d.iso;
    else if (role === "effective") out.effective ??= d.iso;
    else if (role === null && d.iso > a.refISO) out.unlabeledFuture ??= d.iso;
  }
  return out;
}

// ── Assembly ───────────────────────────────────────────────────────────────

export function validationContext(a: Analysis): ValidationContext {
  return {
    now: a.now,
    subject: a.msg.subject,
    // A forward the parser could not unwrap comes from the user's own mailbox: not merchant evidence.
    senderDomain: isPersonalSender(a.msg.fromAddress, a.msg.senderDomain) ? null : a.msg.senderDomain,
    emailDateISO: a.msg.dateISO,
    currency: a.currency,
    text: a.full,
    monthFirst: a.monthFirst,
  };
}

export function extractByRules(a: Analysis): EmailFinding | null {
  const decision = classify(a);
  const kind = decision.kind;
  if (!kind) return null;

  const money = findMoney(a.full, a.currency)
    .filter((m) => !m.negative)
    .slice(0, MAX_MONEY);
  const scored = scoreAmounts(a, money);
  let chosen: MoneyMatch | null = null;
  let previous: MoneyMatch | null = null;
  if (kind === "price_change") {
    const pc = pickPriceChange(a, money);
    chosen = pc.amount ?? pickAmount(scored);
    previous = pc.previous;
  } else {
    chosen = pickAmount(scored);
  }
  let currency = chosen?.currency ?? null;
  if (chosen && !currency) currency = dominantCurrency(money.filter((m) => m.index < a.footerStart || m.index >= a.bodyEnd));

  const dates = findDates(a.full, { monthFirst: a.monthFirst, refISO: a.refISO, now: a.now }).slice(0, MAX_DATES);
  const roles = assignDates(a, dates);
  // A newsletter that happens to say "auto-renews" has no renewal date of its own.
  if (decision.promotional && !roles.next && !roles.trial && !roles.charged && !roles.effective) return null;
  const cadence = detectCadence(a, chosen, dates, money);

  let chargedISO: string | null = null;
  let nextChargeISO: string | null = null;
  let trialEndsISO: string | null = null;
  switch (kind) {
    case "trial_ending":
      trialEndsISO = roles.trial ?? roles.next ?? roles.unlabeledFuture;
      nextChargeISO = roles.next ?? trialEndsISO;
      break;
    case "price_change":
      nextChargeISO = roles.next ?? roles.effective ?? roles.unlabeledFuture;
      break;
    case "cancellation":
      break;
    case "receipt":
    case "renewal":
    case "other":
      if (decision.completed) {
        chargedISO = roles.charged ?? a.msg.dateISO;
        nextChargeISO = roles.next && (!chargedISO || roles.next > chargedISO) ? roles.next : null;
        if (!nextChargeISO && chargedISO && (kind === "renewal" || cadence !== "unknown")) nextChargeISO = addPeriod(chargedISO, cadence);
      } else if (decision.upcoming) {
        nextChargeISO = roles.next ?? roles.unlabeledFuture ?? roles.effective;
      }
      break;
  }

  const billedVia = detectBilledVia(a.msg, a.full);
  const merchant = findMerchant(a.msg, a.full.slice(a.bodyStart), billedVia);

  const raw: RawFinding = {
    kind,
    merchant,
    billedVia,
    amount: chosen?.amount ?? null,
    currency,
    cadence,
    chargedISO,
    nextChargeISO,
    trialEndsISO,
    previousAmount: previous?.amount ?? null,
  };
  return validateFinding(raw, validationContext(a), "rules");
}

// ── AI fallback ────────────────────────────────────────────────────────────

/** What the AI may see: the sender's domain, the subject and a cut of the text, with addresses, links and long numbers masked. */
export function aiInput(msg: ParsedMessage): { senderDomain: string | null; subject: string; text: string } {
  const mask = (s: string) =>
    s
      .replace(/(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, "[email]")
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi, "[link]")
      .replace(/(?<![\d.,])(?:\d[ -]?){9,}\d(?![\d.,])/g, "[number]");
  // Cut first so masking stays cheap, then cut again to the limit. The first cut may
  // split an address: drop the partial last token so it cannot slip past the mask.
  const joined = [msg.text, ...msg.attachmentsText].filter(Boolean).join("\n\n");
  let body = joined.slice(0, AI_TEXT_LIMIT * 2);
  if (joined.length > body.length) {
    let k = body.length;
    while (k > 0 && !/\s/.test(body[k - 1]!)) k--;
    body = body.slice(0, k);
  }
  return { senderDomain: msg.senderDomain, subject: mask(msg.subject.slice(0, 600)).slice(0, 300), text: mask(body).slice(0, AI_TEXT_LIMIT) };
}

/** The AI's JSON in the shape the validator reads (it may name dates either way). */
function fromAiReply(reply: unknown): RawFinding | null {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const r = reply as Record<string, unknown>;
  if (r.isBilling === false) return null;
  return {
    kind: r.kind,
    merchant: r.merchant,
    billedVia: r.billedVia,
    amount: r.amount,
    currency: r.currency,
    cadence: r.cadence,
    chargedISO: r.chargedISO ?? r.chargedDate,
    nextChargeISO: r.nextChargeISO ?? r.nextChargeDate,
    trialEndsISO: r.trialEndsISO ?? r.trialEndDate,
    previousAmount: r.previousAmount,
  };
}

/** The rules' values stand where they found something; the AI fills only the gaps. */
function merge(rules: EmailFinding | null, ai: EmailFinding, a: Analysis): EmailFinding {
  if (!rules) return ai;
  const pick = <K extends keyof EmailFinding>(k: K): EmailFinding[K] => (rules[k] ?? ai[k]) as EmailFinding[K];
  const raw: RawFinding = {
    kind: rules.kind === "other" && ai.kind !== "other" ? ai.kind : rules.kind,
    merchant: pick("merchant"),
    billedVia: pick("billedVia"),
    amount: pick("amount"),
    currency: rules.amount !== null ? rules.currency : pick("currency"),
    cadence: rules.cadence !== "unknown" ? rules.cadence : ai.cadence,
    chargedISO: pick("chargedISO"),
    nextChargeISO: pick("nextChargeISO"),
    trialEndsISO: pick("trialEndsISO"),
    previousAmount: pick("previousAmount"),
  };
  const merged = validateFinding(raw, validationContext(a), "ai");
  if (!merged) return rules;
  // Credit the AI only if it actually added something.
  const added = (Object.keys(raw) as (keyof RawFinding)[]).some((k) => k !== "kind" && (rules as unknown as Record<string, unknown>)[k] !== (merged as unknown as Record<string, unknown>)[k]) || merged.kind !== rules.kind;
  return added ? merged : rules;
}

export async function extractFinding(msg: ParsedMessage, opts: { ai?: AiExtractor | null; now?: Date } = {}): Promise<EmailFinding | null> {
  const now = opts.now ?? new Date();
  const a = analyze(msg, now);
  const rules = extractByRules(a);
  const ai = opts.ai ?? null;
  if (!ai) return rules;
  if (rules && rules.confidence >= AI_THRESHOLD) return rules;

  // Only for mail that looks like a bill and is not a shipping or security notice.
  const billingLike =
    looksLikeBilling({ from: `${msg.fromName ?? ""} <${msg.fromAddress ?? ""}>`, subject: msg.subject }) ||
    KIND_ORDER.some((k) => KIND_RES[k].test(a.head)) ||
    OTHER_BILLING_RE.test(a.head);
  if (!billingLike || NON_BILLING_RE.test(a.subject) || MARKETING_RE.test(a.subject)) return rules;

  let reply: unknown;
  try {
    reply = await ai.extract(aiInput(msg));
  } catch {
    return rules;
  }
  const candidate = fromAiReply(reply);
  if (!candidate) return rules;
  const fromAi = validateFinding(candidate, validationContext(a), "ai");
  if (!fromAi) return rules;
  const merged = merge(rules, fromAi, a);
  return rules && merged.confidence < rules.confidence ? rules : merged;
}
