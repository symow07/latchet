import { describe, expect, test } from "bun:test";
import { legacyDecision, resolveSubscriptionWrite, type Phase6SubscriptionColumns } from "./subscription-fields";
import { parsePushRow } from "./schemas";

const stored = (over: Partial<Phase6SubscriptionColumns> = {}): Phase6SubscriptionColumns => ({
  decision: null, canceledAt: null, trialEndsAt: null, previousAmount: null, priceChangedAt: null,
  alert: null, sources: "", billedVia: null, ...over,
});

describe("resolveSubscriptionWrite", () => {
  test("a Phase 6 push writes every field as sent, nulls included, and the status follows its decision", () => {
    const got = resolveSubscriptionWrite(
      {
        status: "active", source: "transaction", decision: "cancel", canceledAt: "2026-10-01", trialEndsAt: null,
        previousAmount: 9.99, priceChangedAt: "2026-09-03", alert: "charged_after_cancel", sources: "transaction,email",
        billedVia: "apple",
      },
      stored({ decision: "keep", trialEndsAt: "2026-09-01", alert: "price_rise", sources: "transaction" })
    );
    expect(got).toEqual({
      decision: "cancel", canceledAt: "2026-10-01", trialEndsAt: null, previousAmount: 9.99, priceChangedAt: "2026-09-03",
      alert: "charged_after_cancel", sources: "transaction,email", billedVia: "apple", status: "canceled",
    });
  });

  test("a field an older phone leaves out keeps the stored value, and its stale status cannot move a decision", () => {
    const kept = stored({
      decision: "dismiss", trialEndsAt: "2026-11-01", previousAmount: 12, priceChangedAt: "2026-10-01",
      alert: "price_rise", sources: "transaction,email", billedVia: "google_play",
    });
    // A Phase 5 detector rewrote the dismissed row as "possible": it stays dismissed.
    expect(resolveSubscriptionWrite({ status: "possible", source: "transaction" }, kept)).toEqual({ ...kept, status: "dismissed" });
    // Its "confirmed" cannot overturn a decision made on a newer phone either.
    expect(resolveSubscriptionWrite({ status: "confirmed", source: "transaction" }, kept).decision).toBe("dismiss");
  });

  test("where no decision was made, an older phone's confirmed or canceled is one, as the migration read it", () => {
    expect(resolveSubscriptionWrite({ status: "confirmed", source: "email" }, stored())).toMatchObject({ decision: "keep", status: "confirmed" });
    expect(resolveSubscriptionWrite({ status: "canceled", source: "email" }, stored())).toMatchObject({
      decision: "cancel", status: "canceled", canceledAt: null,
    });
    expect(resolveSubscriptionWrite({ status: "possible", source: "email" }, stored())).toMatchObject({ decision: null, status: "possible" });
    expect([legacyDecision("confirmed"), legacyDecision("canceled"), legacyDecision("possible"), legacyDecision("active")])
      .toEqual(["keep", "cancel", null, null]);
  });

  test("a new row from an older phone starts with its sources from source and nothing else set", () => {
    expect(resolveSubscriptionWrite({ status: "possible", source: "email" }, null)).toEqual({
      ...stored({ sources: "email" }), status: "possible",
    });
  });

  test("a newer phone taking its decision back (null) is applied, and the engine's status returns", () => {
    expect(resolveSubscriptionWrite({ status: "possible", source: "transaction", decision: null }, stored({ decision: "keep" })))
      .toMatchObject({ decision: null, status: "possible" });
  });
});

describe("subscription push rows", () => {
  const row = {
    id: "sub_1", clientUpdatedAt: "2026-10-11T08:00:00.000Z", merchantDisplay: "Netflix", merchantNormalized: "netflix",
    cadence: "monthly", typicalAmount: 15.49, currency: "EUR", confidenceScore: 0.9, lastChargedAt: "2026-10-03",
    nextExpectedAt: "2026-11-03", status: "active", cancelUrl: null, cancelNotes: null, source: "bank",
    createdAt: "2026-10-01T08:00:00.000Z",
  };
  const phase6 = {
    decision: "keep", canceledAt: null, trialEndsAt: "2026-10-20", previousAmount: 13.49, priceChangedAt: "2026-10-03",
    alert: "price_rise", sources: "bank,email", billedVia: "paypal",
  };

  test("a Phase 6 row parses with every field; a Phase 5 row parses without them, leaving them undefined", () => {
    const full = parsePushRow("subscriptions", { ...row, ...phase6 });
    expect(full.ok && !full.row.deleted && full.row.values).toMatchObject(phase6);
    const old = parsePushRow("subscriptions", { ...row, status: "confirmed", source: "transaction" });
    expect(old.ok).toBe(true);
    if (old.ok && !old.row.deleted) {
      for (const f of Object.keys(phase6)) expect((old.row.values as Record<string, unknown>)[f]).toBeUndefined();
    }
  });

  test("an unknown decision, alert or billing channel, an impossible date or a malformed source list is invalid", () => {
    for (const bad of [
      { decision: "maybe" }, { alert: "panic" }, { billedVia: "venmo" }, { canceledAt: "2026-02-30" },
      { trialEndsAt: "soon" }, { priceChangedAt: "2026-10-03T00:00:00Z" }, { previousAmount: -1 },
      { sources: "Bank" }, { sources: "bank,,email" }, { sources: ",bank" }, { status: "kept" }, { source: "" },
      { source: "bank,email" },
    ]) {
      expect(parsePushRow("subscriptions", { ...row, ...phase6, ...bad })).toEqual({ ok: false, id: "sub_1" });
    }
  });
});
