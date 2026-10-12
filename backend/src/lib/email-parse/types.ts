/**
 * The I-PARSE contract (.unlazy/phase6/PLAN.md). Leaf 6.5 stores these fields
 * as an InboxEmail row; the phone turns them into detection evidence.
 */

export type EmailKind = "renewal" | "receipt" | "trial_ending" | "price_change" | "cancellation" | "other";

export type FindingCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "unknown";

export type BilledVia = "apple" | "google_play" | "paypal";

export interface ParsedMessage {
  /** The Message-ID header as sent (angle brackets included), or null. */
  messageId: string | null;
  /** The sender's address. Kept on this object only; a finding never carries it. */
  fromAddress: string | null;
  /** The sender's display name, decoded. */
  fromName: string | null;
  /** Registrable domain of the sender: account.netflix.com → netflix.com. */
  senderDomain: string | null;
  subject: string;
  /** The day the email was sent, YYYY-MM-DD, as dated in the sender's own zone. */
  dateISO: string | null;
  /** Readable body text: the text/plain part when it carries the content, else the HTML as text. */
  text: string;
  /** Text read out of PDF attachments (bounded), one entry per PDF. */
  attachmentsText: string[];
}

export interface EmailFinding {
  kind: EmailKind;
  merchant: string | null;
  senderDomain: string | null;
  billedVia: BilledVia | null;
  amount: number | null;
  /** ISO 4217, or null when the email does not make it evident. */
  currency: string | null;
  cadence: FindingCadence;
  /** Dates are YYYY-MM-DD. */
  chargedISO: string | null;
  emailDateISO: string | null;
  nextChargeISO: string | null;
  trialEndsISO: string | null;
  /** The old price, for a price change. */
  previousAmount: number | null;
  /** 0..1, how much of what this kind of email should carry was found. */
  confidence: number;
  parser: "rules" | "ai";
  /** A short display remnant of the subject, digits stripped, at most 60 characters. */
  label: string;
}

export interface AiExtractor {
  extract(input: { senderDomain: string | null; subject: string; text: string }): Promise<unknown>;
}

export const EMAIL_KINDS: readonly EmailKind[] = ["renewal", "receipt", "trial_ending", "price_change", "cancellation", "other"];

export const CADENCES: readonly FindingCadence[] = ["weekly", "biweekly", "monthly", "quarterly", "semiannual", "yearly", "unknown"];

export const BILLED_VIA: readonly BilledVia[] = ["apple", "google_play", "paypal"];
