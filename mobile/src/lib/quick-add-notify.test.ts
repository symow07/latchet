import { test, expect, mock, beforeEach } from 'bun:test';

/**
 * The handler itself needs expo-notifications and the database, so those are
 * mocked. What is under test is the branching around the parse: which
 * responses are acted on, which are ignored, and what reaches addTransaction.
 *
 * The OS half — iOS drawing the action button and delivering the response —
 * cannot be exercised without a device session, and is not claimed here.
 */
const added: unknown[] = [];

mock.module('expo-notifications', () => ({
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  getLastNotificationResponseAsync: async () => null,
  setNotificationCategoryAsync: async () => {},
  setNotificationHandler: () => {},
}));
mock.module('./db', () => ({
  addTransaction: async (tx: unknown) => { added.push(tx); },
  getTransactions: async () => [],
}));
mock.module('./notifications', () => ({
  QUICK_ADD_ACTION: 'quick-add-log',
  registerQuickAddCategory: async () => {},
}));

const { handleQuickAddResponse } = await import('./quick-add-notify');

let seq = 0;
const response = (actionIdentifier: string, userText?: string) => ({
  actionIdentifier,
  userText,
  notification: { date: 1_700_000_000_000, request: { identifier: `n${seq++}` } },
}) as never;

beforeEach(() => { added.length = 0; });

test('a quick-add response becomes a transaction', async () => {
  expect(await handleQuickAddResponse(response('quick-add-log', '12.50 coffee'))).toBe(true);
  expect(added).toEqual([{
    amount: 12.5,
    category: 'Food',
    type: 'Expense',
    isImpulse: false,
    note: 'coffee',
    dateISO: expect.any(String),
  }]);
});

test('merely tapping the notification logs nothing', () => {
  // The default action opens the app. Treating it as a capture would create a
  // transaction every time the user glanced at the reminder.
  return handleQuickAddResponse(response('expo.modules.notifications.actions.DEFAULT', '')).then((r) => {
    expect(r).toBe(false);
    expect(added).toHaveLength(0);
  });
});

test('text with no amount in it logs nothing', async () => {
  expect(await handleQuickAddResponse(response('quick-add-log', 'coffee'))).toBe(false);
  expect(added).toHaveLength(0);
});

test('an empty submission logs nothing', async () => {
  expect(await handleQuickAddResponse(response('quick-add-log', ''))).toBe(false);
  expect(added).toHaveLength(0);
});

test('the same response delivered twice inserts once', async () => {
  // iOS can hand one response to the listener and to
  // getLastNotificationResponseAsync on the same launch.
  const r = response('quick-add-log', '8 lunch');
  expect(await handleQuickAddResponse(r)).toBe(true);
  expect(await handleQuickAddResponse(r)).toBe(false);
  expect(added).toHaveLength(1);
});

test('income wording is respected', async () => {
  await handleQuickAddResponse(response('quick-add-log', 'got paid 2000'));
  expect((added[0] as { type: string }).type).toBe('Income');
});

test('the date is the device today, not a UTC one', async () => {
  // The nudge fires in the evening; a UTC date files it under tomorrow for
  // anyone east of London.
  const { todayISO } = await import('./dates');
  await handleQuickAddResponse(response('quick-add-log', '5 snack'));
  expect((added[0] as { dateISO: string }).dateISO).toBe(todayISO());
});
