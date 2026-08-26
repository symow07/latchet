/**
 * Things shared into Budget from other apps.
 *
 * The share extension captures and queues; it does not interpret. Working out
 * that "your payment of $45.20" is an expense is done here, by the parser the
 * notification quick-add already uses, because a second implementation in
 * Swift could never be tested and would drift.
 *
 * Everything the extension writes is untrusted — a different process, possibly
 * an older build of it, writing a file this one has to parse.
 *
 * Dependency-free so the parsing and routing decisions can be tested without a
 * simulator or an App Group.
 */
import { MAX_PENDING, MAX_PENDING_AGE_MS } from './pending-capture';
import { parseQuickAdd, type QuickAdd } from './quick-add';

/** One line the share extension appended. */
export interface SharedItem {
  /** Client-generated, so a replayed drain cannot double-insert. */
  id: string;
  kind: 'text' | 'image';
  /** The shared text, or the caption typed alongside an image. */
  text: string;
  /** File name inside the App Group's shared-media directory. Images only. */
  file?: string;
  at: number;
}

export function parseSharedQueue(raw: string): SharedItem[] {
  const out: SharedItem[] = [];
  for (const line of String(raw ?? '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A half-written final line from a process that was killed mid-append.
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const r = parsed as Record<string, unknown>;

    const id = typeof r.id === 'string' && r.id ? r.id : '';
    if (!id) continue;

    const kind = r.kind === 'image' ? 'image' : 'text';
    const file = typeof r.file === 'string' && r.file ? r.file : undefined;

    // An image line with no file is a capture whose write failed. There is
    // nothing to show and nothing to analyse, so it is not a share.
    if (kind === 'image' && !file) continue;

    // A path separator means the name is trying to escape the media directory.
    if (file && (file.includes('/') || file.includes('..'))) continue;

    out.push({
      id,
      kind,
      text: typeof r.text === 'string' ? r.text.trim().slice(0, 2000) : '',
      ...(file ? { file } : {}),
      at: typeof r.at === 'number' && isFinite(r.at) ? r.at : 0,
    });
  }
  return out;
}

/** Fresh, unseen and capped — the same rules the Siri queue drains under. */
export function selectDrainableShares(
  queue: readonly SharedItem[],
  alreadySeen: ReadonlySet<string>,
  now: number,
): SharedItem[] {
  const seenHere = new Set<string>();
  const out: SharedItem[] = [];
  for (const item of [...queue].sort((a, b) => a.at - b.at)) {
    if (out.length >= MAX_PENDING) break;
    if (alreadySeen.has(item.id) || seenHere.has(item.id)) continue;
    if (item.at > 0 && now - item.at > MAX_PENDING_AGE_MS) continue;
    seenHere.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * What the app should do with a drained queue.
 *
 * Text becomes a transaction outright — it has an amount in it or it does not.
 * An image cannot: reading a receipt needs the vision model and then a review,
 * so it is handed to the receipt screen rather than written silently.
 */
export interface SharePlan {
  /** Text shares that parsed into something worth writing. */
  transactions: QuickAdd[];
  /** The image to open the receipt reader on, if one was shared. */
  receipt: SharedItem | null;
  /** Ids to mark seen — everything drained, including what produced nothing. */
  seen: string[];
}

export function planShares(items: readonly SharedItem[]): SharePlan {
  const transactions: QuickAdd[] = [];
  let receipt: SharedItem | null = null;

  for (const item of items) {
    if (item.kind === 'image') {
      // The extension accepts one image per share. If several arrive anyway —
      // an older build, or two shares before the app was opened — the newest
      // wins, because that is the one the user just sent.
      if (!receipt || item.at > receipt.at) receipt = item;
      continue;
    }
    const parsed = parseQuickAdd(item.text);
    if (parsed) transactions.push(parsed);
  }

  // Everything drained is marked seen, including text that parsed to nothing.
  // Retrying it on the next launch would re-fail identically and the file has
  // already been deleted.
  return { transactions, receipt, seen: items.map((i) => i.id) };
}
