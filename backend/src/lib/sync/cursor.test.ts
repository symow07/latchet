import { describe, test, expect } from "bun:test";
import { PULL_SAFETY_LAG_MS, SYNC_ENTITIES, type SyncEntity } from "./constants";
import {
  CURSOR_MAX_AGE_MS, compareKeys, cutPage, decodeCursor, encodeCursor, planPull, userTag,
  type PullCursor, type PullPlan, type SyncKey,
} from "./cursor";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const TAG = userTag("user-a");
const key = (t: number, e: SyncEntity, k: string): SyncKey => ({ t, e, k });

describe("cursor encoding", () => {
  test("every kind of cursor round-trips through its opaque string", () => {
    const cursors: PullCursor[] = [
      { mode: "rest", user: TAG, t: NOW },
      { mode: "inc", user: TAG, pos: key(NOW, "transactions", "tx_1"), floor: null },
      { mode: "inc", user: TAG, pos: key(NOW, "accounts", "acc ünïcode/1"), floor: NOW - 5000 },
      { mode: "snap", user: TAG, pos: key(1, "settings", "settings"), floor: NOW },
    ];
    for (const c of cursors) {
      const s = encodeCursor(c);
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/); // safe in a query string unescaped
      expect(decodeCursor(s)).toEqual(c);
    }
  });

  test("anything this server did not issue decodes to null, never throws", () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const bad = [
      "", "not a cursor", "%%%", "a".repeat(2000), b64("x"), b64({}), b64([2, "r", TAG, NOW]),
      b64([1, "r", TAG, -1]), b64([1, "r", TAG, 1.5]), b64([1, "r", TAG]), b64([1, "r", "", NOW]),
      b64([1, "x", TAG, NOW]), b64([1, "i", TAG, NOW, "widgets", "id", null]),
      b64([1, "i", TAG, NOW, "transactions", "", null]), b64([1, "s", TAG, NOW, "transactions", "id", null]),
      b64([1, "i", TAG, NOW, "transactions", "id", "soon"]), b64([1, "r", TAG, Number.MAX_SAFE_INTEGER]),
      Buffer.from("[1,\"r\"").toString("base64url"),
    ];
    for (const s of bad) expect(decodeCursor(s)).toBeNull();
  });
});

describe("planPull", () => {
  test("no cursor starts a snapshot whose floor is the current horizon", () => {
    expect(planPull(null, TAG, NOW)).toEqual({ snapshot: true, after: null, floor: NOW - PULL_SAFETY_LAG_MS });
  });

  test("another user's cursor starts a snapshot rather than positioning this user's pull", () => {
    const theirs: PullCursor = { mode: "rest", user: userTag("user-b"), t: NOW - 1000 };
    expect(planPull(theirs, TAG, NOW).snapshot).toBe(true);
    expect(planPull(theirs, TAG, NOW).after).toBeNull();
  });

  test("a resting cursor reads after its boundary until it is older than tombstones are kept", () => {
    const fresh: PullCursor = { mode: "rest", user: TAG, t: NOW - CURSOR_MAX_AGE_MS };
    expect(planPull(fresh, TAG, NOW)).toEqual({ snapshot: false, after: { t: fresh.t, e: "", k: "" }, floor: null });
    const stale: PullCursor = { mode: "rest", user: TAG, t: NOW - CURSOR_MAX_AGE_MS - 1 };
    expect(planPull(stale, TAG, NOW)).toEqual({ snapshot: true, after: null, floor: NOW - PULL_SAFETY_LAG_MS });
    // The margin keeps the check strictly inside the retention period.
    expect(CURSOR_MAX_AGE_MS).toBeLessThan(60 * 24 * 60 * 60 * 1000);
  });

  test("a mid-run cursor expires by its floor; a mid-snapshot cursor is always continued", () => {
    const old = NOW - CURSOR_MAX_AGE_MS - 10;
    const inc: PullCursor = { mode: "inc", user: TAG, pos: key(NOW - 1000, "transactions", "t"), floor: old };
    expect(planPull(inc, TAG, NOW).snapshot).toBe(true);
    const snap: PullCursor = { mode: "snap", user: TAG, pos: key(old, "transactions", "t"), floor: old };
    // Restarting under a client that already wiped and applied half a snapshot
    // would leave it with the wrong half; the snapshot finishes instead.
    expect(planPull(snap, TAG, NOW)).toEqual({ snapshot: true, after: snap.pos, floor: old });
  });
});

