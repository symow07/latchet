/**
 * Who is billing: "Netflix", not "info@account.netflix.com". The sender's
 * display name usually says it; Apple, Google Play and PayPal receipts name
 * the app or business they bill for in the body; Alipay and WeChat Pay
 * deduction notices put it behind a label.
 */

import type { BilledVia, ParsedMessage } from "./types";

/** Consumer mailbox domains: a sender here is a person, not a merchant. */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr", "hotmail.co.uk", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "gmx.de", "gmx.fr", "web.de", "laposte.net", "126.com", "yeah.net",
  "sina.com", "sina.cn", "foxmail.com", "menara.ma", "zoho.com", "mail.com", "fastmail.com",
]);
/** Domains that host both people's mailboxes and the company's own notices. */
const MIXED_DOMAINS = new Set(["qq.com", "163.com", "orange.fr", "free.fr", "sfr.fr", "wanadoo.fr", "bbox.fr", "neuf.fr"]);
const SERVICE_LOCAL = /^(?:no-?reply|ne-?pas-?repondre|donotreply|do-not-reply|notifications?|notify|service|services|info|news|billing|factur|invoice|receipt|payment|account|support|contact|mail|email|vip|member|admin|system|alert|message|newsletter|offres?|client)/i;

/** Brands whose domain label is not their name. */
const KNOWN_DOMAINS: Record<string, string> = {
  "iam.ma": "Maroc Telecom", "inwi.ma": "inwi", "orange.ma": "Orange Maroc", "free.fr": "Free", "free-mobile.fr": "Free Mobile",
  "nytimes.com": "The New York Times", "primevideo.com": "Prime Video", "163.com": "NetEase", "126.com": "NetEase",
  "qq.com": "Tencent", "iqiyi.com": "iQIYI", "mgtv.com": "Mango TV", "jd.com": "JD", "bilibili.com": "bilibili",
  "disneyplus.com": "Disney+", "canalplus.com": "Canal+", "canal-plus.com": "Canal+", "basic-fit.com": "Basic-Fit",
  "openai.com": "OpenAI", "youtube.com": "YouTube", "hbomax.com": "HBO Max", "max.com": "Max", "sfr.fr": "SFR",
  "shahid.net": "Shahid", "mbc.net": "Shahid", "deezer.com": "Deezer", "spotify.com": "Spotify", "netflix.com": "Netflix",
  "alipay.com": "Alipay", "tenpay.com": "WeChat Pay", "wechat.com": "WeChat",
};

/** Payment processors and receipt services that send on a merchant's behalf. */
const PROCESSOR_DOMAINS = new Set([
  "stripe.com", "paddle.com", "paddle.net", "fastspring.com", "squareup.com", "square.com", "chargebee.com", "recurly.com",
  "zuora.com", "gumroad.com", "lemonsqueezy.com", "toasttab.com", "clover.com", "sumup.com", "zettle.com", "braintreegateway.com",
]);

const GENERIC_NAME =
  /^(?:no-?reply|noreply|ne pas répondre|do not reply|notifications?|notification service|info|billing|support|service|services|customer (?:service|care|support)|team|accounts?|payments?|receipts?|invoices?|members?|membership|subscriptions?|news|newsletter|alerts?|mail|e-?mail|admin|service clients?|facturation|abonnements?|客服|通知|服务号|系统通知|会员中心|خدمة العملاء|الإشعارات)$/i;

const TRAILING_NOISE =
  /[\s,:|–—-]+(?:billing team|account team|customer (?:service|care|support)|support team|team|support|billing|payments?|receipts?|invoices?|notifications?|no-?reply|noreply|accounts?|members(?:hip)?|subscriptions?|service clients?|service abonnés?|facturation|abonnements?|news|newsletter|info|alerts?|help ?desk|客服|通知|团队|服务)$/i;
const LEADING_NOISE = /^(?:l['’]équipe|l['’]equipe|équipe|equipe|team|le service client(?: de)?|service client(?: de)?)\s+/i;
const LEGAL_SUFFIX =
  /[\s,]+(?:inc\.?|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|gmbh|ag|ab|s\.?a\.?s?\.?|sarl|s\.l\.|b\.v\.|bv|plc|pty\.?\s*ltd\.?|co\.?,?\s*ltd\.?|se|nv|n\.v\.|k\.k\.|s\.p\.a\.)$/i;
const CN_COMPANY = /(?:[(（][^)）]{1,8}[)）])?(?:科技|网络|信息技术|文化传媒|数字|在线)?(?:股份)?有限(?:责任)?公司$/u;

export function isPersonalDomain(domain: string | null): boolean {
  return !!domain && PERSONAL_DOMAINS.has(domain);
}

/** True when the From address is a person's mailbox rather than a company's sender. */
export function isPersonalSender(address: string | null, domain: string | null): boolean {
  if (!domain) return false;
  if (PERSONAL_DOMAINS.has(domain)) return true;
  if (MIXED_DOMAINS.has(domain)) {
    const local = (address ?? "").split("@")[0] ?? "";
    return !SERVICE_LOCAL.test(local);
  }
  return false;
}

