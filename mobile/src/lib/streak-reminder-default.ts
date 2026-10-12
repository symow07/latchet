/**
 * The daily streak nudge is on by default — once.
 *
 * The root layout used to schedule it on every sign-in, so turning it off in
 * Settings lasted only until the next launch. The default now applies the
 * first time on a device and is remembered; after that the user's switch is
 * the only thing that turns it on or off. The nudge is a notification the
 * phone schedules for itself, so the memory is per device (storage-keys.ts).
 *
 * Pure, with the storage and the scheduler passed in, so it runs under
 * `bun test` (notifications.ts cannot load there).
 */
export interface StreakReminderDefaultDeps {
  /** Whether the default was already applied on this device. */
  isApplied(): Promise<boolean>;
  markApplied(): Promise<void>;
  schedule(): Promise<void>;
}

/** Schedules the nudge the first time only; returns whether it did. */
export async function applyStreakReminderDefault(deps: StreakReminderDefaultDeps): Promise<boolean> {
  if (await deps.isApplied()) return false;
  await deps.schedule();
  // Remembered only after scheduling went through, so a failure retries next launch.
  await deps.markApplied();
  return true;
}
