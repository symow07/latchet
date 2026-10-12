/**
 * Email findings (InboxEmail rows): what a billing email reduces to, how it
 * is stored once per message, and the API's view of it.
 *
 * Stored: the extracted fields only. Not the body, not the subject, not the
 * sender's address; the sender's registrable domain names the merchant. The
 * subject remnant (`label`, digits stripped) is kept only when the parser
 * found no merchant, so the app has something to show. Provider message ids
 * are never stored in clear: `messageKey` is sha256(provider:id), which
 * de-duplicates a re-read without saying which message it was.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { dbNow, type Db } from "../distributed/clock";
import type { EmailFinding } from "../email-parse";

export const STORED_KINDS = ["renewal", "receipt", "trial_ending", "price_change", "cancellation"] as const;
export type StoredKind = (typeof STORED_KINDS)[number];
export type FindingSource = "gmail" | "outlook" | "forwarding";

/** Only billing kinds become findings; `other` (and no finding at all) is dropped. */
export function isStoredKind(kind: string | null | undefined): kind is StoredKind {
  return (STORED_KINDS as readonly string[]).includes(kind ?? "");
}

export function messageKeyFor(source: FindingSource, messageId: string): string {
  return createHash("sha256").update(`${source}:${messageId}`).digest("hex");
}

/** The row for a finding, or null when it is not a billing kind. */
export function findingRow(
  f: EmailFinding | null,
  ctx: { userId: string; connectionId: string | null; source: FindingSource; messageKey: string; receivedAt: Date }
): Prisma.InboxEmailCreateManyInput | null {
  if (!f || !isStoredKind(f.kind)) return null;
  const merchant = f.merchant?.trim() || null;
  return {
    userId: ctx.userId,
    connectionId: ctx.connectionId,
    source: ctx.source,
    messageKey: ctx.messageKey,
    kind: f.kind,
    merchant,
    senderDomain: f.senderDomain,
    label: merchant ? "" : (f.label ?? "").slice(0, 60),
    billedVia: f.billedVia,
    amount: f.amount,
    currency: f.currency,
    cadence: f.cadence,
    chargedISO: f.chargedISO,
    emailDateISO: f.emailDateISO,
    nextChargeISO: f.nextChargeISO,
    trialEndsISO: f.trialEndsISO,
    previousAmount: f.previousAmount,
    confidence: f.confidence,
    parser: f.parser,
    // The pre-phase-6 flag, kept meaningful for anything still reading it.
    isSubscription: f.kind !== "receipt",
    status: "parsed",
    receivedAt: ctx.receivedAt,
  };
}

/** Insert findings, skipping any message this user already has. Returns how many were new. */
export async function storeFindings(rows: Prisma.InboxEmailCreateManyInput[], db: Db = prisma): Promise<number> {
  if (rows.length === 0) return 0;
  const { count } = await db.inboxEmail.createMany({ data: rows, skipDuplicates: true });
  return count;
}

/** Which of `keys` this user already has a finding for. */
export async function knownMessageKeys(userId: string, keys: string[], db: Db = prisma): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.inboxEmail.findMany({
    where: { userId, messageKey: { in: keys } },
    select: { messageKey: true },
  });
  return new Set(rows.map((r) => r.messageKey!).filter(Boolean));
}

// ── The API's view ───────────────────────────────────────────────────────────

export interface EmailFindingDTO {
  id: string;
  connectionId: string | null;
  source: FindingSource;
  kind: StoredKind;
  merchant: string | null;
  senderDomain: string | null;
  billedVia: "apple" | "google_play" | "paypal" | null;
  amount: number | null;
  currency: string | null;
  cadence: string;
  chargedISO: string | null;
  emailDateISO: string | null;
  nextChargeISO: string | null;
  trialEndsISO: string | null;
  previousAmount: number | null;
  confidence: number;
  receivedAt: string;
}

const DTO_SELECT = {
  id: true, connectionId: true, source: true, kind: true, merchant: true, senderDomain: true, billedVia: true,
  amount: true, currency: true, cadence: true, chargedISO: true, emailDateISO: true, nextChargeISO: true,
  trialEndsISO: true, previousAmount: true, confidence: true, receivedAt: true,
} as const;

type DtoRow = Prisma.InboxEmailGetPayload<{ select: typeof DTO_SELECT }>;

export function toFindingDTO(r: DtoRow): EmailFindingDTO {
  return {
    id: r.id,
    connectionId: r.connectionId,
    source: r.source as FindingSource,
    kind: r.kind as StoredKind,
    merchant: r.merchant,
    senderDomain: r.senderDomain,
    billedVia: (r.billedVia as EmailFindingDTO["billedVia"]) ?? null,
    amount: r.amount,
    currency: r.currency,
    cadence: r.cadence,
    chargedISO: r.chargedISO,
    emailDateISO: r.emailDateISO,
    nextChargeISO: r.nextChargeISO,
    trialEndsISO: r.trialEndsISO,
    previousAmount: r.previousAmount,
    confidence: r.confidence,
    receivedAt: r.receivedAt.toISOString(),
  };
}

/** The cursor's overlap: a finding committed a little late is still picked up. */
export const FINDINGS_OVERLAP_MS = 10 * 60_000;
export const FINDINGS_PAGE_MAX = 1000;

export interface FindingsPage {
  findings: EmailFindingDTO[];
  /** The next call's `after`. */
  serverTime: string;
  more: boolean;
}

/**
 * Findings received after `after` minus the overlap, oldest first, at most
 * FINDINGS_PAGE_MAX. `serverTime` is the database's clock, read before the
 * query, so anything stored after it is in the next page.
 *
 * When there is more, `serverTime` is instead the cursor that resumes right
 * after this page (its last receivedAt plus the overlap, which the next call
 * subtracts again): a backfill stores hundreds of findings within minutes,
 * and resuming from the real time minus ten minutes would return the same
 * page forever. The page ends on a receivedAt boundary, so findings stored in
 * one statement (which share it) are never split across pages.
 */
export async function findingsPage(userId: string, after: Date | null, db: Db = prisma): Promise<FindingsPage> {
  const now = await dbNow(db);
  const where: Prisma.InboxEmailWhereInput = {
    userId,
    kind: { in: [...STORED_KINDS] },
    status: { not: "confirmation" },
    ...(after ? { receivedAt: { gt: new Date(after.getTime() - FINDINGS_OVERLAP_MS) } } : {}),
  };
  const rows = await db.inboxEmail.findMany({
    where,
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: FINDINGS_PAGE_MAX + 1,
    select: DTO_SELECT,
  });
  if (rows.length <= FINDINGS_PAGE_MAX) {
    return { findings: rows.map(toFindingDTO), serverTime: now.toISOString(), more: false };
  }
  let page = rows.slice(0, FINDINGS_PAGE_MAX);
  const boundary = rows[FINDINGS_PAGE_MAX]!.receivedAt.getTime();
  const cut = page.findIndex((r) => r.receivedAt.getTime() === boundary);
  // Keep the page whole when every row shares one instant (never in practice:
  // findings are stored a page of messages at a time).
  if (cut > 0) page = page.slice(0, cut);
  const last = page[page.length - 1]!.receivedAt.getTime();
  return {
    findings: page.map(toFindingDTO),
    serverTime: new Date(last + FINDINGS_OVERLAP_MS).toISOString(),
    more: true,
  };
}
