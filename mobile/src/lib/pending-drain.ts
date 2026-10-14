/**
 * Draining what Siri captured while the app was closed.
 *
 * The native half of pending-capture.ts, which holds the parsing and
 * de-duplication rules and is tested without a simulator. This file is the
 * part that needs the filesystem, AsyncStorage and the database — kept
 * separate for the same reason voice-api.ts is separate from voice-capture.ts.
 *
 * The queue is written by plugins/ios/LatchetAppIntents.swift, running in a
 * background launch of this app where React Native is not up. It lands in the
 * app's own Documents directory — the same container expo-file-system reads,
 * which is why no App Group is involved.
 */
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activeUserId, addTransaction } from './db';
import { parsePendingQueue, selectDrainable } from './pending-capture';
import { categoriseNote, loadNoteContext } from './categorise';

/** Must match PendingCaptureQueue.fileName in the Swift. */
const QUEUE_FILE = 'pending-captures.ndjson';
/**
 * Device key (storage-keys.ts): the queue is a file on the phone, written
 * without knowing who is signed in, so what has been drained from it is the
 * phone's record, not an account's.
 */
const SEEN_KEY = 'pending_capture_seen_v1';

/**
 * How many drained ids to remember. Only needs to outlive the window where a
 * crash could replay a file, so a few hundred is generous.
 */
const SEEN_CAP = 500;

function queueUri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? dir + QUEUE_FILE : null;
}

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    // A corrupt list means we might double-insert rather than skip. Treating it
    // as empty is the wrong side of that trade, but it is also the only side
    // available — and the alternative, refusing to drain, loses the captures.
    return new Set();
  }
}

async function writeSeen(seen: Set<string>): Promise<void> {
  const kept = [...seen].slice(-SEEN_CAP);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(kept));
}

/**
 * Insert everything Siri queued into `ownerUserId`'s ledger, and return how
 * many landed.
 *
 * The owner is the user whose database is active when the drain starts; the
 * root layout only runs it once that database is ready, and sign-out runs it
 * once more before the flush, so captures spoken before signing out land in
 * the ledger of the user who spoke them. If the active user changes while it
 * runs, it stops: a capture is lost rather than booked to someone else.
 *
 * Ids are marked seen *before* the insert, not after. A crash in between
 * therefore loses a capture rather than inserting it twice, and that is the
 * right way round: a duplicate transaction quietly corrupts a balance the user
 * has no reason to re-check, whereas a missing one is no worse than never
 * having spoken it, and they are standing there to notice.
 */
export async function drainPendingCaptures(ownerUserId: string): Promise<number> {
  const stillOwner = () => activeUserId() === ownerUserId;
  const uri = queueUri();
  if (!uri || !stillOwner()) return 0;

  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return 0;

  let raw = '';
  try {
    raw = await FileSystem.readAsStringAsync(uri);
  } catch {
    // Unreadable: delete it rather than retrying on every foreground forever.
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    return 0;
  }

  const seen = await readSeen();
  const captures = selectDrainable(parsePendingQueue(raw), seen, Date.now());
  if (!stillOwner()) return 0;

  // Delete before inserting. The ids are in `seen` either way, so a re-parse
  // would find nothing; leaving the file behind only risks it growing.
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  if (captures.length === 0) return 0;

  // Siri never asks for a category — that would turn a two-second capture into
  // a menu. The note decides, via the same ladder the importer uses, so
  // "coffee at Blue Bottle" lands where this user's own past coffees did, and
  // "Marjane" lands in Food for someone whose currency is the dirham.
  const { memory, currency } = await loadNoteContext();

  for (const capture of captures) seen.add(capture.id);
  await writeSeen(seen);

  let inserted = 0;
  for (const capture of captures) {
    if (!stillOwner()) break;
    try {
      await addTransaction({
        amount: capture.amount,
        category: categoriseNote(capture.note, memory, currency),
        type: capture.type,
        // Not inferred. detectImpulse reads keywords from a typed description,
        // and a Siri phrase is not that — guessing would skew the one metric
        // the dashboard reports about self-control.
        isImpulse: false,
        note: capture.note || undefined,
        dateISO: capture.dateISO,
      });
      inserted += 1;
    } catch {
      // One bad row should not stop the rest of the queue landing.
    }
  }
  return inserted;
}
