import { describe, test, expect } from "bun:test";
import { accountsAfter, decide, planBatch, resolveAccountId, type BatchRow, type KeyState } from "./conflict";

const ME = "user-me";
const OTHER = "user-other";
const up = (id: string, cu: number, values = { v: cu }): BatchRow<{ v: number }> =>
  ({ ok: true, row: { id, clientUpdatedAt: cu, deleted: false, values } });
const del = (id: string, cu: number): BatchRow<{ v: number }> =>
  ({ ok: true, row: { id, clientUpdatedAt: cu, deleted: true } });
const live = (cu: number, owner = ME): KeyState => ({ live: { owner, cu }, tomb: null });
const tomb = (cu: number): KeyState => ({ live: null, tomb: cu });

describe("decide", () => {
  test("a newer write wins; an older one or one at the same instant is stale (ties go to the server)", () => {
    expect(decide(live(100), { clientUpdatedAt: 101, deleted: false }, ME).status).toBe("applied");
    expect(decide(live(100), { clientUpdatedAt: 99, deleted: false }, ME).status).toBe("stale");
    expect(decide(live(100), { clientUpdatedAt: 100, deleted: false }, ME).status).toBe("stale");
    expect(decide(live(100), { clientUpdatedAt: 100, deleted: true }, ME).status).toBe("stale");
  });

  test("an id that is another user's is forbidden, for an edit and a delete alike, at any time", () => {
    for (const deleted of [false, true]) {
      const r = decide(live(5, OTHER), { clientUpdatedAt: 10_000, deleted }, ME);
      expect(r.status).toBe("forbidden");
      expect(r.next).toEqual(live(5, OTHER));
    }
  });

  test("an epoch-dated default never beats a stored row, but creates one where there is none", () => {
    expect(decide(live(Date.parse("2026-01-01T00:00:00Z")), { clientUpdatedAt: 0, deleted: false }, ME).status).toBe("stale");
    expect(decide({ live: null, tomb: null }, { clientUpdatedAt: 0, deleted: false }, ME).status).toBe("applied");
    // Two fresh devices' defaults: the second is a tie, and the server keeps the first.
    expect(decide(live(0), { clientUpdatedAt: 0, deleted: false }, ME).status).toBe("stale");
  });

  test("a delete records its own time; only a later write resurrects the row", () => {
    const deleted = decide(live(100), { clientUpdatedAt: 200, deleted: true }, ME);
    expect(deleted).toEqual({ status: "applied", next: tomb(200) });
    expect(decide(deleted.next, { clientUpdatedAt: 150, deleted: false }, ME).status).toBe("stale");
    expect(decide(deleted.next, { clientUpdatedAt: 200, deleted: false }, ME).status).toBe("stale");
    expect(decide(deleted.next, { clientUpdatedAt: 201, deleted: false }, ME)).toEqual({ status: "applied", next: live(201) });
  });

  test("a live row is the current state even when an older tombstone survives beside it", () => {
    const both: KeyState = { live: { owner: ME, cu: 300 }, tomb: 500 };
    expect(decide(both, { clientUpdatedAt: 301, deleted: false }, ME)).toEqual({ status: "applied", next: live(301) });
    // Deleting keeps the larger of the two times on the tombstone.
    expect(decide(both, { clientUpdatedAt: 301, deleted: true }, ME).next).toEqual(tomb(500));
  });
});

describe("planBatch", () => {
  test("statuses come back one per row, in order, invalid rows included", () => {
    const plan = planBatch(
      [up("a", 10), { ok: false, id: "bad" }, up("b", 1), del("c", 7)],
      new Map([["b", live(5)]]),
      ME
    );
    expect(plan.results).toEqual([
      { id: "a", status: "applied" }, { id: "bad", status: "invalid" }, { id: "b", status: "stale" }, { id: "c", status: "applied" },
    ]);
    expect(plan.ops).toEqual([
      { kind: "insert", id: "a", cu: 10, values: { v: 10 }, dropTombstone: false },
      { kind: "tombstone", id: "c", cu: 7 },
    ]);
  });

  test("an edit then a delete of the same row in one push is one delete at the delete's time", () => {
    const plan = planBatch([up("x", 20), del("x", 30)], new Map([["x", live(10)]]), ME);
    expect(plan.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(plan.ops).toEqual([{ kind: "delete", id: "x", cu: 30 }]);
  });

  test("a delete then an older edit in one push: the edit is stale and the delete stands", () => {
    const plan = planBatch([del("x", 30), up("x", 20)], new Map([["x", live(10)]]), ME);
    expect(plan.results.map((r) => r.status)).toEqual(["applied", "stale"]);
    expect(plan.ops).toEqual([{ kind: "delete", id: "x", cu: 30 }]);
  });

  test("deleted and re-created with the same id in one push: the row is simply updated", () => {
    const plan = planBatch([del("x", 30), up("x", 40, { v: 99 })], new Map([["x", live(10)]]), ME);
    expect(plan.ops).toEqual([{ kind: "update", id: "x", cu: 40, values: { v: 99 }, dropTombstone: false }]);
  });

  test("created and deleted in one push never touches the table, only the tombstone", () => {
    const plan = planBatch([up("n", 5), del("n", 6)], new Map(), ME);
    expect(plan.ops).toEqual([{ kind: "tombstone", id: "n", cu: 6 }]);
  });

  test("resurrecting over a tombstone inserts and removes the tombstone", () => {
    const plan = planBatch([up("r", 50)], new Map([["r", tomb(40)]]), ME);
    expect(plan.ops).toEqual([{ kind: "insert", id: "r", cu: 50, values: { v: 50 }, dropTombstone: true }]);
  });
});

describe("accounts referenced by transactions", () => {
  test("an account is linkable when the caller owns it once this push's accounts are applied", () => {
    const own = accountsAfter(new Set(["kept", "dropped"]), [
      { kind: "insert", id: "new", cu: 1, values: {}, dropTombstone: false },
      { kind: "delete", id: "dropped", cu: 1 },
      { kind: "tombstone", id: "never", cu: 1 },
    ]);
    expect([...own].sort()).toEqual(["kept", "new"]);
    expect(resolveAccountId("kept", own)).toBe("kept");
    expect(resolveAccountId("new", own)).toBe("new");
    // Deleted in this push, unknown, someone else's, or blank: kept unlinked.
    expect(resolveAccountId("dropped", own)).toBeNull();
    expect(resolveAccountId("someone-elses", own)).toBeNull();
    expect(resolveAccountId("", own)).toBeNull();
    expect(resolveAccountId(null, own)).toBeNull();
  });
});
