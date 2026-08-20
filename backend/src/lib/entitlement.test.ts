import { test, expect } from "bun:test";
import {
  isPro,
  applyWebhookEvent,
  parseWebhookEvent,
  aiAllowance,
  FREE,
  FREE_AI_CALLS_PER_DAY,
  PRO_AI_DAILY_MAX,
  type EntitlementState,
} from "./entitlement";

const NOW = new Date("2026-08-19T12:00:00Z");
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const pro = (expiresAt: Date | null): EntitlementState => ({ tier: "pro", expiresAt });

const event = (over: Partial<Record<string, unknown>> = {}) => ({
  event: {
    type: "INITIAL_PURCHASE",
    app_user_id: "user_1",
    entitlement_ids: ["pro"],
    expiration_at_ms: later(30).getTime(),
    ...over,
  },
});

// ── Reading the state ────────────────────────────────────────────────────────

test("a free user is never pro", () => {
  expect(isPro(FREE, NOW)).toBe(false);
});

test("an unexpired pro entitlement is active", () => {
  expect(isPro(pro(later(5)), NOW)).toBe(true);
});

test("an expired entitlement is not pro, even though the tier says so", () => {
  // A missed EXPIRATION webhook must not leave someone on Pro forever, so the
  // date is read rather than the tier trusted.
  expect(isPro(pro(later(-1)), NOW)).toBe(false);
});

test("pro with no known expiry is treated as active", () => {
  expect(isPro(pro(null), NOW)).toBe(true);
});

// ── The webhook state machine ────────────────────────────────────────────────

test("a purchase grants pro until the stated expiry", () => {
  const parsed = parseWebhookEvent(event())!;
  expect(applyWebhookEvent(parsed, FREE, NOW)).toEqual({
    tier: "pro",
    expiresAt: later(30),
  });
});

test("a renewal extends the expiry", () => {
  const parsed = parseWebhookEvent(
    event({ type: "RENEWAL", expiration_at_ms: later(60).getTime() })
  )!;
  expect(applyWebhookEvent(parsed, pro(later(30)), NOW)!.expiresAt).toEqual(later(60));
});

test("cancellation does NOT revoke access", () => {
  // Cancelling means auto-renew is off. The user has paid through the end of
  // the period, and taking it away early would be taking time they bought.
  const parsed = parseWebhookEvent(event({ type: "CANCELLATION" }))!;
  const next = applyWebhookEvent(parsed, pro(later(30)), NOW)!;

  expect(next.tier).toBe("pro");
  expect(isPro(next, NOW)).toBe(true);
});

test("cancellation with no expiry in the payload keeps the one we had", () => {
  const parsed = parseWebhookEvent(
    event({ type: "CANCELLATION", expiration_at_ms: null })
  )!;
  expect(applyWebhookEvent(parsed, pro(later(12)), NOW)!.expiresAt).toEqual(later(12));
});

test("a billing issue is a warning, not the end of the grace period", () => {
  const parsed = parseWebhookEvent(event({ type: "BILLING_ISSUE" }))!;
  expect(isPro(applyWebhookEvent(parsed, pro(later(3)), NOW)!, NOW)).toBe(true);
});

test("expiration is what actually ends access", () => {
  const parsed = parseWebhookEvent(event({ type: "EXPIRATION" }))!;
  expect(applyWebhookEvent(parsed, pro(later(30)), NOW)).toEqual(FREE);
});

test("uncancellation restores pro", () => {
  const parsed = parseWebhookEvent(event({ type: "UNCANCELLATION" }))!;
  expect(applyWebhookEvent(parsed, pro(later(30)), NOW)!.tier).toBe("pro");
});

test("an event for a different entitlement is ignored", () => {
  const parsed = parseWebhookEvent(event({ entitlement_ids: ["some_other_tier"] }))!;
  expect(applyWebhookEvent(parsed, FREE, NOW)).toBeNull();
});

test("an unknown event type leaves the row alone", () => {
  const parsed = parseWebhookEvent(event({ type: "TRANSFER" }))!;
  expect(applyWebhookEvent(parsed, pro(later(30)), NOW)).toBeNull();
});

// ── Parsing ──────────────────────────────────────────────────────────────────

test("the fields we act on are extracted", () => {
  expect(parseWebhookEvent(event())).toEqual({
    type: "INITIAL_PURCHASE",
    appUserId: "user_1",
    expiresAtMs: later(30).getTime(),
    entitlementIds: ["pro"],
  });
});

test("a singular entitlement_id is accepted too", () => {
  const parsed = parseWebhookEvent(
    event({ entitlement_ids: undefined, entitlement_id: "pro" })
  )!;
  expect(parsed.entitlementIds).toEqual(["pro"]);
});

test("malformed bodies parse to null rather than throwing", () => {
  expect(parseWebhookEvent(null)).toBeNull();
  expect(parseWebhookEvent({})).toBeNull();
  expect(parseWebhookEvent({ event: {} })).toBeNull();
  expect(parseWebhookEvent("nope")).toBeNull();
});

// ── Allowances ───────────────────────────────────────────────────────────────

test("free gets a taste, pro gets the real budget", () => {
  expect(aiAllowance(false).dailyMax).toBe(FREE_AI_CALLS_PER_DAY);
  expect(aiAllowance(true).dailyMax).toBe(PRO_AI_DAILY_MAX);
});

test("a free user cannot burst past their daily allowance", () => {
  const free = aiAllowance(false);
  expect(free.burstMax).toBeLessThanOrEqual(free.dailyMax);
});
