import { test, expect } from 'bun:test';
import {
  parseSharedQueue,
  selectDrainableShares,
  planShares,
  type SharedItem,
} from './pending-share';
import { MAX_PENDING_AGE_MS } from './pending-capture';

const NOW = Date.parse('2026-08-26T12:00:00Z');
const item = (over: Partial<SharedItem> = {}): SharedItem => ({
  id: 's1', kind: 'text', text: '12.50 coffee', at: NOW - 60_000, ...over,
});

test('a queue of appended lines round-trips', () => {
  const raw = [JSON.stringify(item()), JSON.stringify(item({ id: 's2', text: 'lunch 8' }))].join('\n');
  expect(parseSharedQueue(raw).map((i) => i.id)).toEqual(['s1', 's2']);
});

test('a torn final line costs one entry, not the file', () => {
  const raw = JSON.stringify(item()) + '\n{"id":"s2","kind":"te';
  expect(parseSharedQueue(raw)).toHaveLength(1);
});

test('an image line with no file is dropped', () => {
  // The extension wrote the queue line but failed to write the picture. There
  // is nothing to analyse.
  const raw = JSON.stringify({ id: 'x', kind: 'image', text: '', at: NOW });
  expect(parseSharedQueue(raw)).toEqual([]);
});

test('a file name that tries to escape the media directory is rejected', () => {
  for (const file of ['../../Documents/db.sqlite', 'nested/file.jpg', '..']) {
    const raw = JSON.stringify({ id: 'x', kind: 'image', file, text: '', at: NOW });
    expect(parseSharedQueue(raw)).toEqual([]);
  }
});

test('an unknown kind is treated as text', () => {
  const raw = JSON.stringify({ id: 'x', kind: 'video', text: '5 thing', at: NOW });
  expect(parseSharedQueue(raw)[0]!.kind).toBe('text');
});

test('entries with no id are dropped', () => {
  expect(parseSharedQueue(JSON.stringify({ kind: 'text', text: '5', at: NOW }))).toEqual([]);
});

test('empty input is empty output, not a throw', () => {
  for (const junk of ['', '\n\n', '   ', 'not json']) expect(parseSharedQueue(junk)).toEqual([]);
});

test('an already-drained id is not replayed', () => {
  const out = selectDrainableShares([item({ id: 'a' }), item({ id: 'b' })], new Set(['a']), NOW);
  expect(out.map((i) => i.id)).toEqual(['b']);
});

test('a share older than the window is dropped', () => {
  const stale = item({ id: 'stale', at: NOW - MAX_PENDING_AGE_MS - 1 });
  const fresh = item({ id: 'fresh', at: NOW - 1000 });
  expect(selectDrainableShares([stale, fresh], new Set(), NOW).map((i) => i.id)).toEqual(['fresh']);
});

// ── Planning ─────────────────────────────────────────────────────────────────

test('shared text with an amount becomes a transaction', () => {
  const plan = planShares([item({ text: 'Your payment of $45.20 to Starbucks' })]);
  expect(plan.transactions).toEqual([{ amount: 45.2, type: 'Expense', note: expect.any(String) }]);
  expect(plan.receipt).toBeNull();
});

test('shared text with no amount is dropped but still marked seen', () => {
  // Retrying it next launch would fail identically, and the queue file is gone.
  const plan = planShares([item({ id: 'a', text: 'check this out' })]);
  expect(plan.transactions).toEqual([]);
  expect(plan.seen).toEqual(['a']);
});

test('a shared image goes to the receipt reader, not straight to the ledger', () => {
  // Reading a receipt needs the vision model and then a review. Writing it
  // silently would put an unverified amount in the ledger.
  const plan = planShares([item({ id: 'img', kind: 'image', file: 'a.jpg', text: '' })]);
  expect(plan.transactions).toEqual([]);
  expect(plan.receipt?.file).toBe('a.jpg');
});

test('when two images arrive, the newest one wins', () => {
  const plan = planShares([
    item({ id: 'old', kind: 'image', file: 'old.jpg', at: 1 }),
    item({ id: 'new', kind: 'image', file: 'new.jpg', at: 2 }),
  ]);
  expect(plan.receipt?.file).toBe('new.jpg');
  expect(plan.seen).toEqual(['old', 'new']);
});

test('text and an image in one drain both take effect', () => {
  const plan = planShares([
    item({ id: 't', text: '9 parking' }),
    item({ id: 'i', kind: 'image', file: 'r.jpg', text: '' }),
  ]);
  expect(plan.transactions).toHaveLength(1);
  expect(plan.receipt?.file).toBe('r.jpg');
});
