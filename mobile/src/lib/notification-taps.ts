/**
 * Acting on a tapped notification.
 *
 * The routing rules live in notification-route.ts and are tested there; this
 * is the part that needs expo-notifications.
 *
 * Separate from the quick-add listener on purpose: that one handles a *button*
 * on the notification, this one handles the notification itself being tapped.
 * Both receive every response and each ignores what is not theirs.
 */
import * as Notifications from 'expo-notifications';
import { routeForNotification, type NotificationRoute } from './notification-route';

/**
 * Route taps to the screen the notification is about.
 *
 * `getLastNotificationResponseAsync` matters as much as the listener: a tap
 * that launches the app from cold is delivered before any listener could have
 * been attached, and that is the most common way a reminder gets tapped.
 */
export function listenForNotificationTaps(
  navigate: (route: NotificationRoute) => void,
): () => void {
  const handled = new Set<string>();

  const run = (response: Notifications.NotificationResponse | null) => {
    if (!response) return;

    // Only a tap on the notification body. A button press is somebody else's
    // job, and treating it as a tap would navigate away from the screen the
    // user is on while their quick-add is still saving.
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    // The same response can arrive twice on one launch — once from the
    // listener and once from getLastNotificationResponseAsync.
    const key = `${response.notification.request.identifier}:${response.notification.date}`;
    if (handled.has(key)) return;
    handled.add(key);

    const route = routeForNotification(response.notification.request.content.data);
    if (route) navigate(route);
  };

  Notifications.getLastNotificationResponseAsync().then(run).catch(() => {});
  const subscription = Notifications.addNotificationResponseReceivedListener(run);
  return () => subscription.remove();
}
