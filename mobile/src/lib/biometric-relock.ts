/**
 * Deciding whether returning to the app should ask for Face ID again.
 *
 * The setting says "Require Face ID / Fingerprint on open", and it only ever
 * honoured that on a cold start. Backgrounding the app and coming back walked
 * straight into the user's finances — which is precisely the case the setting
 * exists for, since that is what happens when a phone is handed over or left
 * on a desk.
 *
 * Dependency-free so the timing rules can be tested; the AppState wiring lives
 * in the root layout.
 */

/**
 * How long the app may be away before returning requires authentication.
 *
 * Not zero: iOS backgrounds the app for things the user did not choose and does
 * not think of as leaving — Control Centre, the notification shade, a mis-swipe
 * into the app switcher. Demanding Face ID after each of those trains people to
 * turn the setting off, which protects nothing.
 *
 * Not a minute either: the threat is someone picking up an unattended phone,
 * and a minute is a long time to stand next to one.
 */
export const RELOCK_GRACE_MS = 15_000;

export interface RelockInput {
  /** Whether the user has the biometric lock switched on. */
  enabled: boolean;
  /** When the app last went to the background, or null if it has not. */
  backgroundedAt: number | null;
  now: number;
  graceMs?: number;
}

export function shouldRelock({
  enabled,
  backgroundedAt,
  now,
  graceMs = RELOCK_GRACE_MS,
}: RelockInput): boolean {
  if (!enabled) return false;

  // Never backgrounded — a foreground event without one is the app becoming
  // active after a system interruption it never left the screen for.
  if (backgroundedAt === null) return false;

  const away = now - backgroundedAt;

  // A negative gap means the clock moved backwards while the app was away, so
  // the elapsed time is unknowable. Lock: the cost of being wrong the other
  // way is showing someone's finances to whoever is holding the phone.
  if (away < 0) return true;

  return away >= graceMs;
}
