import { test, expect, afterAll } from "bun:test";
import { prisma } from "../prisma";
import { dueBefore, emailSyncJobDeps, runEmailSyncTick, EMAIL_SYNC_BATCH, type EmailSyncJobDeps } from "./email-sync";
import { gmailProvider } from "../lib/email-providers/gmail";
import { processCipher } from "../lib/email-providers";
import { cleanupUsers, startFake, testUser, TEST_CONFIG } from "../lib/email-providers/test-fakes";

const P = `ejob${process.pid}${Date.now().toString(36)}`;
afterAll(() => cleanupUsers(P));

test("inbox sync: the job's cutoff leaves a grace, so what the last tick synced is due at this one", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  // Hourly: synced 56 minutes ago (the last tick ran a little late) is due.
  expect(dueBefore(now, 60).toISOString()).toBe("2026-10-13T11:05:00.000Z");
  // A short interval never waits less than half of it.
  expect(dueBefore(now, 5).toISOString()).toBe("2026-10-13T11:57:30.000Z");
});

test("inbox sync: a tick syncs what is due one connection at a time, and one failure stops nothing", async () => {
  const synced: string[] = [];
  const deps: EmailSyncJobDeps = {
    now: async () => new Date("2026-10-13T12:00:00Z"),
    async listDue(before, limit) {
      expect(before.toISOString()).toBe("2026-10-13T11:05:00.000Z");
      expect(limit).toBe(EMAIL_SYNC_BATCH);
      return ["a", "b", "c", "d"];
    },
    async syncOne(id) {
      synced.push(id);
      if (id === "b") throw new Error("boom");
      if (id === "c") return { ran: false, reason: "busy" };
      return { ran: true, phase: "incremental", scanned: 0, stored: 0, complete: true, error: null };
    },
  };
  expect(await runEmailSyncTick(deps, 60)).toEqual({ due: 4, synced: 2, busy: 1 });
  expect(synced).toEqual(["a", "b", "c", "d"]);

  const stop = new AbortController();
  stop.abort();
  expect(await runEmailSyncTick(deps, 60, stop.signal)).toEqual({ due: 4, synced: 0, busy: 0 });
});

test("inbox sync: the job picks never-synced and stale inboxes first, and skips the rest", async () => {
  const u = await testUser(P, "job");
  const fake = startFake({});
  const deps = emailSyncJobDeps({ providers: { gmail: gmailProvider(TEST_CONFIG.google!, fake.http), outlook: null }, cipher: processCipher });
  const enc = processCipher.encrypt("g-refresh-job");
  const hour = 3600_000;
  const mk = (label: string, data: Record<string, unknown>) =>
    prisma.emailConnection.create({ data: { userId: u.id, provider: "gmail", email: `${label}@gmail.com`, refreshTokenEnc: enc, ...data } });
  const never = await mk("never", { lastSyncedAt: null });
  const stale = await mk("stale", { lastSyncedAt: new Date(Date.now() - 5 * hour) });
  const lessStale = await mk("lessstale", { lastSyncedAt: new Date(Date.now() - 2 * hour) });
  const fresh = await mk("fresh", { lastSyncedAt: new Date(Date.now() - 10 * 60_000) });
  const reauth = await mk("reauth", { lastSyncedAt: null, status: "needs_reauth" });
  const errored = await mk("errored", { lastSyncedAt: new Date(Date.now() - 3 * hour), status: "error" });
  const outlook = await prisma.emailConnection.create({ data: { userId: u.id, provider: "outlook", email: "o@outlook.com", refreshTokenEnc: enc } });
  const forwarding = await prisma.emailConnection.create({ data: { userId: u.id, provider: "forwarding", email: `forwarding:${u.id}`, inboundToken: `tok${P}`.slice(0, 30) } });

  const due = await deps.listDue(dueBefore(await deps.now(), 60), 1000);
  const mine = due.filter((id) => [never, stale, lessStale, fresh, reauth, errored, outlook, forwarding].some((c) => c.id === id));
  expect(mine).toEqual([never.id, stale.id, errored.id, lessStale.id]);
  expect((await deps.listDue(dueBefore(await deps.now(), 60), 2)).length).toBeLessThanOrEqual(2);
});
