/**
 * Raw MIME → ParsedMessage.
 *
 * mailparser does the MIME work. It was chosen over postal-mime after testing
 * both under Bun: postal-mime decodes through the runtime's TextDecoder, and
 * Bun's has no windows-1256 or ISO-8859-15, so Moroccan Arabic and euro-sign
 * Latin-9 mail came out as mojibake; mailparser decodes every charset with
 * iconv-lite (and ISO-2022-JP with encoding-japanese), the same on any runtime.
 * It also handles quoted-printable, base64, RFC 2047 words (display names too),
 * format=flowed and nested multiparts. Its own HTML-to-text and link options
 * are switched off; html-text.ts does that conversion.
 *
 * Forwarded mail (the user's "Fwd:" from their own mailbox) is unwrapped to the
 * original sender, subject and date, so the merchant is Netflix and not the
 * user's Gmail address.
 */

import { getDomain } from "tldts";
import iconv from "iconv-lite";
import { simpleParser, type ParsedMail } from "mailparser";
import { htmlToText } from "./html-text";
import { isPdfAttachment, pdfText, PDF_MAX_FILES } from "./pdf";
import { dayFromDateHeader, findDates, utcDayISO } from "./dates";
import { isPersonalSender } from "./merchant";
import type { ParsedMessage } from "./types";

/** Larger messages are cut: Gmail's own limit is 25 MB of attachments. */
export const MAX_RAW_BYTES = 30 * 1024 * 1024;

const PARSER_OPTIONS = {
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipTextLinks: true,
  skipImageLinks: true,
  keepCidLinks: false,
} as const;

function toBuffer(raw: Uint8Array | string): Buffer {
  if (typeof raw === "string") {
    // A string of byte values (binary/latin1) keeps its bytes; real text is UTF-8.
    // eslint-disable-next-line no-control-regex
    const binary = !/[^\u0000-\u00ff]/.test(raw);
    const buf = Buffer.from(raw, binary ? "latin1" : "utf8");
    return buf.byteLength > MAX_RAW_BYTES ? buf.subarray(0, MAX_RAW_BYTES) : buf;
  }
  const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  return buf.byteLength > MAX_RAW_BYTES ? buf.subarray(0, MAX_RAW_BYTES) : buf;
}

function decodeBytes(bytes: Buffer, charset: string | null): string {
  const cs = (charset ?? "").trim().replace(/^"|"$/g, "");
  if (cs && !/^(?:utf-?8|us-ascii|ascii)$/i.test(cs) && iconv.encodingExists(cs)) {
    try {
      return iconv.decode(bytes, cs);
    } catch {
      /* fall through */
    }
  }
  const utf8 = bytes.toString("utf8");
  return utf8.includes("\ufffd") ? iconv.decode(bytes, "windows-1252") : utf8;
}

/** RFC 2047 encoded words, for header values read from raw bytes. */
export function decodeEncodedWords(s: string): string {
  return s
    .replace(/(\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, (_whole, cs: string, enc: string, data: string) => {
      const charset = cs.replace(/\*.*$/, "");
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(data, "base64")
          : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return decodeBytes(bytes, charset);
    });
}

/** The raw bytes of a top-level header, unfolded; null when absent. */
function rawHeader(buf: Buffer, name: string): Buffer | null {
  let end = buf.indexOf("\r\n\r\n");
  if (end < 0) end = buf.indexOf("\n\n");
  const head = buf.subarray(0, end < 0 ? Math.min(buf.length, 64 * 1024) : end);
  const latin = head.toString("latin1");
  const m = new RegExp(`(?:^|\\n)${name}:[ \\t]*((?:[^\\r\\n]|\\r?\\n[ \\t])*)`, "i").exec(latin);
  if (!m) return null;
  return Buffer.from(m[1]!.replace(/\r?\n[ \t]+/g, " "), "latin1");
}

/** The first charset any part declares: the best guess for undeclared 8-bit headers. */
function firstDeclaredCharset(buf: Buffer): string | null {
  const m = /charset\s*=\s*"?([A-Za-z0-9_.:-]+)/i.exec(buf.subarray(0, 256 * 1024).toString("latin1"));
  return m?.[1] ?? null;
}

/**
 * mailparser reads raw 8-bit header bytes as UTF-8. Legacy Chinese or Arabic
 * mail sometimes sends the subject that way in the body's charset; re-read it.
 */
function repairHeader(decoded: string, buf: Buffer, name: string): string {
  if (!decoded.includes("\ufffd")) return decoded;
  const raw = rawHeader(buf, name);
  if (!raw) return decoded;
  const fixed = decodeEncodedWords(decodeBytes(raw, firstDeclaredCharset(buf)));
  return fixed.includes("\ufffd") ? decoded : fixed;
}

function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .normalize("NFC");
}

