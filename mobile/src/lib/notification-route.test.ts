import { test, expect } from 'bun:test';
import { routeForNotification } from './notification-route';

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
