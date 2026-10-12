/**
 * Text normalisation for extraction (never for what parseMime returns):
 * full-width forms, Arabic presentation forms and Arabic-Indic digits become
 * their plain equivalents, invisible marks go, and links and addresses are
 * removed so their digits cannot pass for amounts or dates.
 */

const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * Traditional characters that appear in billing phrases, mapped to the
 * simplified forms the phrase lists use (Taiwan and Hong Kong mail).
 */
const TRAD_TO_SIMP: Record<string, string> = {
  續: "续", 訂: "订", 費: "费", 帳: "账", 賬: "账", 據: "据", 發: "发", 關: "关", 閉: "闭", 會: "会", 員: "员",
  試: "试", 價: "价", 調: "调", 單: "单", 額: "额", 動: "动", 開: "开", 啟: "启", 優: "优", 終: "终", 結: "结",
  東: "东", 謝: "谢", 購: "购", 買: "买", 證: "证", 碼: "码", 號: "号", 務: "务", 時: "时", 間: "间", 週: "周",
  個: "个", 幣: "币", 臺: "台", 為: "为", 將: "将", 於: "于", 從: "从", 漲: "涨", 變: "变", 現: "现", 舊: "旧",
  實: "实", 總: "总", 計: "计", 應: "应", 繳: "缴", 貨: "货", 簽: "签", 送: "送", 達: "达", 驗: "验", 設: "设",
  號碼: "号码", 圓: "圆", 塊: "块", 款: "款", 視: "视", 頻: "频", 藝: "艺", 樂: "乐", 戶: "户", 賬戶: "账户",
  稅: "税", 運: "运", 惠: "惠", 換: "换", 約: "约", 數: "数", 訊: "讯", 這: "这", 您: "您", 處: "处", 驟: "骤",
};
const TRAD_RE = new RegExp(`[${Object.keys(TRAD_TO_SIMP).filter((k) => k.length === 1).join("")}]`, "gu");

export function normalizeForAnalysis(input: string): string {
  let s = input.replace(/\r\n?/g, "\n").replace(INVISIBLE, "");
  s = s.replace(/[\uff01-\uff5e\uffe0\uffe1\uffe5\u3000\ufb50-\ufdff\ufe70-\ufefc]/g, (ch) => {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x3000) return " ";
    if (cp === 0xffe5) return "¥";
    if (cp === 0xffe0) return "¢";
    if (cp === 0xffe1) return "£";
    if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCodePoint(cp - 0xfee0);
    return ch.normalize("NFKC");
  });
  // Arabic-Indic and Extended Arabic-Indic digits, and the Arabic separators.
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/\u066b/g, ".").replace(/\u066c/g, ",").replace(/\u066a/g, "%");
  s = s.replace(TRAD_RE, (c) => TRAD_TO_SIMP[c] ?? c);
  s = s.replace(/\b(?:https?:\/\/|www\.)[^\s<>"'\])]+/gi, " ");
  // Bounded and anchored to the start of a run, so a long run of letters costs one pass.
  s = s.replace(/(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, " ");
  return s.normalize("NFC");
}

/** The line around `index`, clipped to `radius` characters either side (long lines cost no more than short ones). */
export function lineWindow(text: string, index: number, radius = 160): string {
  const from = Math.max(0, index - radius);
  const to = Math.min(text.length, index + radius);
  const start = text.lastIndexOf("\n", index - 1);
  const end = text.indexOf("\n", index);
  return text.slice(Math.max(from, start + 1), end < 0 || end > to ? to : end);
}

/** Line boundaries of a text, for "same line" context lookups. */
export function lineAt(text: string, index: number): { start: number; end: number; line: string } {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  let end = text.indexOf("\n", index);
  if (end < 0) end = text.length;
  return { start, end, line: text.slice(start, end) };
}

export function hasHan(s: string): boolean {
  return /\p{Script=Han}/u.test(s);
}

export function hasKana(s: string): boolean {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
}

export function hasArabic(s: string): boolean {
  return /\p{Script=Arabic}/u.test(s);
}

const EN_WORDS = /\b(?:the|your|you|has|been|will|with|this|for|and|thank|receipt|subscription|payment|charged|renew|account|membership)\b/gi;
const FR_WORDS = /(?:^|[\s(])(?:le|la|les|votre|vous|nous|est|été|des|du|au|avec|pour|merci|facture|abonnement|montant|prélèvement|à)(?=[\s,.:;!?)]|$)/gim;
const ES_WORDS = /\b(?:el|los|las|su|usted|gracias|suscripción|factura|pago|importe|recibo)\b/gi;
const DE_WORDS = /\b(?:der|die|das|ihr|ihre|ihren|wir|danke|abonnement|rechnung|zahlung|betrag|vielen)\b/gi;

export type Lang = "en" | "fr" | "es" | "de" | "ar" | "zh" | "ja" | "unknown";

/** The main language of a text, by script first and then by common words. */
export function detectLanguage(s: string): Lang {
  const han = (s.match(/\p{Script=Han}/gu) ?? []).length;
  const arabic = (s.match(/\p{Script=Arabic}/gu) ?? []).length;
  const latinWords = (s.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? []).length;
  if (hasKana(s) && han + (s.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length > latinWords) return "ja";
  if (han > 0 && han >= latinWords) return "zh";
  if (arabic > 0 && arabic / 4 >= latinWords * 0.6) return "ar";
  const scores: [Lang, number][] = [
    ["en", (s.match(EN_WORDS) ?? []).length],
    ["fr", (s.match(FR_WORDS) ?? []).length],
    ["es", (s.match(ES_WORDS) ?? []).length],
    ["de", (s.match(DE_WORDS) ?? []).length],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0]![1] === 0) {
    if (han > 0) return "zh";
    if (arabic > 0) return "ar";
    return "unknown";
  }
  return scores[0]![0];
}