function contentWeight(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** The text/plain part when it carries the content; otherwise the HTML as text. */
export function chooseBody(plain: string, htmlText: string): string {
  if (!plain.trim()) return htmlText;
  if (!htmlText.trim()) return plain;
  if (/\d/.test(htmlText) && !/\d/.test(plain)) return htmlText;
  return contentWeight(plain) >= contentWeight(htmlText) * 0.5 ? plain : htmlText;
}

export function registrableDomain(address: string | null): string | null {
  if (!address) return null;
  const host = address.split("@").pop()?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (!host || !host.includes(".")) return null;
  return getDomain(host) ?? null;
}

const FORWARD_SUBJECT = /^\s*(?:\[?(?:fwd?|fw|tr|wg|rv|enc|doorst|vs|vb|转发|轉寄|転送|إعادة توجيه|توجيه)\]?\s*[:：]\s*)+/i;
const FORWARD_MARKER =
  /^[ \t>]*(?:-{2,}\s*(?:forwarded message|original message|message transféré|message d['’]origine|message original|mensaje reenviado|mensaje original|weitergeleitete nachricht|ursprüngliche nachricht|messaggio inoltrato|转发的邮件|原始邮件|邮件原文|الرسالة المعاد توجيهها|رسالة معاد توجيهها|الرسالة الأصلية)\s*-{2,}|begin forwarded message\s*:|début du message réexpédié\s*:|inizio messaggio inoltrato\s*:|anfang der weitergeleiteten nachricht\s*:|_{10,})[ \t]*$/im;
const FWD_HEADER =
  /^[ \t>*]*(from|de|von|da|发件人|寄件者|من|subject|objet|sujet|betreff|asunto|oggetto|主题|主旨|الموضوع|date|sent|envoyé|gesendet|enviado|fecha|datum|data|日期|发送时间|时间|التاريخ|تاريخ الإرسال|to|à|a|an|para|收件人|إلى|cc|reply-to)[ \t]*\*?[ \t]*[:：][ \t]*\*?[ \t]*(.*)$/i;

interface Forwarded {
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  dateValue: string | null;
  body: string;
}

function parseAddress(value: string): { name: string | null; address: string | null } {
  const address = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/.exec(value)?.[0]?.toLowerCase() ?? null;
  let name = value
    .replace(/<[^>]*>|\[mailto:[^\]]*\]|\(mailto:[^)]*\)/gi, " ")
    .replace(/(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, " ")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) name = "";
  return { name: name || null, address };
}

/** The original message inside a manual forward, or null. */
export function unwrapForward(subject: string, text: string): Forwarded | null {
  const lines = text.split("\n");
  let start = -1;
  const marker = FORWARD_MARKER.exec(text);
  if (marker) {
    start = text.slice(0, marker.index + marker[0].length).split("\n").length;
  } else if (FORWARD_SUBJECT.test(subject)) {
    const idx = lines.findIndex((l, i) => i < 60 && /^(?:from|de|von|发件人|من)$/i.test((FWD_HEADER.exec(l)?.[1] ?? "").trim()));
    if (idx >= 0) start = idx;
  }
  if (start < 0) return null;

  const fields: Record<string, string> = {};
  let i = start;
  let seen = 0;
  while (i < lines.length && i < start + 20) {
    const line = lines[i]!;
    if (!line.trim()) {
      if (seen > 0) break;
      i++;
      continue;
    }
    const m = FWD_HEADER.exec(line);
    if (!m) {
      if (seen > 0) break;
      i++;
      continue;
    }
    const key = m[1]!.toLowerCase();
    const role = /^(?:from|de|von|da|发件人|寄件者|من)$/.test(key)
      ? "from"
      : /^(?:subject|objet|sujet|betreff|asunto|oggetto|主题|主旨|الموضوع)$/.test(key)
        ? "subject"
        : /^(?:date|sent|envoyé|gesendet|enviado|fecha|datum|data|日期|发送时间|时间|التاريخ|تاريخ الإرسال)$/.test(key)
          ? "date"
          : "other";
    if (role !== "other" && !(role in fields)) fields[role] = m[2]!.trim();
    seen++;
    i++;
  }
  if (!fields.from) return null;
  const from = parseAddress(fields.from);
  if (!from.address && !from.name) return null;
  const body = lines
    .slice(i)
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
  return { fromName: from.name, fromAddress: from.address, subject: fields.subject ?? null, dateValue: fields.date ?? null, body };
}

function dayFromLooseDate(value: string | null, refISO: string, now: Date): string | null {
  if (!value) return null;
  const header = dayFromDateHeader(value);
  if (header) return header;
  const found = findDates(value, { monthFirst: /\b(?:am|pm)\b/i.test(value), refISO, now });
  return found[0]?.iso ?? null;
}

async function attachmentTexts(mail: ParsedMail): Promise<string[]> {
  const out: string[] = [];
  const pdfs = mail.attachments.filter((a) => isPdfAttachment(a.contentType, a.filename, a.content)).slice(0, PDF_MAX_FILES);
  for (const a of pdfs) {
    const text = await pdfText(a.content);
    if (text) out.push(text);
  }
  return out;
}

async function fromMail(mail: ParsedMail, buf: Buffer, depth: number): Promise<ParsedMessage> {
  const sender = mail.from?.value.find((v) => v.address) ?? mail.from?.value[0]?.group?.find((v) => v.address) ?? null;
  const fromAddress = sender?.address?.trim().toLowerCase() || null;
  let fromName: string | null = repairHeader(sender?.name ?? "", buf, "from").trim() || null;
  if (fromName && fromAddress && fromName.toLowerCase() === fromAddress) fromName = null;
  const subject = repairHeader(mail.subject ?? "", buf, "subject").replace(/\s+/g, " ").trim().normalize("NFC");
  const dateLine = mail.headerLines.find((h) => h.key === "date")?.line.replace(/^date:\s*/i, "") ?? null;
  const dateISO = dayFromDateHeader(dateLine) ?? (mail.date && !Number.isNaN(mail.date.getTime()) ? utcDayISO(mail.date) : null);

  const plain = cleanText(mail.text ?? "");
  const htmlText = typeof mail.html === "string" ? cleanText(htmlToText(mail.html)) : "";
  const text = chooseBody(plain, htmlText);
  const attachmentsText = await attachmentTexts(mail);

  const msg: ParsedMessage = {
    messageId: mail.messageId?.trim() || null,
    fromAddress,
    fromName: fromName ? fromName.normalize("NFC") : null,
    senderDomain: registrableDomain(fromAddress),
    subject,
    dateISO,
    text,
    attachmentsText,
  };

  // A forward sent from the user's own mailbox: read the original inside it.
  const personal = !fromAddress || isPersonalSender(fromAddress, msg.senderDomain);
  const looksForwarded = FORWARD_SUBJECT.test(subject);
  if (personal || looksForwarded) {
    const attached = depth < 2 ? mail.attachments.find((a) => /^message\/rfc822$/i.test(a.contentType)) : undefined;
    if (attached && (looksForwarded || !text.trim())) {
      const inner = await parseMimeBuffer(attached.content, depth + 1);
      return {
        ...inner,
        messageId: msg.messageId,
        dateISO: inner.dateISO ?? msg.dateISO,
        attachmentsText: [...inner.attachmentsText, ...attachmentsText],
      };
    }
    const fwd = unwrapForward(subject, text);
    if (fwd && (fwd.fromAddress || fwd.fromName)) {
      const ref = msg.dateISO ?? utcDayISO(new Date());
      return {
        ...msg,
        fromAddress: fwd.fromAddress,
        fromName: fwd.fromName,
        senderDomain: registrableDomain(fwd.fromAddress),
        subject: (fwd.subject ?? subject.replace(FORWARD_SUBJECT, "")).replace(/\s+/g, " ").trim(),
        dateISO: dayFromLooseDate(fwd.dateValue, ref, new Date(`${ref}T12:00:00Z`)) ?? msg.dateISO,
        text: fwd.body || text,
      };
    }
  }
  return msg;
}

/** Last resort when mailparser rejects the input: headers by hand, the body as text. */
function fallbackParse(buf: Buffer): ParsedMessage {
  const value = (name: string) => {
    const raw = rawHeader(buf, name);
    return raw ? decodeEncodedWords(decodeBytes(raw, null)).trim() : "";
  };
  const fromValue = value("from");
  const from = parseAddress(fromValue);
  let sep = buf.indexOf("\r\n\r\n");
  let skip = 4;
  if (sep < 0) {
    sep = buf.indexOf("\n\n");
    skip = 2;
  }
  const body = sep < 0 ? "" : decodeBytes(buf.subarray(sep + skip), firstDeclaredCharset(buf));
  return {
    messageId: value("message-id") || null,
    fromAddress: from.address,
    fromName: from.name,
    senderDomain: registrableDomain(from.address),
    subject: value("subject").replace(/\s+/g, " ").normalize("NFC"),
    dateISO: dayFromDateHeader(value("date")),
    text: cleanText(/<\/?(?:html|body|div|p|table|br)\b/i.test(body) ? htmlToText(body) : body),
    attachmentsText: [],
  };
}

async function parseMimeBuffer(buf: Buffer, depth: number): Promise<ParsedMessage> {
  let mail: ParsedMail;
  try {
    mail = await simpleParser(buf, PARSER_OPTIONS);
  } catch {
    return fallbackParse(buf);
  }
  return fromMail(mail, buf, depth);
}

export async function parseMime(raw: Uint8Array | string): Promise<ParsedMessage> {
  return parseMimeBuffer(toBuffer(raw), 0);
}
