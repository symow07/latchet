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
