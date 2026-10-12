import { test, expect } from "bun:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  enforceRetention,
  retentionDeps,
  INBOX_RETENTION_DAYS,
  CONFIRMATION_RETENTION_HOURS,
  EXPIRED_SESSION_GRACE_DAYS,
  type RetentionDeps,
} from "./retention";
import { TOMBSTONE_RETENTION_DAYS } from "../lib/sync/constants";

const NOW = new Date("2026-08-19T12:00:00Z");

/** Records the cutoff each sweep was asked for, so the windows can be asserted. */
function spyDeps() {
  const cutoffs: Record<string, Date> = {};
  const asked = { tombstoneDays: 0 };
  const deps: RetentionDeps = {
    async deleteInboxOlderThan(c) { cutoffs.inbox = c; return 3; },
    async deleteConfirmationsOlderThan(c) { cutoffs.confirmations = c; return 1; },
    async deleteSessionsExpiredBefore(c) { cutoffs.sessions = c; return 2; },
    async deleteVerificationsExpiredBefore(c) { cutoffs.verifications = c; return 4; },
    async deleteExpiredRateLimits() { return 5; },
    async deleteExpiredCacheEntries() { return 6; },
    async deleteTombstones(days) { asked.tombstoneDays = days; return 7; },
    async deleteOrphanFiles() { return 8; },
  };
  return { deps, cutoffs, asked };
}

const daysBefore = (from: Date, cutoff: Date) =>
  Math.round((from.getTime() - cutoff.getTime()) / 86_400_000);
const hoursBefore = (from: Date, cutoff: Date) =>
  Math.round((from.getTime() - cutoff.getTime()) / 3_600_000);

test("email findings are kept for 90 days from when they were stored", () => {
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
    rateLimits: 5,
    cacheEntries: 6,
    tombstones: 7,
    files: 8,
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
    async deleteExpiredRateLimits() { return 0; },
    async deleteExpiredCacheEntries() { return 0; },
    async deleteTombstones() { return 0; },
    async deleteOrphanFiles() { return 0; },
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
    async deleteExpiredRateLimits() { return 0; },
    async deleteExpiredCacheEntries() { return 0; },
    async deleteTombstones() { return 0; },
    async deleteOrphanFiles() { return 0; },
  };
  expect(await enforceRetention(deps, NOW)).toEqual({
    inboxEmails: 0, confirmations: 0, sessions: 0, verifications: 0,
    rateLimits: 0, cacheEntries: 0, tombstones: 0, files: 0,
  });
});

test("tombstones are kept exactly as long as a client can still pull deltas", async () => {
  const { deps, asked } = spyDeps();
  await enforceRetention(deps, NOW);
  expect(asked.tombstoneDays).toBe(TOMBSTONE_RETENTION_DAYS);
});

// ── The real sweeps, against Postgres ────────────────────────────────────────
//
// Run inside a transaction that is rolled back: the sweeps are global by
// design, and this database is shared with other suites, whose rows must not
// disappear because this test ran. Assertions are on this test's own rows.

class Rollback extends Error {}
async function rolledBack(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const R = `ret_${process.pid}_${Date.now().toString(36)}`;
const DAY = 24 * 60 * 60 * 1000;

test("the sweeps remove what has expired or lost its owner, and nothing else", async () => {
  await rolledBack(async (tx) => {
    const now = new Date();
    await tx.user.create({ data: { id: `${R}_u`, name: "r", email: `${R}@x.test`, updatedAt: now } });
    await tx.group.create({ data: { id: `${R}_g`, ownerId: `${R}_u`, name: "G", type: "business" } });

    await tx.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt") VALUES
        (${R + ":rl-old"}, 1, (now() AT TIME ZONE 'UTC') - interval '2 hours', (now() AT TIME ZONE 'UTC') - interval '1 hour'),
        (${R + ":rl-live"}, 1, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC') + interval '1 hour')`;
    await tx.$executeRaw`
      INSERT INTO "CacheEntry" ("key", "value", "expiresAt") VALUES
        (${R + ":c-old"}, '1'::jsonb, (now() AT TIME ZONE 'UTC') - interval '1 second'),
        (${R + ":c-live"}, '1'::jsonb, (now() AT TIME ZONE 'UTC') + interval '1 hour')`;
    await tx.syncTombstone.createMany({
      data: [
        { userId: `${R}_u`, entity: "transactions", syncId: `${R}-old`, deletedAt: new Date(now.getTime() - 61 * DAY) },
        { userId: `${R}_u`, entity: "transactions", syncId: `${R}-recent`, deletedAt: now },
        { userId: `${R}_gone`, entity: "transactions", syncId: `${R}-orphan`, deletedAt: now },
      ],
    });
    const file = (id: string, kind: string, ownerId: string) => ({
      id, kind, ownerId, contentType: "image/png", size: 1, bytes: Buffer.from([1]),
    });
    await tx.storedFile.createMany({
      data: [
        file(`receipts/${R}_g/${R}_gone`, "receipt", `${R}_gone`),
        file(`logos/${R}_gone`, "logo", `${R}_gone`),
        file(`logos/${R}_g`, "logo", `${R}_g`),
      ],
    });

    const deps = retentionDeps(tx);
    await deps.deleteExpiredRateLimits();
    await deps.deleteExpiredCacheEntries();
    await deps.deleteTombstones(TOMBSTONE_RETENTION_DAYS);
    await deps.deleteOrphanFiles();

    const keys = async (rows: Promise<{ key: string }[]>) => (await rows).map((r) => r.key).sort();
    expect(await keys(tx.rateLimitBucket.findMany({ where: { key: { startsWith: R } } }))).toEqual([`${R}:rl-live`]);
    expect(await keys(tx.cacheEntry.findMany({ where: { key: { startsWith: R } } }))).toEqual([`${R}:c-live`]);
    const tombs = await tx.syncTombstone.findMany({ where: { syncId: { startsWith: R } } });
    expect(tombs.map((t) => t.syncId)).toEqual([`${R}-recent`]);
    const files = await tx.storedFile.findMany({ where: { OR: [{ id: { contains: R } }] } });
    expect(files.map((f) => f.id)).toEqual([`logos/${R}_g`]);
  });
});
