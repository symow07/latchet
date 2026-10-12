import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyStreakReminderDefault } from './streak-reminder-default';
import { DEVICE_STORAGE_KEYS } from './storage-keys';

function device() {
  let applied = false;
  let scheduled = 0;
  return {
    get applied() { return applied; },
    get scheduled() { return scheduled; },
    deps: {
      isApplied: async () => applied,
      markApplied: async () => { applied = true; },
      schedule: async () => { scheduled++; },
    },
  };
}

test('streak reminder default: a new device gets the nudge once', async () => {
  const d = device();
  expect(await applyStreakReminderDefault(d.deps)).toBe(true);
  expect(d.scheduled).toBe(1);
  expect(d.applied).toBe(true);
});

test('streak reminder default: later launches leave the user\'s choice alone', async () => {
  const d = device();
  await applyStreakReminderDefault(d.deps);
  // The user turns it off in Settings, then relaunches twice.
  expect(await applyStreakReminderDefault(d.deps)).toBe(false);
  expect(await applyStreakReminderDefault(d.deps)).toBe(false);
  expect(d.scheduled).toBe(1);
});

test('streak reminder default: a failed schedule is retried next launch', async () => {
  const d = device();
  const failing = { ...d.deps, schedule: async () => { throw new Error('no permission'); } };
  await expect(applyStreakReminderDefault(failing)).rejects.toThrow();
  expect(d.applied).toBe(false);
  expect(await applyStreakReminderDefault(d.deps)).toBe(true);
});

test('streak reminder default: the key is a declared per-device key, and launch no longer schedules unconditionally', () => {
  expect((DEVICE_STORAGE_KEYS as readonly string[]).includes('streak_reminder_default_v1')).toBe(true);
  const layout = readFileSync(join(import.meta.dir, '..', 'app', '_layout.tsx'), 'utf8');
  expect(layout).not.toMatch(/\bscheduleStreakReminder\(/);
  expect(layout).toMatch(/\bapplyDefaultStreakReminder\(/);
});

test('permission when useful: the default waits, unapplied, until notifications are allowed — it never asks', async () => {
  const d = device();
  let allowed = false;
  const deps = { ...d.deps, canSchedule: async () => allowed };
  // Startup on a phone that has not granted permission: nothing scheduled, nothing remembered.
  expect(await applyStreakReminderDefault(deps)).toBe(false);
  expect(d.scheduled).toBe(0);
  expect(d.applied).toBe(false);
  // Permission granted later, for a subscription reminder: the default applies then, once.
  allowed = true;
  expect(await applyStreakReminderDefault(deps)).toBe(true);
  expect(await applyStreakReminderDefault(deps)).toBe(false);
  expect(d.scheduled).toBe(1);
});
