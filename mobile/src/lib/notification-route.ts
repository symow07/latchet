/**
 * Where tapping a notification should take you.
 *
 * The backend attaches `{ type, ... }` to every push it sends, and nothing
 * read it — tapping a bill reminder opened the app on whatever screen it was
 * last on, which is the least useful answer available. A reminder that cannot
 * take you to the thing it is reminding you about is just an interruption.
 *
 * Dependency-free so the mapping can be tested; the listener that uses it
 * lives in notification-taps.ts.
 */

export interface NotificationRoute {
  pathname: string;
  params?: Record<string, string>;
}

/**
 * Read the route out of a notification's data payload.
 *
 * The payload comes from the server, so it is treated as untrusted: an
 * unrecognised type returns null rather than being turned into a pathname,
 * which would let whatever sent it choose a screen.
 */
export function routeForNotification(data: unknown): NotificationRoute | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;

  switch (payload.type) {
    case 'bill-reminder':
      // There is no per-bill screen, so the list is the destination. The id is
      // still passed through: the list can highlight it, and a detail screen
      // later needs no change here.
      return typeof payload.billId === 'string' && payload.billId
        ? { pathname: '/bill-reminders', params: { billId: payload.billId } }
        : { pathname: '/bill-reminders' };
    default:
      return null;
  }
}
