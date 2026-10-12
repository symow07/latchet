/**
 * Where tapping a notification should take you.
 *
 * The backend attaches `{ type, ... }` to every push it sends, and nothing
 * read it — tapping a bill reminder opened the app on whatever screen it was
 * last on, which is the least useful answer available. A reminder that cannot
 * take you to the thing it is reminding you about is just an interruption.
 *
 * The phone's own subscription reminders (subscription-reminders.ts) carry
 * `{ type: 'subscription', subscriptionId, subscriptionIds, uid }`: a tap, or
 * either of their answers — "Keep it", "Did I forget?" — opens the
 * subscription (the list, for several found at once), and "Keep it" keeps it
 * first (subscriptionResponse).
 *
 * Dependency-free so the mapping can be tested; the listener that uses it
 * lives in notification-taps.ts.
 */

export interface NotificationRoute {
  pathname: string;
  params?: Record<string, string>;
}

/**
 * The subscription notifications' category and its two actions (registered
 * by notifications.ts, worded in i18n/notification-copy.ts). iOS matches a
 * delivered notification to its buttons by these, so they never change.
 */
export const SUBSCRIPTION_CATEGORY = 'subscription-reminder';
export const SUBSCRIPTION_KEEP_ACTION = 'subs-keep';
export const SUBSCRIPTION_FORGOT_ACTION = 'subs-forgot';

/** expo-notifications' identifier for a tap on the notification itself. */
export const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/** Our own subscription ids (`sub_netflix`, `subemail_x_2`): nothing that could be a path. */
const SUBSCRIPTION_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

function subscriptionIdsOf(payload: Record<string, unknown>): string[] {
  const list = Array.isArray(payload.subscriptionIds) ? payload.subscriptionIds : [payload.subscriptionId];
  const ids = list.filter((v): v is string => typeof v === 'string' && SUBSCRIPTION_ID.test(v));
  return [...new Set(ids)];
}

/** One subscription opens on its own screen; a batch of finds on the list. */
function subscriptionRoute(ids: readonly string[]): NotificationRoute | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return { pathname: '/subscription-detail', params: { id: ids[0]! } };
  return { pathname: '/subscriptions' };
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
    case 'subscription':
      return subscriptionRoute(subscriptionIdsOf(payload));
    default:
      return null;
  }
}

/** Whether a payload is one of the phone's subscription notifications. */
export function isSubscriptionNotification(data: unknown): boolean {
  return !!data && typeof data === 'object' && !Array.isArray(data) && (data as Record<string, unknown>).type === 'subscription';
}

/** What answering a subscription notification does: where it goes, and what it keeps. */
export interface SubscriptionResponse {
  route: NotificationRoute;
  /** "Keep it": record the keep decision for these before showing them. */
  keep: string[];
}

/**
 * A response to a subscription notification — a tap, "Keep it" or "Did I
 * forget?" — or null when it is not one, or not this user's.
 *
 * Every answer opens the subscription (the list, for a batch of finds); "Keep
 * it" also keeps it. A notification planned for another account on this phone
 * (`uid`) does nothing: the same id in this user's database is someone else's
 * subscription.
 */
export function subscriptionResponse(
  actionIdentifier: string,
  data: unknown,
  activeUserId: string | null,
): SubscriptionResponse | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  if (payload.type !== 'subscription') return null;
  if (
    actionIdentifier !== DEFAULT_ACTION &&
    actionIdentifier !== SUBSCRIPTION_KEEP_ACTION &&
    actionIdentifier !== SUBSCRIPTION_FORGOT_ACTION
  ) {
    return null;
  }
  if (typeof payload.uid === 'string' && payload.uid && payload.uid !== activeUserId) return null;
  const ids = subscriptionIdsOf(payload);
  const route = subscriptionRoute(ids);
  if (!route) return null;
  return { route, keep: actionIdentifier === SUBSCRIPTION_KEEP_ACTION ? ids : [] };
}
