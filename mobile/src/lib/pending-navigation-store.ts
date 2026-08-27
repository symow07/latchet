import { create } from 'zustand';
import type { NotificationRoute } from './notification-route';

/**
 * A screen to open once the app has settled somewhere.
 *
 * Two things want to navigate before the app is ready to be navigated: a
 * receipt shared in from another app, drained as soon as the database opens,
 * and a notification tap, delivered before the first render. Both land while
 * the auth gate is still deciding where the user belongs, and the
 * `router.replace` that follows wipes them — in the receipt's case losing it
 * outright, because the queue file has already been consumed.
 *
 * So they park a route here and RootLayoutNav opens it once the redirect has
 * settled and there is a stable screen to come back to.
 */
interface PendingNavigationState {
  route: NotificationRoute | null;
  setRoute: (route: NotificationRoute | null) => void;
}

export const usePendingNavigationStore = create<PendingNavigationState>((set) => ({
  route: null,
  setRoute: (route) => set({ route }),
}));
