import { test, expect } from 'bun:test';
import {
  parsePendingQueue,
  selectDrainable,
  encodeCapture,
  MAX_PENDING,
  MAX_PENDING_AGE_MS,
  type PendingCapture,
} from './pending-capture';

const NOW = Date.parse('2026-08-26T12:00:00Z');

const capture = (over: Partial<PendingCapture> = {}): PendingCapture => ({
  id: 'c1',
  amount: 20,
  type: 'Expense',
  note: 'coffee',
  dateISO: '2026-08-26',
  at: NOW - 60_000,
  ...over,
});

test('a queue of appended lines round-trips', () => {
  const raw = encodeCapture(capture()) + encodeCapture(capture({ id: 'c2', amount: 40 }));
  const parsed = parsePendingQueue(raw);
  expect(parsed).toHaveLength(2);
  expect(parsed[1]!.amount).toBe(40);
});

test('a torn final line costs one entry, not the file', () => {
  // The intent can be killed mid-append. Newline-delimited JSON means the
  // damage is bounded; a single JSON array would be unparseable entirely.
  const raw = encodeCapture(capture()) + '{"id":"c2","amount":4';
  expect(parsePendingQueue(raw)).toHaveLength(1);
});

test('entries without an id, amount or date are dropped', () => {
  // Written by a different process, possibly an older build of it. Nothing it
  // sends is trusted.
  const raw = [
    JSON.stringify({ amount: 10, dateISO: '2026-08-26' }),            // no id
    JSON.stringify({ id: 'x', dateISO: '2026-08-26' }),               // no amount
    JSON.stringify({ id: 'y', amount: 10 }),                          // no date
    JSON.stringify({ id: 'z', amount: 0, dateISO: '2026-08-26' }),    // zero
    JSON.stringify({ id: 'w', amount: 'lots', dateISO: '2026-08-26' }),
    JSON.stringify(capture({ id: 'ok' })),
  ].join('\n');
  const parsed = parsePendingQueue(raw);
  expect(parsed.map((c) => c.id)).toEqual(['ok']);
});

test('a malformed date is rejected rather than coerced', () => {
  const raw = JSON.stringify(capture({ dateISO: '26/08/2026' }));
  expect(parsePendingQueue(raw)).toEqual([]);
});

test('a negative amount is stored as a magnitude', () => {
  expect(parsePendingQueue(JSON.stringify(capture({ amount: -20 })))[0]!.amount).toBe(20);
});

test('an unrecognised type falls back to Expense', () => {
  expect(parsePendingQueue(JSON.stringify(capture({ type: 'Transfer' as never })))[0]!.type)
    .toBe('Expense');
});

test('empty input is empty output, not a throw', () => {
  for (const junk of ['', '\n\n', '   ', 'not json', '[]']) {
    expect(parsePendingQueue(junk)).toEqual([]);
  }
});

// ── Draining ─────────────────────────────────────────────────────────────────

test('an id already drained is not inserted twice', () => {
  // The queue file is deleted after a drain, but a crash between insert and
  // delete would replay it — which is how one shortcut becomes three
  // identical transactions.
  const queue = [capture({ id: 'a' }), capture({ id: 'b' })];
  const out = selectDrainable(queue, new Set(['a']), NOW);
  expect(out.map((c) => c.id)).toEqual(['b']);
});

test('a duplicate id within one file is inserted once', () => {
  const queue = [capture({ id: 'a' }), capture({ id: 'a', amount: 99 })];
  expect(selectDrainable(queue, new Set(), NOW)).toHaveLength(1);
});

test('captures drain oldest first', () => {
  const queue = [
    capture({ id: 'new', at: NOW - 1_000 }),
    capture({ id: 'old', at: NOW - 900_000 }),
  ];
  expect(selectDrainable(queue, new Set(), NOW).map((c) => c.id)).toEqual(['old', 'new']);
});

test('a capture older than the window is dropped, not back-dated', () => {
  // A month-old entry means the app has not been opened since. Quietly
  // inserting spending into a period the user has already reviewed does more
  // harm than losing the entry.
  const stale = capture({ id: 'stale', at: NOW - MAX_PENDING_AGE_MS - 1 });
  const fresh = capture({ id: 'fresh', at: NOW - 1000 });
  expect(selectDrainable([stale, fresh], new Set(), NOW).map((c) => c.id)).toEqual(['fresh']);
});

test('a capture with no timestamp is kept rather than judged stale', () => {
  // at:0 means an older intent build that did not record one. Age is unknown,
  // so it is not evidence of staleness.
  expect(selectDrainable([capture({ id: 'notime', at: 0 })], new Set(), NOW)).toHaveLength(1);
});

test('a runaway writer cannot flood the database', () => {
  const many = Array.from({ length: MAX_PENDING + 50 }, (_, i) => capture({ id: `c${i}` }));
  expect(selectDrainable(many, new Set(), NOW)).toHaveLength(MAX_PENDING);
});
