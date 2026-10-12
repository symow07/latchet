/**
 * Forwarding, the backup for mailboxes with no API we use (iCloud, Yahoo,
 * GMX, …): the user forwards billing mail to a private address,
 * u_<token>@INBOUND_EMAIL_DOMAIN; a Cloudflare Email Worker
 * (docs/inbound-email-worker.js) posts the raw message to /inbound, and it is
 * read here by the same MIME parser and extractor as Gmail and Outlook mail.
 *
 * Gmail's "confirm this forwarding address" message is recognised and its
 * code kept for a day (retention), so the app can show it to the user.
 */

import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { hitWindow } from "../distributed/counter";
import { dbNow, type Db } from "../distributed/clock";
import { extractFinding, parseMime, type AiExtractor, type ParsedMessage } from "../email-parse";
import { subjectLabel } from "../email-parse/label";
import { extractConfirmationCode, isGmailForwardConfirm, parseInboundToken } from "../inbound-email";
import { findingRow, messageKeyFor, storeFindings } from "./findings";

/** Messages one forwarding address accepts per day; past it, mail is acknowledged and dropped. */
export const FORWARDED_DAILY_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export type InboundOutcome =
  | "stored"
  | "duplicate"
  | "not_billing"
  | "confirmation"
  | "unknown_recipient"
  | "over_limit";

export interface InboundDeps {
  db?: Db;
  /** The AI fallback for this user's mail (capped), or null. */
  aiFor?: (userId: string) => AiExtractor | null;
}

/** What identifies a forwarded message across a retried delivery. */
function forwardedKey(msg: ParsedMessage | null, raw: Uint8Array): string {
  const id = msg?.messageId?.trim();
  return messageKeyFor("forwarding", id || `sha256:${createHash("sha256").update(raw).digest("hex")}`);
}

export async function receiveForwarded(to: string, raw: Uint8Array, deps: InboundDeps = {}): Promise<InboundOutcome> {
  const db = deps.db ?? prisma;
  const token = parseInboundToken(to);
  if (!token) return "unknown_recipient";
  const conn = await db.emailConnection.findUnique({
    where: { inboundToken: token },
    select: { id: true, userId: true, forwardingVerified: true },
  });
  if (!conn) return "unknown_recipient";

  // A mail-bomb to one address must not become unbounded parsing (or AI) work.
  if (!(await hitWindow(`inbound:${conn.id}`, FORWARDED_DAILY_LIMIT, DAY_MS, db)).allowed) return "over_limit";

  let msg: ParsedMessage | null = null;
  try {
    msg = await parseMime(raw);
  } catch {
    msg = null;
  }
  const messageKey = forwardedKey(msg, raw);
  const receivedAt = await dbNow(db);

  if (msg && isGmailForwardConfirm(msg.fromAddress ?? "", msg.subject)) {
    const code = extractConfirmationCode(msg.subject, msg.text);
    await db.inboxEmail.createMany({
      data: [{
        userId: conn.userId,
        connectionId: conn.id,
        source: "forwarding",
        messageKey,
        kind: "other",
        senderDomain: msg.senderDomain,
        label: subjectLabel(msg.subject),
        // The code the user types back into Gmail; kept 24 hours.
        merchant: code,
        status: "confirmation",
        receivedAt,
      }],
      skipDuplicates: true,
    });
    return "confirmation";
  }

  const finding = msg ? await extractFinding(msg, { ai: deps.aiFor?.(conn.userId) ?? null }).catch(() => null) : null;
  const row = findingRow(finding, { userId: conn.userId, connectionId: conn.id, source: "forwarding", messageKey, receivedAt });
  const inserted = row ? await storeFindings([row], db) : 0;

  // Mail arriving at all proves the forwarding works.
  await db.emailConnection.update({
    where: { id: conn.id },
    data: {
      forwardingVerified: true,
      lastSyncedAt: receivedAt,
      messagesScanned: { increment: 1 },
      findingsCount: { increment: inserted },
    },
    select: { id: true },
  });
  return !row ? "not_billing" : inserted ? "stored" : "duplicate";
}

/** The newest Gmail confirmation code that arrived at this forwarding address, if any is still kept. */
export async function latestConfirmationCode(connectionId: string, db: Db = prisma): Promise<string | null> {
  const row = await db.inboxEmail.findFirst({
    where: { connectionId, status: "confirmation", merchant: { not: null } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { merchant: true },
  });
  return row?.merchant ?? null;
}
