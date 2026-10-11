import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { dbModuleMock } from './test-support/db-module';

/**
 * The note ladder (history, then the keyword fallback in the user's currency,
 * then "Other"), and the quick-add handler that uses it, with the database
 * stood in for: what is under test is that the currency in the user's
 * settings reaches the fallback, and that their own history still wins.
 *
 * The Siri and share drains make the same two calls as the quick-add handler
 * (loadNoteContext, then categoriseNote per row); the quick-add one is driven
 * end to end here because it is the one that runs without a file queue.
 */
let settings: { currency: string } | Error = { currency: 'USD' };
let history: { note: string; category: string; dateISO: string }[] = [];
const added: { category: string; note?: string }[] = [];

// Bun's module mocks are process-wide; these match quick-add-notify.test.ts's
// shapes so the two files can run in either order.
mock.module('expo-notifications', () => ({
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  getLastNotificationResponseAsync: async () => null,
  setNotificationCategoryAsync: async () => {},
  setNotificationHandler: () => {},
}));
mock.module('./db', () =>
  dbModuleMock({
    addTransaction: async (tx: { category: string; note?: string }) => { added.push(tx); },
    getTransactions: async () => history,
    getSettings: async () => {
      if (settings instanceof Error) throw settings;
      return settings;
    },
  }),
);
mock.module('./notifications', () => ({
  QUICK_ADD_ACTION: 'quick-add-log',
  registerQuickAddCategory: async () => {},
}));

const { categoriseNote, loadNoteContext } = await import('./categorise');
const { handleQuickAddResponse } = await import('./quick-add-notify');
const { buildMerchantMemory } = await import('./merchant-memory');

let seq = 0;
/** A quick-add reply typed into the reminder. */
const reply = (userText: string) =>
  ({
    actionIdentifier: 'quick-add-log',
    userText,
    notification: { date: 1_700_000_000_000, request: { identifier: `categorise-${seq++}` } },
  }) as never;

/** What the quick-add handler files `text` under, for a user in `currency`. */
async function quickAdd(text: string, currency: string): Promise<string | undefined> {
  settings = { currency };
  added.length = 0;
  expect(await handleQuickAddResponse(reply(text))).toBe(true);
  return added[0]?.category;
}

beforeEach(() => {
  settings = { currency: 'USD' };
  history = [];
  added.length = 0;
});

describe('categorises by region', () => {
  test('a quick-add note is categorised in the user’s own currency', async () => {
    // Casablanca, Lyon, London, Shanghai: the brand only means something in
    // its own market, and the settings say which market this user is in.
    expect(await quickAdd('45 Marjane', 'MAD')).toBe('Food');
    expect(await quickAdd('20 afriquia', 'MAD')).toBe('Transport');
    expect(await quickAdd('80 recharge inwi', 'MAD')).toBe('Subscriptions');
    expect(await quickAdd('12 SNCF', 'EUR')).toBe('Transport');
    expect(await quickAdd('9.50 Tesco', 'GBP')).toBe('Food');
    expect(await quickAdd('35 滴滴', 'CNY')).toBe('Transport');
    // The same brands in dollars are unknown.
    expect(await quickAdd('45 Marjane', 'USD')).toBe('Other');
    expect(await quickAdd('12 SNCF', 'USD')).toBe('Other');
  });

  test('a quick-add note in any of the four languages is categorised', async () => {
    expect(await quickAdd('60 مطعم', 'MAD')).toBe('Food');
    expect(await quickAdd('25 外卖', 'CNY')).toBe('Food');
    expect(await quickAdd('14 boulangerie', 'EUR')).toBe('Food');
    expect(await quickAdd('7 taxi', 'GBP')).toBe('Transport');
    // A Chinese brand is recognised from its characters whatever the currency.
    expect(await quickAdd('30 美团', 'MAD')).toBe('Food');
  });

  test('the user’s own history still beats the regional brand', async () => {
    // This user files Marjane under Shopping (it is where they buy their
    // electronics). The table says Food; they say Shopping.
    history = [{ note: 'Marjane', category: 'Shopping', dateISO: '2026-09-01' }];
    expect(await quickAdd('1200 Marjane', 'MAD')).toBe('Shopping');
  });

  test('without a currency only the words and the global brands apply', async () => {
    // A settings read that fails is not a failed capture.
    settings = new Error('database closed');
    added.length = 0;
    expect(await handleQuickAddResponse(reply('45 Marjane'))).toBe(true);
    expect(added[0]!.category).toBe('Other');
    added.length = 0;
    expect(await handleQuickAddResponse(reply('15 Netflix'))).toBe(true);
    expect(added[0]!.category).toBe('Subscriptions');
  });
});

describe('categoriseNote', () => {
  test('history, then the fallback in the given currency, then Other', () => {
    const memory = buildMerchantMemory([
      { note: 'Café de la Gare', category: 'Treats', dateISO: '2026-09-01' },
    ]);
    expect(categoriseNote('café de la gare', memory, 'EUR')).toBe('Treats');
    expect(categoriseNote('boulangerie du coin', memory, 'EUR')).toBe('Food');
    expect(categoriseNote('Leroy Merlin', null, 'EUR')).toBe('Shopping');
    expect(categoriseNote('Leroy Merlin', null)).toBe('Other');
    expect(categoriseNote('', memory, 'EUR')).toBe('Other');
  });

  test('loadNoteContext reads the currency from settings and tolerates its absence', async () => {
    settings = { currency: 'MAD' };
    expect((await loadNoteContext()).currency).toBe('MAD');
    settings = { currency: '' };
    expect((await loadNoteContext()).currency).toBeNull();
    settings = new Error('no database');
    expect(await loadNoteContext()).toMatchObject({ currency: null });
  });
});
