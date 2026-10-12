/**
 * The daily streak nudge is on by default — once.
 *
 * The root layout used to schedule it on every sign-in, so turning it off in
 * Settings lasted only until the next launch. The default now applies the
 * first time on a device and is remembered; after that the user's switch is
 * the only thing that turns it on or off. The nudge is a notification the
 * phone schedules for itself, so the memory is per device (storage-keys.ts).
 *
 * And only once notifications are allowed (Phase 6, permission when useful):
 * startup used to ask for permission to schedule this, a prompt with nothing
 * in front of it. Now the default waits — unapplied — until permission
 * exists for a reason the user saw (a subscription reminder, onboarding),
 * and applies then.
 *
 * Pure, with the storage and the scheduler passed in, so it runs under
 * `bun test` (notifications.ts cannot load there).
 */
export interface StreakReminderDefaultDeps {
  /** Whether the default was already applied on this device. */
  isApplied(): Promise<boolean>;
  markApplied(): Promise<void>;
  /** Notifications are already allowed: scheduling will not ask. Absent means yes. */
  canSchedule?(): Promise<boolean>;
  schedule(): Promise<void>;
}

/** Schedules the nudge the first time only; returns whether it did. */
export async function applyStreakReminderDefault(deps: StreakReminderDefaultDeps): Promise<boolean> {
  if (await deps.isApplied()) return false;
  // Not yet allowed: leave it unapplied, so it applies once permission exists.
  if (deps.canSchedule && !(await deps.canSchedule())) return false;
  await deps.schedule();
  // Remembered only after scheduling went through, so a failure retries next launch.
  await deps.markApplied();
  return true;
}
