import { test, expect } from "bun:test";
import { transactionId, bankAccountId } from "./bank-sync";

test("local ids are namespaced by provider", () => {
  expect(transactionId("saltedge", "abc")).toBe("saltedge_abc");
  expect(bankAccountId("saltedge", "abc")).toBe("acc_saltedge_abc");
});

test("Plaid ids keep the exact format rows were already written with", () => {
  // The refactor must not orphan existing rows: before the abstraction these
  // were built inline as `plaid_${transaction_id}` and `acc_plaid_${account_id}`.
  expect(transactionId("plaid", "tx_123")).toBe("plaid_tx_123");
  expect(bankAccountId("plaid", "acct_123")).toBe("acc_plaid_acct_123");
});

test("two providers cannot collide on the same external id", () => {
  expect(transactionId("plaid", "1")).not.toBe(transactionId("truelayer", "1"));
});
