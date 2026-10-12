/**
 * Email parsing (I-PARSE, .unlazy/phase6/PLAN.md): MIME in, a validated
 * billing finding out. Pure — no routes, no database. Leaf 6.5 calls it for
 * Gmail, Outlook and forwarded mail.
 */

export type { EmailKind, FindingCadence, ParsedMessage, EmailFinding, AiExtractor } from "./types";
export { parseMime } from "./mime";
export { looksLikeBilling, BILLING_TERMS } from "./terms";
export { extractFinding } from "./extract";
export { openAiExtractor } from "./ai";
