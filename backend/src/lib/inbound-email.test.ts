import { test, expect } from "bun:test";
import { parseInboundToken, isGmailForwardConfirm, extractConfirmationCode } from "./inbound-email";

// ── parseInboundToken ────────────────────────────────────────────────────────

test("extracts token from a bare address", () => {
  expect(parseInboundToken("u_ab12cd34@in.example.com")).toBe("ab12cd34");
});

test("extracts token from a display-name form", () => {
  expect(parseInboundToken('"Budget Inbox" <u_ff00aa11@in.example.com>')).toBe("ff00aa11");
});

test("lowercases mixed-case tokens (addresses are case-insensitive)", () => {
  expect(parseInboundToken("U_AB12CD34@in.example.com")).toBe("ab12cd34");
});

test("returns null for non-matching recipients", () => {
  expect(parseInboundToken("someone@example.com")).toBeNull();
  expect(parseInboundToken("")).toBeNull();
  expect(parseInboundToken("user_x@example.com")).toBeNull();
});

// ── isGmailForwardConfirm ────────────────────────────────────────────────────

test("detects Gmail confirmation by sender", () => {
  expect(isGmailForwardConfirm("forwarding-noreply@google.com", "anything")).toBe(true);
  expect(isGmailForwardConfirm("Gmail Team <forwarding-noreply@google.com>", "x")).toBe(true);
});

test("detects Gmail confirmation by subject", () => {
  expect(isGmailForwardConfirm("other@x.com", "Gmail Forwarding Confirmation - Receive Mail")).toBe(true);
});

test("regular receipts are not confirmations", () => {
  expect(isGmailForwardConfirm("billing@netflix.com", "Your Netflix receipt")).toBe(false);
});

// ── extractConfirmationCode ──────────────────────────────────────────────────

test("pulls the numeric code from subject or body", () => {
  expect(extractConfirmationCode("(#584031299) Gmail Forwarding Confirmation", "")).toBe("584031299");
  expect(extractConfirmationCode("Confirmation", "your code is 123456 — enter it in Gmail")).toBe("123456");
});

test("ignores short numbers and returns null when absent", () => {
  expect(extractConfirmationCode("Order 42", "totally 99 problems")).toBeNull();
});