/** A display name or label value cleaned into a merchant name, or null. */
export function cleanMerchantName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.normalize("NFC").replace(/[\s\u00a0]+/g, " ").trim();
  s = s.replace(/^["'“”‘’«»<\[(【「《]+|["'“”‘’«»>\])】」》]+$/g, "").trim();
  if (!s || s.includes("@") || /^https?:/i.test(s)) return null;
  const via = /^(.+?)\s+(?:via|par l'intermédiaire de|through)\s+/i.exec(s);
  if (via) s = via[1]!;
  let removed = false;
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(TRAILING_NOISE, "").replace(LEGAL_SUFFIX, "").replace(LEADING_NOISE, "").trim();
    if (s !== before) removed = true;
    else break;
  }
  if (removed) s = s.replace(/^the\s+/i, "");
  s = s.replace(CN_COMPANY, "").trim();
  // "Amazon.co.uk", "Netflix.com"
  const domainish = /^([\p{L}\d][\p{L}\d&+' -]*?)\.(?:com?|co\.uk|com\.cn|fr|de|es|it|ma|cn|net|org|io|tv|app|us|ca|uk)$/iu.exec(s);
  if (domainish) s = domainish[1]!;
  s = s.replace(/^[\s,:;|–—-]+|[\s,:;|–—-]+$/g, "").trim();
  if (!s || s.length > 60 || !/\p{L}/u.test(s) || GENERIC_NAME.test(s)) return null;
  return s;
}

export function nameFromDomain(domain: string | null): string | null {
  if (!domain) return null;
  if (KNOWN_DOMAINS[domain]) return KNOWN_DOMAINS[domain]!;
  const label = domain.split(".")[0] ?? "";
  if (!/[a-z]/i.test(label)) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function detectBilledVia(msg: ParsedMessage, text: string): BilledVia | null {
  const d = msg.senderDomain ?? "";
  const from = `${msg.fromName ?? ""} ${msg.fromAddress ?? ""}`;
  if ((d === "apple.com" || d === "itunes.com") && /app store|apple|itunes/i.test(`${from} ${msg.subject} ${text.slice(0, 2000)}`)) return "apple";
  if (d === "google.com" && /google\s*play/i.test(`${from} ${msg.subject} ${text.slice(0, 2000)}`)) return "google_play";
  if (/^paypal\./.test(d)) return "paypal";
  return null;
}

const NAME_LINE_REJECT =
  /^(?:receipt|reçu|recibo|quittung|收据|إيصال|invoice|facture|billed to|facturé à|order id|order number|n° de commande|numéro de commande|document|date|apple account|apple id|identifiant apple|compte apple|total|subtotal|sous-total|tax|vat|tva|payment|paiement|renews?|se renouvelle|renouvellement|report a problem|signaler un problème|app store|apple services|services apple|privacy|item|price|prix|article|élément|google play|thank you|merci|your account|votre compte|order date|date de commande|auto-renewing subscription|abonnement à renouvellement automatique)\b/i;

function isNameLine(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > 60 || !/\p{L}/u.test(l)) return false;
  if (/[:：]\s*$/.test(l) || /\d{2,}/.test(l) || /[$€£¥]/.test(l)) return false;
  return !NAME_LINE_REJECT.test(l);
}

const PLAN_WORDS =
  /\s*[(（]?(?:monthly|annual|yearly|weekly|month|year|1 month|1 year|12 months|mensuel(?:le)?|annuel(?:le)?|mois|an|月度|年度|包月|包年|شهري|سنوي)[)）]?\s*$/i;

function fromApple(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const labelled = /^(?:App|Application|Appli|应用|应用程序|التطبيق)\s*[:：]\s*(.+)$/im.exec(text) ?? /^(?:Subscription|Abonnement|订阅|الاشتراك)\s*[:：]\s*(.+)$/im.exec(text);
  if (labelled) return cleanMerchantName(labelled[1]!.replace(PLAN_WORDS, ""));
  const section = lines.findIndex((l) => /^(?:App Store|Apple Arcade|Apple Services|Services Apple|Servicios de Apple|Apple-Dienste|Apple 服务|خدمات Apple)$/i.test(l));
  if (section >= 0) {
    for (let i = section + 1; i < Math.min(lines.length, section + 6); i++) {
      if (isNameLine(lines[i]!)) return cleanMerchantName(lines[i]!.replace(PLAN_WORDS, ""));
    }
  }
  const renews = lines.findIndex((l) => /^(?:renews|se renouvelle|renouvellement le|se renueva|verlängert sich|续订|将于.*续订|يتجدد)/i.test(l));
  if (renews > 0) {
    const names: string[] = [];
    for (let i = renews - 1; i >= Math.max(0, renews - 4) && names.length < 2; i--) {
      if (isNameLine(lines[i]!)) names.push(lines[i]!);
      else if (names.length) break;
    }
    const pick = names.length === 2 ? names[1]! : names[0];
    if (pick) return cleanMerchantName(pick.replace(PLAN_WORDS, ""));
  }
  return null;
}

function stripDeveloper(name: string): string {
  return name.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
}

function fromGooglePlay(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const header = lines.findIndex((l) => /^(?:item\s+price|article\s+prix|élément\s+prix|商品\s+价格|العنصر\s+السعر|artículo\s+precio|artikel\s+preis)$/i.test(l));
  if (header >= 0 && lines[header + 1]) {
    const name = lines[header + 1]!.replace(/\s*(?:[$€£¥]|[A-Z]{3}\s?\d|\d)[\s\S]*$/, "");
    const cleaned = cleanMerchantName(stripDeveloper(name));
    if (cleaned) return cleaned;
  }
  const sub = /(?:subscription\s+to|subscribed\s+to|abonnement\s+(?:à|au)|abonné\s+à|订阅了)\s+([^\n.]+?)(?:\s+(?:on|from|sur|depuis)\s+Google\s+Play|[.\n]|$)/i.exec(text);
  if (sub) return cleanMerchantName(stripDeveloper(sub[1]!));
  for (const l of lines) {
    const m = /^([^\d$€£¥\n]{2,60}?)\s+(?:[$€£¥]|[A-Z]{2,3}\$?\s?)?\d[\d.,]*\s*(?:[$€£¥]|[A-Z]{3})?\s*\/\s*(?:month|mo|year|yr|week|mois|an|semaine|月|年)/i.exec(l);
    if (m && !/^(?:total|tax|subtotal|tva|vat|sous-total)\b/i.test(m[1]!)) return cleanMerchantName(stripDeveloper(m[1]!));
  }
  return null;
}

function fromPayPal(text: string): string | null {
  const patterns = [
    /(?:automatic\s+payment|payment|you\s+paid|you\s+sent)\s+(?:of\s+[^\n]{1,30}?\s+)?to\s+([^\n]+?)(?:\s+(?:for|on|has|was|using|with)\b|[.,!]|$)/im,
    /paiement(?:\s+automatique)?(?:\s+de\s+[^\n]{1,30}?)?\s+à\s+([^\n]+?)(?:\s+(?:pour|le|a\s+été|avec)\b|[.,!]|$)/im,
    /^(?:merchant|marchand|vendeur|seller|payee|bénéficiaire|destinataire|商家|收款方|التاجر|البائع)\s*[:：]?\s+([^\n]+)$/im,
    /^(?:merchant|marchand|vendeur|seller|payee|bénéficiaire|商家|收款方|التاجر)\s*[:：]?\s*\n\s*([^\n]+)$/im,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const name = cleanMerchantName(m[1]!.replace(/\s*(?:[$€£¥]|\b[A-Z]{3}\b)[\s\d.,]*$/, ""));
      if (name) return name;
    }
  }
  return null;
}

const CN_SERVICE_SUFFIX = /(?:VIP)?(?:会员)?(?:自动续费|连续包月|连续包年|连续包季|自动扣款|免密支付|月卡|年卡|季卡|服务|订阅|VIP|会员)$/u;

function fromChineseLabels(text: string): string | null {
  const m = /(?:商户名称|商户全称|商家名称|收款方|收款商户|扣款服务|扣费服务|扣款项目|扣费项目|服务名称|商品名称|商品说明|商户)\s*[:：]?\s*([^\n]{1,40})/u.exec(text);
  if (!m) return null;
  let name = m[1]!.trim().split(/\s{2,}|\s(?=[\p{Script=Han}]{2,}[:：])/u)[0]!.trim();
  for (let i = 0; i < 3; i++) name = name.replace(CN_SERVICE_SUFFIX, "").trim();
  return cleanMerchantName(name);
}

const PROCESSOR_SUBJECT = /(?:receipt|invoice|payment)\s+(?:from|to)\s+(.+?)(?:\s+#|\s+\[|\s*$)|(?:reçu|facture|paiement)\s+(?:de|à)\s+(.+?)(?:\s+n°|\s+#|\s*$)/i;

export function findMerchant(msg: ParsedMessage, text: string, billedVia: BilledVia | null): string | null {
  if (billedVia === "apple") return fromApple(text);
  if (billedVia === "google_play") return fromGooglePlay(text);
  if (billedVia === "paypal") return fromPayPal(text) ?? fromPayPal(msg.subject);
  const domain = msg.senderDomain;
  if (domain === "alipay.com" || domain === "tenpay.com" || /支付宝|微信支付/.test(msg.fromName ?? "")) {
    return fromChineseLabels(text) ?? cleanMerchantName(msg.fromName) ?? nameFromDomain(domain);
  }
  if (isPersonalSender(msg.fromAddress, domain)) return null;
  const display = cleanMerchantName(msg.fromName);
  if (domain && PROCESSOR_DOMAINS.has(domain)) {
    if (display && !/^(?:stripe|paddle|square|fastspring|chargebee|recurly|gumroad)$/i.test(display)) return display;
    const s = PROCESSOR_SUBJECT.exec(msg.subject);
    return s ? cleanMerchantName(s[1] ?? s[2]) : null;
  }
  return display ?? nameFromDomain(domain);
}
