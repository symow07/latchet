import { test, expect } from "bun:test";
import {
  enforceRetention,
  INBOX_RETENTION_DAYS,
  CONFIRMATION_RETENTION_HOURS,
  EXPIRED_SESSION_GRACE_DAYS,
  type RetentionDeps,
} from "./retention";

const NOW = new Date("2026-08-19T12:00:00Z");

/** Records the cutoff each sweep was asked for, so the windows can be asserted. */
function spyDeps() {
  const cutoffs: Record<string, Date> = {};
  const deps: RetentionDeps = {
    async deleteInboxOlderThan(c) { cutoffs.inbox = c; return 3; },
    async deleteConfirmationsOlderThan(c) { cutoffs.confirmations = c; return 1; },
    async deleteSessionsExpiredBefore(c) { cutoffs.sessions = c; return 2; },
    async deleteVerificationsExpiredBefore(c) { cutoffs.verifications = c; return 4; },
  };
  return { deps, cutoffs };
}

const daysBefore = (from: Date, cutoff: Date) =>
  Math.round((from.getTime() - cutoff.getTime()) / 86_400_000);
const hoursBefore = (from: Date, cutoff: Date) =>
  Math.round((from.getTime() - cutoff.getTime()) / 3_600_000);

test("forwarded emails are kept for 90 days", () => {
  const { deps, cutoffs } = spyDeps();
  return enforceRetention(deps, NOW).then(() => {
    expect(daysBefore(NOW, cutoffs.inbox!)).toBe(INBOX_RETENTION_DAYS);
  });
});

test("confirmation codes are held for hours, not months", async () => {
  const { deps, cutoffs } = spyDeps();
  await enforceRetention(deps, NOW);

  expect(hoursBefore(NOW, cutoffs.confirmations!)).toBe(CONFIRMATION_RETENTION_HOURS);
  // The tighter window must actually be tighter than the general one.
  expect(cutoffs.confirmations!.getTime()).toBeGreaterThan(cutoffs.inbox!.getTime());
});

test("expired sessions are swept after a grace period", async () => {
  const { deps, cutoffs } = spyDeps();
  await enforceRetention(deps, NOW);
  expect(daysBefore(NOW, cutoffs.sessions!)).toBe(EXPIRED_SESSION_GRACE_DAYS);
});

test("spent one-time codes are swept the next day", async () => {
  const { deps, cutoffs } = spyDeps();
  await enforceRetention(deps, NOW);
  expect(hoursBefore(NOW, cutoffs.verifications!)).toBe(24);
});

test("every category is swept, and the counts are reported", async () => {
  const { deps } = spyDeps();
  expect(await enforceRetention(deps, NOW)).toEqual({
    inboxEmails: 3,
    confirmations: 1,
    sessions: 2,
    verifications: 4,
  });
});

test("confirmations are swept before the general inbox pass", async () => {
  // Otherwise the 90-day pass would already have claimed them and the tighter
  // window would never apply.
  const order: string[] = [];
  const deps: RetentionDeps = {
    async deleteConfirmationsOlderThan() { order.push("confirmations"); return 0; },
    async deleteInboxOlderThan() { order.push("inbox"); return 0; },
    async deleteSessionsExpiredBefore() { order.push("sessions"); return 0; },
    async deleteVerificationsExpiredBefore() { order.push("verifications"); return 0; },
  };

  await enforceRetention(deps, NOW);
  expect(order.indexOf("confirmations")).toBeLessThan(order.indexOf("inbox"));
});

test("a quiet run reports zeroes rather than failing", async () => {
  const deps: RetentionDeps = {
    async deleteInboxOlderThan() { return 0; },
    async deleteConfirmationsOlderThan() { return 0; },
    async deleteSessionsExpiredBefore() { return 0; },
    async deleteVerificationsExpiredBefore() { return 0; },
  };
  expect(await enforceRetention(deps, NOW)).toEqual({
    inboxEmails: 0, confirmations: 0, sessions: 0, verifications: 0,
  });
});
