import { describe, test, expect } from 'bun:test';
import {
  DEFAULT_ACTION,
  SUBSCRIPTION_FORGOT_ACTION,
  SUBSCRIPTION_KEEP_ACTION,
  isSubscriptionNotification,
  routeForNotification,
  subscriptionResponse,
} from './notification-route';
import { notificationData } from './subscription-reminders';

test('a bill reminder opens the bill reminders screen', () => {
  expect(routeForNotification({ type: 'bill-reminder', billId: 'bill_1' })).toEqual({
    pathname: '/bill-reminders',
    params: { billId: 'bill_1' },
  });
});

test('a bill reminder with no id still opens the screen', () => {
  // Older payloads, or one where the bill was deleted before the tap.
  expect(routeForNotification({ type: 'bill-reminder' })).toEqual({ pathname: '/bill-reminders' });
});

test('an unknown type routes nowhere rather than guessing', () => {
  // The payload comes from the server. Turning an arbitrary string into a
  // pathname would let whatever sent it choose a screen.
  expect(routeForNotification({ type: 'something-new' })).toBeNull();
  expect(routeForNotification({ type: '../../admin' })).toBeNull();
});

test('a malformed payload routes nowhere', () => {
  for (const junk of [null, undefined, 'bill-reminder', 42, []]) {
    expect(routeForNotification(junk)).toBeNull();
  }
});

test('a non-string billId is ignored rather than interpolated', () => {
  expect(routeForNotification({ type: 'bill-reminder', billId: { evil: true } }))
    .toEqual({ pathname: '/bill-reminders' });
});

// ── Subscription reminders: "Keep it" and "Did I forget?" ────────────────────

describe('reminder actions', () => {
  const one = notificationData(['sub_netflix'], 'user_a');
  const batch = notificationData(['sub_netflix', 'sub_spotify', 'sub_canva'], 'user_a');

  test('a tap on a subscription reminder opens that subscription, and keeps nothing', () => {
    expect(subscriptionResponse(DEFAULT_ACTION, one, 'user_a')).toEqual({
      route: { pathname: '/subscription-detail', params: { id: 'sub_netflix' } },
      keep: [],
    });
    // The tap router agrees, for a payload it reads without the user check.
    expect(routeForNotification(one)).toEqual({ pathname: '/subscription-detail', params: { id: 'sub_netflix' } });
  });

  test('"Did I forget?" opens the subscription to look at, and decides nothing', () => {
    expect(subscriptionResponse(SUBSCRIPTION_FORGOT_ACTION, one, 'user_a')).toEqual({
      route: { pathname: '/subscription-detail', params: { id: 'sub_netflix' } },
      keep: [],
    });
  });

  test('"Keep it" keeps it, then opens it', () => {
    expect(subscriptionResponse(SUBSCRIPTION_KEEP_ACTION, one, 'user_a')).toEqual({
      route: { pathname: '/subscription-detail', params: { id: 'sub_netflix' } },
      keep: ['sub_netflix'],
    });
  });

  test('a batch of finds opens the list, and "Keep it" keeps every one it named', () => {
    expect(subscriptionResponse(DEFAULT_ACTION, batch, 'user_a')).toEqual({ route: { pathname: '/subscriptions' }, keep: [] });
    expect(subscriptionResponse(SUBSCRIPTION_KEEP_ACTION, batch, 'user_a')!.keep).toEqual([
      'sub_netflix',
      'sub_spotify',
      'sub_canva',
    ]);
  });

  test('a reminder planned for another account on this phone does nothing', () => {
    expect(subscriptionResponse(SUBSCRIPTION_KEEP_ACTION, one, 'user_b')).toBeNull();
    expect(subscriptionResponse(DEFAULT_ACTION, one, null)).toBeNull();
    // The tap listener knows it for ours, so it does not fall back to the plain router either.
    expect(isSubscriptionNotification(one)).toBe(true);
    expect(isSubscriptionNotification({ type: 'bill-reminder' })).toBe(false);
    expect(isSubscriptionNotification(null)).toBe(false);
  });

  test('another feature’s button, or a payload that is not ours, is left alone', () => {
    expect(subscriptionResponse('quick-add-log', one, 'user_a')).toBeNull();
    expect(subscriptionResponse(DEFAULT_ACTION, { type: 'bill-reminder', billId: 'b1' }, 'user_a')).toBeNull();
    for (const junk of [null, 'subscription', [], { type: 'subscription' }, { type: 'subscription', subscriptionId: '../../admin' }]) {
      expect(subscriptionResponse(SUBSCRIPTION_KEEP_ACTION, junk, 'user_a')).toBeNull();
    }
  });
});
