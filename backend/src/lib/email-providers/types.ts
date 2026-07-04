/**
 * Provider-agnostic email access for the subscription scanner. Gmail is the
 * only implementation today; Outlook/IMAP can implement the same interface
 * later without touching the route or the OpenAI extraction step.
 */

export interface RawEmail {
  id: string;
  from: string;
  subject: string;
  date: string; // RFC 2822 / ISO-ish string from the Date header
  snippet: string; // short plain-text preview (Gmail provides ~200 chars)
}

export interface EmailProvider {
  /**
   * Fetch a bounded set of receipt/billing-looking emails from the inbox.
   * `refreshToken` is the decrypted OAuth refresh token for the connection.
   */
  listSubscriptionMessages(refreshToken: string, limit?: number): Promise<RawEmail[]>;
}
