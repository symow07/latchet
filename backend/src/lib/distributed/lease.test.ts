import { test, expect, afterAll } from "bun:test";
import { prisma } from "../../prisma";
import { acquireLease, releaseLease, renewLease, withJobLease } from "./lease";

const RUN = `lease-${process.pid}-${Date.now().toString(36)}`;
const name = (n: string) => `${RUN}:${n}`;
afterAll(async () => {
  await prisma.jobLease.deleteMany({ where: { name: { startsWith: RUN } } });
});

/** A promise and the function that settles it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

test("while one call holds the lease, another is refused; after release it is free", async () => {
  const n = name("basic");
  const g = gate();
  const first = withJobLease(n, 60_000, async () => {
    await g.opened;
    return "ran";
  });
  await new Promise((r) => setTimeout(r, 30));
  expect(await withJobLease(n, 60_000, async () => "second")).toEqual({ acquired: false });
  g.open();
  expect(await first).toEqual({ acquired: true, value: "ran" });
  expect(await withJobLease(n, 60_000, async () => "third")).toEqual({ acquired: true, value: "third" });
});

test("concurrent attempts: exactly one runs", async () => {
  const n = name("race");
  let running = 0;
  let maxRunning = 0;
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () =>
      withJobLease(n, 60_000, async () => {
        maxRunning = Math.max(maxRunning, ++running);
        await new Promise((r) => setTimeout(r, 50));
        running--;
      })
    )
  );
  expect(outcomes.filter((o) => o.acquired).length).toBe(1);
  expect(maxRunning).toBe(1);
});

test("the lease is released even when the job throws", async () => {
  const n = name("throws");
  await expect(withJobLease(n, 60_000, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await prisma.jobLease.findUnique({ where: { name: n } })).toBeNull();
});

test("an expired lease can be taken over, and its old holder can no longer renew it", async () => {
  const n = name("expiry");
  expect(await acquireLease(n, "crashed", 30)).toBe(true);
  expect(await acquireLease(n, "other", 60_000)).toBe(false);
  await new Promise((r) => setTimeout(r, 60));
  expect(await acquireLease(n, "other", 60_000)).toBe(true);
  expect(await renewLease(n, "crashed", 60_000)).toBe(false);
  // Releasing someone else's lease does nothing.
  await releaseLease(n, "crashed");
  expect((await prisma.jobLease.findUnique({ where: { name: n } }))!.holder).toBe("other");
});

test("a long job keeps its lease by renewing it", async () => {
  const n = name("renew");
  const g = gate();
  const job = withJobLease(n, 90, async () => g.opened, { renewEveryMs: 20 });
  // Well past the 90 ms ttl: without renewal another caller would get in.
  await new Promise((r) => setTimeout(r, 250));
  expect(await withJobLease(n, 90, async () => "intruder")).toEqual({ acquired: false });
  g.open();
  expect((await job).acquired).toBe(true);
});

test("a job whose lease is taken over is told to stop", async () => {
  const n = name("lost");
  let aborted = false;
  const job = withJobLease(
    n,
    60_000,
    async ({ signal }) => {
      // Simulate a stall long enough for someone else to take the lease.
      await prisma.jobLease.update({ where: { name: n }, data: { holder: "usurper" } });
      await new Promise((r) => setTimeout(r, 100));
      aborted = signal.aborted;
    },
    { renewEveryMs: 20 }
  );
  await job;
  expect(aborted).toBe(true);
  // The usurper's lease is left alone by the old holder's release.
  expect((await prisma.jobLease.findUnique({ where: { name: n } }))!.holder).toBe("usurper");
});

test("one process overlapping its own tick is refused too", async () => {
  // Each call is its own holder, so a slow tick and the next timer firing in
  // the same process cannot both run.
  const n = name("self");
  const g = gate();
  const slow = withJobLease(n, 60_000, () => g.opened);
  await new Promise((r) => setTimeout(r, 30));
  expect((await withJobLease(n, 60_000, async () => 1)).acquired).toBe(false);
  g.open();
  await slow;
});
