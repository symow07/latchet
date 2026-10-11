/**
 * Handling what someone typed into the streak reminder.
 *
 * The parsing rules live in quick-add.ts and are tested without a device; this
 * is the part that needs expo-notifications and the database.
 *
 * The action is registered with opensAppToForeground: false, so iOS launches
 * this app in the background to deliver the response. That is a real launch —
 * JavaScript runs — which is why this path can write to the database directly,
 * unlike the Siri intent, whose process has no React Native in it at all.
 */
import * as Notifications from 'expo-notifications';
import { addTransaction } from './db';
import { parseQuickAdd } from './quick-add';
import { categoriseNote, loadNoteContext } from './categorise';
import { todayISO } from './dates';
import { QUICK_ADD_ACTION, registerQuickAddCategory } from './notifications';

/** Ids already handled, so a replayed response cannot double-insert. */
const handled = new Set<string>();

/**
 * Write the transaction a notification response describes.
 *
 * Returns true only when a row was actually inserted, so callers can tell
 * "nothing to do" from "done".
 */
export async function handleQuickAddResponse(
  response: Notifications.NotificationResponse,
): Promise<boolean> {
  if (response.actionIdentifier !== QUICK_ADD_ACTION) return false;

  // iOS can hand the same response to a listener and to
  // getLastNotificationResponseAsync on the same launch.
  const id = `${response.notification.request.identifier}:${response.notification.date}`;
  if (handled.has(id)) return false;
  handled.add(id);

  const text = response.userText ?? '';
  const parsed = parseQuickAdd(text);
  if (!parsed) return false;

  const { memory, currency } = await loadNoteContext();
  await addTransaction({
    amount: parsed.amount,
    category: categoriseNote(parsed.note, memory, currency),
    type: parsed.type,
    // Not inferred. detectImpulse reads keywords from a typed description, and
    // four words tapped out on a lock screen are not that.
    isImpulse: false,
    note: parsed.note || undefined,
    // The device's local today. The notification fires in the evening, and a
    // UTC date would file it under tomorrow for anyone east of London.
    dateISO: todayISO(),
  });
  return true;
}

/**
 * Listen for quick-add responses, and pick up the one that launched the app.
 *
 * Both are needed: the listener catches responses while the app is running,
 * and getLastNotificationResponseAsync catches the response that started it,
 * which is delivered before any listener could have been attached.
 */
export function listenForQuickAdd(onInserted: () => void): () => void {
  // Re-registered every launch, not just when the reminder is scheduled. The
  // category has to exist in the process that *receives* the notification, and
  // a reminder scheduled last week is delivered by today's launch.
  void registerQuickAddCategory();

  const run = async (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    try {
      if (await handleQuickAddResponse(response)) onInserted();
    } catch (e) {
      console.warn('[quick-add] failed to log from notification', e);
    }
  };

  Notifications.getLastNotificationResponseAsync().then(run).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) => void run(r));
  return () => sub.remove();
}
