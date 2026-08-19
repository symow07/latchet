/**
 * Pure helpers for routing/classifying inbound forwarded emails
 * (POST /api/email/inbound). Kept free of prisma/auth imports so the
 * routing rules are unit-testable.
 */

/** Extract the per-user routing token from a recipient like
 *  "u_ab12cd34@in.example.com" (also handles "Name <u_x@d>" forms). */
export function parseInboundToken(to: string): string | null {
  return to.match(/u_([a-z0-9]+)@/i)?.[1]?.toLowerCase() ?? null;
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
 * Reduce an email subject to a short, non-identifying label.
 *
 * The privacy policy promises that only merchant, amount, currency, cycle and
 * date are kept. Storing the raw subject broke that promise in practice:
 * receipt subjects routinely carry order numbers, invoice references, account
 * fragments and the amount itself ("Your receipt for order #114-2937461 —
 * $84.32"), and they were kept indefinitely.
 *
 * The inbox screen still needs *something* to show for an email the parser
 * could not identify — that is the whole point of surfacing it — so instead of
 * dropping the subject entirely, keep a version with every number stripped.
 */
export function sanitizeSubjectLabel(subject: string, maxLength = 60): string {
  const cleaned = (subject ?? "")
    // Order numbers, invoice refs and anything else digit-bearing.
    .replace(/[#№]?\b[\w-]*\d[\w-]*\b/g, " ")
    // Currency amounts that survived the digit strip (e.g. a bare symbol).
    .replace(/[$£€¥₹]\s*/g, " ")
    // Collapse the gaps left behind, and trim orphaned punctuation.
    .replace(/\s+/g, " ")
    .replace(/(^[\s\-–—:,.|]+)|([\s\-–—:,.|]+$)/g, "")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  // Cut on a word boundary so the label never ends mid-word.
  const cut = cleaned.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * The sender's domain, which identifies the merchant far better than a subject
 * line and carries none of the personal detail. "billing@netflix.com" and
 * "Netflix <no-reply@netflix.com>" both yield "netflix.com".
 */
export function senderDomain(from: string): string | null {
  const address = (from ?? "").match(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/);
  return address?.[1]?.toLowerCase() ?? null;
}
