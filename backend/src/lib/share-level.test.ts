import { test, expect } from "bun:test";
import {
  projectMember,
  projectSharedAccountTransactions,
  normalizeShareLevel,
  SHARE_LEVELS,
  type MemberFinances,
  type MemberTransaction,
} from "./share-level";

const tx = (over: Partial<MemberTransaction> = {}): MemberTransaction => ({
  id: "t1",
  accountId: "acc_personal",
  amount: 40,
  type: "Expense",
  category: "Food",
  note: "therapy copay",
  dateISO: "2026-08-26",
  ...over,
});

const finances = (over: Partial<MemberFinances> = {}): MemberFinances => ({
  userId: "u1",
  name: "Sam",
  totalIn: 3000,
  totalOut: 1200,
  byCategory: { Food: 400, Health: 260, Transport: 90 },
  transactions: [tx(), tx({ id: "t2", category: "Health", note: "pharmacy" })],
  ...over,
});

// ── The floor ────────────────────────────────────────────────────────────────

test("summary reveals totals and nothing else", () => {
  const out = projectMember(finances(), "summary");
  expect(out.totalIn).toBe(3000);
  expect(out.totalOut).toBe(1200);
  expect(out.byCategory).toBeUndefined();
  expect(out.transactions).toBeUndefined();
});

test("a summary member leaks no category name anywhere in the payload", () => {
  // The assertion the feature turns on, made against the serialised bytes
  // rather than the shape — a field added later that happens to carry a
  // category would slip past a property-by-property check.
  const serialised = JSON.stringify(projectMember(finances(), "summary"));
  for (const category of ["Food", "Health", "Transport"]) {
    expect(serialised).not.toContain(category);
  }
  for (const note of ["therapy copay", "pharmacy"]) {
    expect(serialised).not.toContain(note);
  }
});

test("categories reveals per-category spend but no transaction", () => {
  const out = projectMember(finances(), "categories");
  expect(out.byCategory).toEqual({ Food: 400, Health: 260, Transport: 90 });
  expect(out.transactions).toBeUndefined();
  expect(JSON.stringify(out)).not.toContain("therapy copay");
});

test("full reveals transactions", () => {
  const out = projectMember(finances(), "full");
  expect(out.transactions).toHaveLength(2);
  expect(out.byCategory).toBeDefined();
});

// ── Failing closed ───────────────────────────────────────────────────────────

test("an unrecognised level is treated as summary, not as full", () => {
  // A null column, an older row, a newer client sending a level this build
  // does not know. Every one of them must fail towards revealing less.
  for (const junk of [null, undefined, "", "FULL", "everything", 3, {}, []]) {
    const out = projectMember(finances(), junk);
    expect(out.shareLevel).toBe("summary");
    expect(out.transactions).toBeUndefined();
    expect(out.byCategory).toBeUndefined();
  }
});

test("normalizeShareLevel accepts exactly the three levels", () => {
  for (const level of SHARE_LEVELS) expect(normalizeShareLevel(level)).toBe(level);
  expect(normalizeShareLevel("Summary")).toBe("summary");
});

test("the projection cannot be widened by the viewer", () => {
  // projectMember takes no viewer argument at all. This asserts the shape of
  // the contract: same input, same output, whoever is asking.
  expect(projectMember.length).toBe(2);
});

test("mutating the result cannot reach back into the source row", () => {
  const source = finances();
  const out = projectMember(source, "full");
  out.byCategory!.Food = 99999;
  out.transactions![0]!.note = "rewritten";
  expect(source.byCategory.Food).toBe(400);
  expect(source.transactions[0]!.note).toBe("therapy copay");
});

// ── Shared accounts ──────────────────────────────────────────────────────────

test("a shared account is visible in full even when the owner is on summary", () => {
  const transactions = [
    tx({ id: "j1", accountId: "acc_joint", note: "groceries" }),
    tx({ id: "p1", accountId: "acc_personal", note: "therapy copay" }),
  ];
  const shared = projectSharedAccountTransactions(transactions, new Set(["acc_joint"]));
  expect(shared.map((t) => t.id)).toEqual(["j1"]);
});

test("opting one account in does not expose the others", () => {
  // The failure that would matter: sharing the joint account quietly turning
  // into sharing everything, because the filter was on the member rather than
  // the account.
  const transactions = [
    tx({ id: "j1", accountId: "acc_joint", note: "groceries" }),
    tx({ id: "p1", accountId: "acc_personal", note: "therapy copay" }),
    tx({ id: "p2", accountId: null, note: "cash, unassigned" }),
  ];
  const serialised = JSON.stringify(
    projectSharedAccountTransactions(transactions, new Set(["acc_joint"]))
  );
  expect(serialised).not.toContain("therapy copay");
  expect(serialised).not.toContain("cash, unassigned");
});

test("a transaction with no account is never shared", () => {
  const shared = projectSharedAccountTransactions([tx({ accountId: null })], new Set(["acc_joint"]));
  expect(shared).toEqual([]);
});

test("no shared accounts means no shared transactions", () => {
  expect(projectSharedAccountTransactions([tx()], new Set())).toEqual([]);
});
