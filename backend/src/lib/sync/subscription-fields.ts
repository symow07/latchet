/**
 * A synced subscription's Phase 6 fields, and how a push writes them
 * (I-SCHEMA and I-SYNC in .unlazy/phase6/PLAN.md).
 *
 * A subscription row carries the user's `decision` (keep | cancel | dismiss)
 * beside the engine's `status`, and while there is a decision the status
 * follows it. The fields Phase 6 added travel both ways, but a phone that
 * predates them sends rows without them, and a row is otherwise replaced
 * whole: so a field a push leaves out keeps what the server holds rather than
 * becoming null (absent = unchanged). For the decision that is not quite
 * enough. A Phase 5 phone still expresses its user's choice in `status`, as
 * the Phase 6 migration read it: confirmed was "keep", canceled "cancel". Such
 * a choice becomes the decision where none was made yet; a decision already
 * made, on a newer phone, stands — an older phone cannot see it, and its
 * detector rewriting a dismissed row as "possible" must not revive it.
 *
 * Dependency-free: imported by schemas.ts (which the root contract test loads
 * on its own) and push.ts, and tested without a database.
 */

export const SUBSCRIPTION_DECISIONS = ["keep", "cancel", "dismiss"] as const;
export type SubscriptionDecision = (typeof SUBSCRIPTION_DECISIONS)[number];

/**
 * Every status a row may carry: the engine's four, and the three that follow
 * a decision. Phase 5's were confirmed, possible and canceled.
 */
export const SUBSCRIPTION_STATUSES = [
  "possible", "active", "trial", "ended", "confirmed", "canceled", "dismissed",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The status that follows each decision. */
export const DECISION_STATUS: Readonly<Record<SubscriptionDecision, SubscriptionStatus>> = {
  keep: "confirmed",
  cancel: "canceled",
  dismiss: "dismissed",
};

export const SUBSCRIPTION_ALERTS = ["price_rise", "charged_after_cancel", "trial_ending"] as const;
export const BILLED_VIA = ["apple", "google_play", "paypal"] as const;

/** Where a subscription was seen. `source` is one of these; `sources` a comma list of them. */
export const SUBSCRIPTION_SOURCES = ["transaction", "import", "bank", "email", "manual"] as const;

/** The fields Phase 6 added to a synced subscription, in wire order. */
export const PHASE6_SUBSCRIPTION_FIELDS = [
  "decision", "canceledAt", "trialEndsAt", "previousAmount", "priceChangedAt", "alert", "sources", "billedVia",
] as const;
export type Phase6SubscriptionField = (typeof PHASE6_SUBSCRIPTION_FIELDS)[number];

/** The Phase 6 columns as stored. */
export interface Phase6SubscriptionColumns {
  decision: string | null;
  canceledAt: string | null;
  trialEndsAt: string | null;
  previousAmount: number | null;
  priceChangedAt: string | null;
  alert: string | null;
  sources: string;
  billedVia: string | null;
}

/** A pushed row's values, as far as this merge reads them: Phase 6 fields may be absent. */
export type PushedSubscriptionFields = { status: string; source: string } & {
  [F in Phase6SubscriptionField]?: Phase6SubscriptionColumns[F];
};

/** What a push writes: the Phase 6 columns and the status. */
export type ResolvedSubscriptionColumns = Phase6SubscriptionColumns & { status: string };

function isDecision(value: unknown): value is SubscriptionDecision {
  return typeof value === "string" && (SUBSCRIPTION_DECISIONS as readonly string[]).includes(value);
}

/** A Phase 5 status read as the decision it stood for, as the migration read it. */
export function legacyDecision(status: string): SubscriptionDecision | null {
  if (status === "confirmed") return "keep";
  if (status === "canceled") return "cancel";
  return null;
}

/**
 * The columns a pushed subscription row is stored with. `stored` is the live
 * row's Phase 6 columns, or null for a row the push creates.
 *
 *   - A Phase 6 field the push carries (null included) is written as sent.
 *   - One it leaves out keeps the stored value; on a new row it takes the
 *     column default, except `sources`, which starts as `source`.
 *   - A push without `decision` keeps the stored decision, or, where there is
 *     none yet, takes the one its Phase 5 status stood for.
 *   - Whatever the push said, while there is a decision the status follows it.
 */
export function resolveSubscriptionWrite(
  sent: PushedSubscriptionFields,
  stored: Phase6SubscriptionColumns | null
): ResolvedSubscriptionColumns {
  const pick = <F extends Phase6SubscriptionField>(field: F, fallback: Phase6SubscriptionColumns[F]) =>
    (sent[field] !== undefined ? sent[field] : stored ? stored[field] : fallback) as Phase6SubscriptionColumns[F];

  const decision =
    sent.decision !== undefined ? sent.decision : (stored?.decision ?? legacyDecision(sent.status));

  return {
    decision,
    canceledAt: pick("canceledAt", null),
    trialEndsAt: pick("trialEndsAt", null),
    previousAmount: pick("previousAmount", null),
    priceChangedAt: pick("priceChangedAt", null),
    alert: pick("alert", null),
    sources: pick("sources", sent.source),
    billedVia: pick("billedVia", null),
    status: isDecision(decision) ? DECISION_STATUS[decision] : sent.status,
  };
}
