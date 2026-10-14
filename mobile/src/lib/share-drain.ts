/**
 * Draining what was shared into Latchet from other apps.
 *
 * The decision logic lives in pending-share.ts and is tested without a device;
 * this is the part that needs the App Group, the filesystem and the database.
 *
 * The share extension writes into the App Group container, which is the only
 * directory it and the app can both reach. Its path contains a system-assigned
 * UUID, so it has to be asked for — see modules/app-group.
 */
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activeUserId, addTransaction } from './db';
import { appGroupPath } from '../../modules/app-group';
import { parseSharedQueue, selectDrainableShares, planShares } from './pending-share';
import { categoriseNote, loadNoteContext } from './categorise';
import { todayISO } from './dates';

/** Must match the constants in plugins/ios/ShareExtension/ShareViewController.swift. */
const QUEUE_FILE = 'pending-shares.ndjson';
const MEDIA_DIR = 'shared-media';

/** Device key (storage-keys.ts), for the same reason as the Siri queue's. */
const SEEN_KEY = 'pending_share_seen_v1';
const SEEN_CAP = 500;

/** Where a shared receipt is copied to so the rest of the app can read it. */
const INBOX_DIR = 'shared-receipts';

export interface ShareDrainResult {
  /** Transactions written from shared text. */
  inserted: number;
  /** A receipt to open the reader on, already copied into the app's own space. */
  receiptUri: string | null;
}

const EMPTY: ShareDrainResult = { inserted: 0, receiptUri: null };

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Move one shared image out of the App Group and into the app's own storage.
 *
 * Copied rather than read in place: the App Group is shared with a process that
 * can delete or overwrite it at any moment, and the receipt screen may not read
 * it until the user has looked at the review.
 */
async function importReceipt(containerPath: string, fileName: string): Promise<string | null> {
  const from = `file://${containerPath}/${MEDIA_DIR}/${fileName}`;
  const inbox = `${FileSystem.documentDirectory}${INBOX_DIR}/`;
  const to = `${inbox}${fileName}`;
  try {
    await FileSystem.makeDirectoryAsync(inbox, { intermediates: true }).catch(() => {});
    await FileSystem.copyAsync({ from, to });
    return to;
  } catch {
    return null;
  } finally {
    await FileSystem.deleteAsync(from, { idempotent: true }).catch(() => {});
  }
}

/**
 * Consume the shared queue into `ownerUserId`'s ledger.
 *
 * As with the Siri queue, ids are marked seen before anything is written, so a
 * crash mid-drain loses a share rather than duplicating one — and the drain
 * stops if the active user changes under it, rather than write into the
 * ledger of whoever is signed in now.
 */
export async function drainSharedItems(ownerUserId: string): Promise<ShareDrainResult> {
  const stillOwner = () => activeUserId() === ownerUserId;
  const container = appGroupPath();
  if (!container || !stillOwner()) return EMPTY;

  const queueUri = `file://${container}/${QUEUE_FILE}`;
  const info = await FileSystem.getInfoAsync(queueUri).catch(() => null);
  if (!info?.exists) return EMPTY;

  let raw = '';
  try {
    raw = await FileSystem.readAsStringAsync(queueUri);
  } catch {
    await FileSystem.deleteAsync(queueUri, { idempotent: true }).catch(() => {});
    return EMPTY;
  }

  const seen = await readSeen();
  const items = selectDrainableShares(parseSharedQueue(raw), seen, Date.now());
  if (!stillOwner()) return EMPTY;

  // Delete before writing. The ids go into `seen` either way, so a re-parse
  // would find nothing; leaving the file behind only risks it growing.
  await FileSystem.deleteAsync(queueUri, { idempotent: true }).catch(() => {});
  if (items.length === 0) return EMPTY;

  const plan = planShares(items);
  for (const id of plan.seen) seen.add(id);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_CAP)));

  const { memory, currency } =
    plan.transactions.length > 0 ? await loadNoteContext() : { memory: null, currency: null };
  let inserted = 0;
  for (const tx of plan.transactions) {
    if (!stillOwner()) break;
    try {
      await addTransaction({
        amount: tx.amount,
        category: categoriseNote(tx.note, memory, currency),
        type: tx.type,
        // Not inferred. detectImpulse reads keywords from a typed description,
        // and a forwarded payment confirmation is not that.
        isImpulse: false,
        note: tx.note || undefined,
        // The device's local today: the share happened now, wherever the user is.
        dateISO: todayISO(),
      });
      inserted += 1;
    } catch {
      // One bad row should not stop the rest of the queue landing.
    }
  }

  const receiptUri = plan.receipt?.file
    ? await importReceipt(container, plan.receipt.file)
    : null;

  return { inserted, receiptUri };
}
