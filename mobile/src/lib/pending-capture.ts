/**
 * Transactions captured while the app was not running.
 *
 * A Siri shortcut — "add twenty for coffee to Latchet" — has to record
 * something without launching the app, and it cannot reach expo-sqlite: the
 * intent runs in its own process, and the database lives in the app's
 * container. So the intent appends to a small queue in a shared App Group
 * container, and the app drains it on the next foreground.
 *
 * The user sees the transaction the next time they open the app. That is the
 * right trade for capture: the moment worth catching is standing at the till,
 * and a queue that materialises later beats a note they never write down.
 *
 * Everything the intent writes is treated as untrusted, exactly like the
 * model's output in voice-extract. It is a different process, possibly an
 * older build of it, writing a file this one has to parse.
 *
 * Dependency-free so the parsing and de-duplication can be tested without a
 * simulator or an App Group.
 */

/** One line the Siri intent appended. Shape is deliberately minimal. */
export interface PendingCapture {
  /** Client-generated, so a replayed drain cannot double-insert. */
  id: string;
  amount: number;
  type: 'Expense' | 'Income';
  note: string;
  /** The device's local date when it was spoken. */
  dateISO: string;
  /** Epoch ms, for ordering and for expiring stale entries. */
  at: number;
}

/**
 * How old a queued capture can be before it is dropped rather than inserted.
 *
 * A month-old entry means the app has not been opened since; silently
 * back-dating spending into a period the user has already reviewed does more
 * harm than losing it.
 */
export const MAX_PENDING_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Cap on one drain, so a runaway writer cannot flood the database. */
export const MAX_PENDING = 200;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

/**
 * Parse the queue file.
 *
 * Newline-delimited JSON rather than one array: the intent appends, and
 * appending to a JSON array from a separate process means read-modify-write,
 * which races itself when two shortcuts fire close together. One line per
 * capture is append-only and a torn final line costs one entry, not the file.
 */
export function parsePendingQueue(raw: string): PendingCapture[] {
  const out: PendingCapture[] = [];
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

    const amount = isFiniteNumber(r.amount) ? Math.abs(r.amount) : NaN;
    if (!isFinite(amount) || amount === 0) continue;

    const id = typeof r.id === 'string' && r.id ? r.id : '';
    if (!id) continue;

    const dateISO = typeof r.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)
      ? r.dateISO
      : '';
    if (!dateISO) continue;

    out.push({
      id,
      amount,
      type: r.type === 'Income' ? 'Income' : 'Expense',
      note: typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '',
      dateISO,
      at: isFiniteNumber(r.at) ? r.at : 0,
    });
  }
  return out;
}

/**
 * The captures worth inserting: fresh, unseen, and capped.
 *
 * `alreadySeen` is the set of ids the app has drained before. The queue file
 * is deleted after a successful drain, but a crash between insert and delete
 * would otherwise replay the whole file — which is how a shortcut used once
 * becomes three identical transactions.
 */
export function selectDrainable(
  queue: readonly PendingCapture[],
  alreadySeen: ReadonlySet<string>,
  now: number,
): PendingCapture[] {
  const seenHere = new Set<string>();
  const out: PendingCapture[] = [];
  for (const c of [...queue].sort((a, b) => a.at - b.at)) {
    if (out.length >= MAX_PENDING) break;
    if (alreadySeen.has(c.id) || seenHere.has(c.id)) continue;
    if (c.at > 0 && now - c.at > MAX_PENDING_AGE_MS) continue;
    seenHere.add(c.id);
    out.push(c);
  }
  return out;
}

/** Serialise one capture as the intent would append it. */
export function encodeCapture(capture: PendingCapture): string {
  return JSON.stringify(capture) + '\n';
}
