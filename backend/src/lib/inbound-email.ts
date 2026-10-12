/**
 * Pure helpers for routing/classifying inbound forwarded emails
 * (POST /api/email/inbound). Kept free of prisma/auth imports so the
 * routing rules are unit-testable. Reading the message itself is the MIME
 * parser's job (lib/email-parse), the same for forwarded, Gmail and Outlook
 * mail; lib/email-providers/forwarding.ts stores what it finds.
 */

/** Extract the per-user routing token from a recipient like
 *  "u_ab12cd34@in.example.com" (also handles "Name <u_x@d>" forms). */
export function parseInboundToken(to: string): string | null {
  return to.match(/(?:^|[\s<"'])u_([a-z0-9]+)@/i)?.[1]?.toLowerCase() ?? null;
}

/** Gmail's add-forwarding-address confirmation email. */
export function isGmailForwardConfirm(from: string, subject: string): boolean {
  return /forwarding-noreply@google\.com/i.test(from) || /forwarding confirmation/i.test(subject);
}

/** Pull the numeric confirmation code out of a Gmail confirmation email. */
export function extractConfirmationCode(subject: string, text: string): string | null {
  return `${subject} ${text}`.match(/\b(\d{6,12})\b/)?.[1] ?? null;
}

/**
 * The message bytes from the worker's base64 (standard or URL-safe). Null
 * when it is not base64 or empty: a payload that cannot be a message.
 */
export function decodeBase64Message(b64: string): Uint8Array | null {
  const clean = (b64 ?? "").replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) return null;
  const buf = Buffer.from(clean.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf.byteLength ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : null;
}

/** A header value safe to place on one line: no line breaks, non-ASCII as an RFC 2047 word. */
function headerValue(v: string): string {
  const oneLine = (v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 998);
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]*$/.test(oneLine) ? oneLine : `=?UTF-8?B?${Buffer.from(oneLine, "utf8").toString("base64")}?=`;
}

/** A From header: an encoded display name, but the <address> left readable. */
function fromValue(v: string): string {
  const oneLine = (v ?? "").replace(/[\r\n]+/g, " ").trim();
  const m = /^(.*?)\s*(<[^<>\s]+>)$/.exec(oneLine);
  if (!m) return headerValue(oneLine);
  const name = m[1]!.replace(/^"|"$/g, "").trim();
  return name ? `${headerValue(name)} ${m[2]}` : m[2]!;
}

/**
 * A message rebuilt from the fields a worker deployed before the raw-message
 * format sent ({ from, subject, text }), so mail still in flight from one is
 * read rather than lost. The new worker sends the raw message instead.
 */
export function legacyPayloadToMime(p: { from?: string; subject?: string; text?: string }): Uint8Array {
  const mime =
    `From: ${fromValue(p.from ?? "")}\r\n` +
    `Subject: ${headerValue(p.subject ?? "")}\r\n` +
    "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" +
    (p.text ?? "");
  return new TextEncoder().encode(mime);
}
