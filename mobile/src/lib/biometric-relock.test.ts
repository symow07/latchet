import { test, expect } from 'bun:test';
import { shouldRelock, RELOCK_GRACE_MS } from './biometric-relock';

const NOW = 1_700_000_000_000;

test('a long absence re-locks', () => {
  expect(shouldRelock({ enabled: true, backgroundedAt: NOW - 60_000, now: NOW })).toBe(true);
});

test('a brief interruption does not', () => {
  // Control Centre, the notification shade, a mis-swipe into the app switcher.
  // Demanding Face ID after each trains people to switch the setting off.
  expect(shouldRelock({ enabled: true, backgroundedAt: NOW - 2_000, now: NOW })).toBe(false);
});

test('the boundary re-locks rather than not', () => {
  expect(shouldRelock({ enabled: true, backgroundedAt: NOW - RELOCK_GRACE_MS, now: NOW })).toBe(true);
  expect(shouldRelock({ enabled: true, backgroundedAt: NOW - RELOCK_GRACE_MS + 1, now: NOW })).toBe(false);
});

test('the lock being switched off means nothing re-locks', () => {
  expect(shouldRelock({ enabled: false, backgroundedAt: NOW - 600_000, now: NOW })).toBe(false);
});

test('becoming active without having been backgrounded does not re-lock', () => {
  // Otherwise the first foreground after launch would lock an app the user
  // has already authenticated into.
  expect(shouldRelock({ enabled: true, backgroundedAt: null, now: NOW })).toBe(false);
});

test('a clock that moved backwards re-locks', () => {
  // The elapsed time is unknowable. Being wrong this way costs a Face ID
  // prompt; being wrong the other way shows someone's finances to whoever is
  // holding the phone.
  expect(shouldRelock({ enabled: true, backgroundedAt: NOW + 5_000, now: NOW })).toBe(true);
});

test('the grace period is configurable for callers that want it stricter', () => {
  expect(shouldRelock({ enabled: true, backgroundedAt: NOW - 1_000, now: NOW, graceMs: 0 })).toBe(true);
});
