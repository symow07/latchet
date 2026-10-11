import { describe, expect, test } from 'bun:test';
import {
  EMPTY_SNAPSHOT_FORM,
  breakdownLines,
  parseBreakdown,
  serializeBreakdown,
  snapshotFromForm,
  snapshotTotals,
  sortSnapshotsNewestFirst,
} from './net-worth';

/**
 * Run under `bun run test:tz` too (Asia/Shanghai, America/Los_Angeles, UTC):
 * the dates below are local wall-clock times, which is the point.
 */

describe('phase4 screens', () => {
  test('the net-worth breakdown parses from the JSON text the server stores, and shows', () => {
    // Exactly what the server sends: POST /net-worth stores JSON.stringify(body.breakdown).
    const stored = JSON.stringify({ cashSavings: 1200.5, investments: 3000, loans: 450, mortgage: 0 });
    const breakdown = parseBreakdown(stored);
    expect(breakdown).toEqual({ cashSavings: 1200.5, investments: 3000, loans: 450, mortgage: 0 });
    // The screen's lines: assets then liabilities, in form order, zero lines left out.
    expect(breakdownLines(breakdown)).toEqual([
      { key: 'cashSavings', value: 1200.5, liability: false },
      { key: 'investments', value: 3000, liability: false },
      { key: 'loans', value: 450, liability: true },
    ]);

    // Nothing usable is nothing to show, never a crash or NaN.
    expect(parseBreakdown(null)).toBeNull();
    expect(parseBreakdown('')).toBeNull();
    expect(parseBreakdown('not json')).toBeNull();
    expect(parseBreakdown('[1,2]')).toBeNull();
    expect(parseBreakdown('{"cashSavings":"12","loans":null,"investments":7}')).toEqual({ investments: 7 });
    expect(breakdownLines(null)).toEqual([]);

    // And back: what a new snapshot stores and sends, which the server accepts as text.
    expect(serializeBreakdown({ cashSavings: 10, loans: 2 })).toBe('{"cashSavings":10,"loans":2}');
    expect(parseBreakdown(serializeBreakdown({ cashSavings: 10, loans: 2 }))).toEqual({ cashSavings: 10, loans: 2 });
    expect(serializeBreakdown({})).toBeNull();
    expect(serializeBreakdown(null)).toBeNull();
  });

  test("a snapshot is dated on the device's own calendar, late at night and early in the morning", () => {
    const form = { ...EMPTY_SNAPSHOT_FORM, cashSavings: '1,500', loans: '200' };
    // 23:30 local: west of UTC, toISOString() already says the 12th.
    const lateNight = snapshotFromForm(form, new Date(2026, 9, 11, 23, 30));
    // 00:30 local: east of UTC, toISOString() still says the 10th.
    const earlyMorning = snapshotFromForm(form, new Date(2026, 9, 11, 0, 30));
    for (const parsed of [lateNight, earlyMorning]) {
      expect(parsed).toEqual({
        ok: true,
        snapshot: { date: '2026-10-11', assets: 1500, liabilities: 200, breakdown: { cashSavings: 1500, loans: 200 } },
      });
    }
    // Month and year boundaries too.
    const newYearsEve = snapshotFromForm(form, new Date(2026, 11, 31, 23, 59));
    expect(newYearsEve.ok && newYearsEve.snapshot.date).toBe('2026-12-31');
  });
});

describe('the new-snapshot form', () => {
  test('totals ignore blanks, junk and negatives; an empty form or an amount past the limit saves nothing', () => {
    const form = { ...EMPTY_SNAPSHOT_FORM, cashSavings: '100', investments: 'abc', otherAssets: '-50', mortgage: '40' };
    expect(snapshotTotals(form)).toEqual({ assets: 100, liabilities: 40, netWorth: 60 });
    expect(snapshotFromForm(EMPTY_SNAPSHOT_FORM)).toEqual({ ok: false, error: null });
    expect(snapshotFromForm({ ...EMPTY_SNAPSHOT_FORM, realEstate: '10000001' })).toEqual({ ok: false, error: 'common.amountTooLarge' });
  });

  test('newest first: by date, then by when it was taken', () => {
    const entries = [
      { id: 'a', date: '2026-10-01', createdAt: '2026-10-01T08:00:00.000Z' },
      { id: 'b', date: '2026-10-11', createdAt: '2026-10-11T08:00:00.000Z' },
      { id: 'c', date: '2026-10-11', createdAt: '2026-10-11T09:00:00.000Z' },
      { id: 'd', date: '2025-12-31', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(sortSnapshotsNewestFirst(entries).map((e) => e.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});
