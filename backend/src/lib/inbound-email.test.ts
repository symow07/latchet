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

// ── Subject sanitising ───────────────────────────────────────────────────────

import { sanitizeSubjectLabel, senderDomain } from "./inbound-email";

test("order numbers and amounts are stripped from the label", () => {
  // The exact shape the policy promised we would not keep.
  expect(sanitizeSubjectLabel("Your receipt for order #114-2937461 — $84.32")).toBe(
    "Your receipt for order"
  );
});

test("the merchant-identifying words survive", () => {
  expect(sanitizeSubjectLabel("Netflix subscription renewal")).toBe(
    "Netflix subscription renewal"
  );
  expect(sanitizeSubjectLabel("Your Spotify Premium invoice")).toBe(
    "Your Spotify Premium invoice"
  );
});

test("account fragments and invoice references do not survive", () => {
  expect(sanitizeSubjectLabel("Invoice INV-99213 for account ending 4412")).not.toMatch(/\d/);
  expect(sanitizeSubjectLabel("Payment of £12.99 received")).not.toMatch(/\d/);
});

test("no digit ever survives, whatever the shape", () => {
  for (const s of [
    "Receipt 2026-08-19",
    "Order no. 8891123",
    "Your card ending in 0042 was charged",
    "Renewal — 1 year — €119,88",
  ]) {
    expect(sanitizeSubjectLabel(s)).not.toMatch(/\d/);
  }
});

test("labels are capped and never end mid-word", () => {
  const long = "Thank you for your purchase from the wonderful and extremely verbose merchant name";
  const label = sanitizeSubjectLabel(long, 40);

  expect(label.length).toBeLessThanOrEqual(40);
  expect(long.startsWith(label)).toBe(true);
  expect(label.endsWith(" ")).toBe(false);
});

test("orphaned punctuation is trimmed", () => {
  expect(sanitizeSubjectLabel("Receipt — #12345")).toBe("Receipt");
  expect(sanitizeSubjectLabel("  - Invoice 900 -  ")).toBe("Invoice");
});

test("an empty or all-numeric subject yields an empty label", () => {
  expect(sanitizeSubjectLabel("")).toBe("");
  expect(sanitizeSubjectLabel("   ")).toBe("");
  expect(sanitizeSubjectLabel("#4402911")).toBe("");
});

test("the sender domain identifies the merchant without the address", () => {
  expect(senderDomain("billing@netflix.com")).toBe("netflix.com");
  expect(senderDomain("Netflix <no-reply@netflix.com>")).toBe("netflix.com");
  expect(senderDomain("receipts@mail.spotify.co.uk")).toBe("mail.spotify.co.uk");
  expect(senderDomain("BILLING@Netflix.COM")).toBe("netflix.com");
});

test("a malformed sender yields nothing rather than garbage", () => {
  expect(senderDomain("not an address")).toBeNull();
  expect(senderDomain("")).toBeNull();
});
