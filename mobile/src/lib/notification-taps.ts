/**
 * Acting on a tapped notification.
 *
 * The routing rules live in notification-route.ts and are tested there; this
 * is the part that needs expo-notifications.
 *
 * Separate from the quick-add listener on purpose: that one handles the
 * quick-add *button* on the streak nudge, this one handles the notification
 * itself being tapped — and a subscription reminder's two answers, "Keep it"
 * and "Did I forget?", which both open the subscription (keeping it first,
 * for the one that says so). Both listeners receive every response and each
 * ignores what is not theirs.
 */
import * as Notifications from 'expo-notifications';
import { activeUserId } from './db';
import {
  DEFAULT_ACTION,
  isSubscriptionNotification,
  routeForNotification,
  subscriptionResponse,
  SUBSCRIPTION_FORGOT_ACTION,
  SUBSCRIPTION_KEEP_ACTION,
  type NotificationRoute,
} from './notification-route';

/**
 * Route taps to the screen the notification is about.
 *
 * `getLastNotificationResponseAsync` matters as much as the listener: a tap
 * that launches the app from cold is delivered before any listener could have
 * been attached, and that is the most common way a reminder gets tapped.
 */
/**
 * Responses already acted on, for the life of the process. Not per listener:
 * the root layout remounts (a language change) and attaches a new one, which
 * asks getLastNotificationResponseAsync again — and would otherwise open the
 * last tapped reminder a second time, or keep a subscription twice.
 */
const handled = new Set<string>();

export function listenForNotificationTaps(
  navigate: (route: NotificationRoute) => void,
): () => void {
  const run = async (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const action = response.actionIdentifier;
    const isTap = action === Notifications.DEFAULT_ACTION_IDENTIFIER;

    // A tap on the notification body, or one of a subscription reminder's
    // answers. Any other button is somebody else's job: treating the
    // quick-add as a tap would navigate away from the screen the user is on
    // while their entry is still saving.
    if (!isTap && action !== SUBSCRIPTION_KEEP_ACTION && action !== SUBSCRIPTION_FORGOT_ACTION) return;

    // The same response can arrive twice on one launch — once from the
    // listener and once from getLastNotificationResponseAsync.
    const key = `${response.notification.request.identifier}:${response.notification.date}:${action}`;
    if (handled.has(key)) return;
    handled.add(key);

    const data = response.notification.request.content.data;
    if (isSubscriptionNotification(data)) {
      // Another account's reminder, or a malformed one, does nothing at all.
      const subscription = subscriptionResponse(isTap ? DEFAULT_ACTION : action, data, activeUserId());
      if (!subscription) return;
      if (subscription.keep.length > 0) {
        try {
          const { decideSubscription } = await import('./subscription-detection');
          for (const id of subscription.keep) await decideSubscription(id, 'keep');
        } catch (e) {
          // The screen it opens still lets them keep it by hand.
          console.warn('[notifications] keeping from a reminder failed', e);
        }
      }
      navigate(subscription.route);
      return;
    }
    if (!isTap) return;

    const route = routeForNotification(data);
    if (route) navigate(route);
  };

  Notifications.getLastNotificationResponseAsync()
    .then(run)
    .catch(() => {});
  const subscription = Notifications.addNotificationResponseReceivedListener((r) => {
    void run(r).catch(() => {});
  });
  return () => subscription.remove();
}