describe("cutPage", () => {
  const incremental: PullPlan = { snapshot: false, after: { t: NOW - 60_000, e: "", k: "" }, floor: null };
  const H = NOW - PULL_SAFETY_LAG_MS;

  test("a last page settles on the horizon: rows written within the lag are sent again next time", () => {
    const read = [key(H - 10, "transactions", "a"), key(H + 2000, "transactions", "b")];
    const page = cutPage(read, 10, incremental, TAG, H);
    expect(page.hasMore).toBe(false);
    expect(page.items).toHaveLength(2);
    expect(page.cursor).toEqual({ mode: "rest", user: TAG, t: H });
    // "b" is newer than the cursor, so the next pull reads it again.
    expect(compareKeys(read[1]!, { t: H, e: "", k: "" })).toBeGreaterThan(0);
  });

  test("a full page below the horizon resumes after its last item with no floor", () => {
    const read = [key(H - 30, "accounts", "a"), key(H - 20, "transactions", "b"), key(H - 10, "transactions", "c")];
    const page = cutPage(read, 2, incremental, TAG, H);
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.cursor).toEqual({ mode: "inc", user: TAG, pos: key(H - 20, "transactions", "b"), floor: null });
  });

  test("once a page passes its horizon the run keeps that floor and settles on it", () => {
    const read = [key(H - 1, "transactions", "a"), key(H + 1, "transactions", "b"), key(H + 2, "transactions", "c")];
    const first = cutPage(read, 2, incremental, TAG, H);
    expect(first.cursor).toMatchObject({ mode: "inc", floor: H });

    const next = planPull(first.cursor, TAG, NOW + 3000);
    const second = cutPage([read[2]!], 2, next, TAG, H + 3000);
    // Not the later page's horizon: "b" may have had an uncommitted neighbour.
    expect(second.cursor).toEqual({ mode: "rest", user: TAG, t: H });
  });

  test("a snapshot pages with snapshot cursors and settles where it began", () => {
    const start = planPull(null, TAG, NOW);
    const read = [key(1, "settings", "settings"), key(2, "accounts", "a"), key(3, "transactions", "t")];
    const first = cutPage(read, 2, start, TAG, H);
    expect(first.cursor).toEqual({ mode: "snap", user: TAG, pos: key(2, "accounts", "a"), floor: H });

    const later = planPull(first.cursor, TAG, NOW + 60_000);
    const last = cutPage([read[2]!], 2, later, TAG, H + 60_000);
    // A row the first page sent and someone deleted since has a tombstone newer
    // than this, so the first incremental pull carries the deletion.
    expect(last.cursor).toEqual({ mode: "rest", user: TAG, t: H });
  });

  test("an empty page keeps the run moving to a resting cursor", () => {
    const page = cutPage([], 5, incremental, TAG, H);
    expect(page).toEqual({ items: [], hasMore: false, cursor: { mode: "rest", user: TAG, t: H } });
  });
});

test("keys order by time, then entity and id bytewise, as Postgres COLLATE \"C\" does", () => {
  const keys = [
    key(2, "accounts", "a"), key(1, "transactions", "b"), key(1, "transactions", "B"),
    key(1, "categories", "z"), key(1, "transactions", "é"), key(1, "transactions", "a"),
  ];
  const sorted = [...keys].sort(compareKeys).map((k) => `${k.t}/${k.e}/${k.k}`);
  expect(sorted).toEqual([
    "1/categories/z", "1/transactions/B", "1/transactions/a", "1/transactions/b", "1/transactions/é", "2/accounts/a",
  ]);
  // The boundary key sorts before every real item at the same time.
  for (const e of SYNC_ENTITIES) expect(compareKeys({ t: 1, e: "", k: "" }, key(1, e, "x"))).toBeLessThan(0);
});

/**
 * The property the cursor exists for, simulated: writes stamped at t become
 * visible at some commit time in [t, t + lag); a client pulls at arbitrary
 * times with a small page size. Every write must reach it, whatever the
 * interleaving — including a write stamped before rows the client already has.
 */
test("simulated late commits: a cursor never skips a row", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 40; trial++) {
    const items: (SyncKey & { visibleAt: number })[] = [];
    for (let i = 0; i < 60; i++) {
      const t = NOW + Math.floor(rand() * 20_000);
      const e = SYNC_ENTITIES[Math.floor(rand() * SYNC_ENTITIES.length)]!;
      items.push({ t, e, k: `id${i}`, visibleAt: t + Math.floor(rand() * (PULL_SAFETY_LAG_MS - 1)) });
    }
    const delivered = new Set<string>();
    let cursor: PullCursor | null = null;
    const limit = 1 + Math.floor(rand() * 7);
    for (let clock = NOW; clock <= NOW + 40_000; clock += Math.floor(rand() * 1500)) {
      // One run: pull until !hasMore, the clock moving a little per page.
      let at = clock;
      for (let pages = 0; pages < 500; pages++) {
        const plan = planPull(cursor, TAG, at);
        const read = items
          .filter((x) => x.visibleAt <= at && (plan.after === null || compareKeys(x, plan.after) > 0))
          .sort(compareKeys)
          .slice(0, limit + 1);
        const page = cutPage(read, limit, plan, TAG, at - PULL_SAFETY_LAG_MS);
        for (const x of page.items) delivered.add(x.k);
        cursor = page.cursor;
        at += Math.floor(rand() * 50);
        if (!page.hasMore) break;
      }
    }
    expect(delivered.size).toBe(items.length);
  }
});
