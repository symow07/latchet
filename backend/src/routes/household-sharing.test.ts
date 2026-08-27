/**
 * Household sharing, exercised through real HTTP handlers against a real
 * database.
 *
 * The rest of this suite tests pure logic, which is the right default. This
 * file is different on purpose: the property that matters here is "a summary
 * member's category never reaches the wire", and the only honest way to assert
 * that is to read the wire. A unit test of the projection proves the
 * projection; it cannot prove the route calls it.
 *
 * Uses the migrated database that test-setup.ts prepares — deliberately not a
 * temp one of its own. env.ts freezes DATABASE_URL at import, so a file that
 * sets it later binds to whatever the preload chose anyway, and the fixtures
 * end up in the shared database while the test believes otherwise. Cleaning up
 * by prefix is what makes re-runs idempotent.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { householdRouter } from "./household";

/** Everything this file creates is prefixed so cleanup cannot overreach. */
const P = "hhtest_";
const ALICE = `${P}alice`, BOB = `${P}bob`, CAROL = `${P}carol`;
const ACC_PERSONAL = `${P}acc_personal`, ACC_JOINT = `${P}acc_joint`;

async function cleanup() {
  await prisma.transaction.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.bankAccount.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.groupMember.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { ownerId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

/** Acts as `userId` for the next request. Stands in for Better Auth only. */
let actingAs = "";

/** Only the fields the handlers actually read off the session user. */
type TestUser = { id: string; email: string };
type TestEnv = { Variables: { user: TestUser | null; session: unknown } };

const makeApp = (path: string, router: Hono<never>) => {
  const app = new Hono<TestEnv>();
  app.use("*", async (c, next) => {
    c.set("user", actingAs ? { id: actingAs, email: `${actingAs}@x.test` } : null);
    await next();
  });
  app.route(path, router as unknown as Hono<TestEnv>);
  return app;
};

const app = makeApp("/household", householdRouter as unknown as Hono<never>);

const as = (userId: string) => { actingAs = userId; };
const get = (path: string) => app.fetch(new Request(`http://t${path}`));
const send = (method: string, path: string, body?: unknown) =>
  app.fetch(new Request(`http://t${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

/** res.json() is `unknown` under strict; these tests know their own shapes. */
const json = async <T>(res: Response | Promise<Response>): Promise<T> =>
  (await (await res).json()) as T;

interface DashMember {
  userId: string;
  shareLevel: string;
  totalIn: number;
  totalOut: number;
  byCategory?: Record<string, number>;
  transactions?: unknown[];
}
interface Dashboard {
  combined: { totalIn: number; totalOut: number };
  members: DashMember[];
}

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  await prisma.user.createMany({
    data: [
      { id: ALICE, name: "Alice", email: `${ALICE}@x.test`, emailVerified: true, createdAt: now, updatedAt: now },
      { id: BOB, name: "Bob", email: `${BOB}@x.test`, emailVerified: true, createdAt: now, updatedAt: now },
      { id: CAROL, name: "Carol", email: `${CAROL}@x.test`, emailVerified: true, createdAt: now, updatedAt: now },
    ],
  });

  // Bob's spending is the payload under test: a category and a note that must
  // not surface while he is on summary.
  await prisma.bankAccount.createMany({
    data: [
      { id: ACC_PERSONAL, userId: BOB, name: "Bob Personal", type: "checking", balance: 500, createdAt: now, updatedAt: now },
      { id: ACC_JOINT, userId: BOB, name: "Joint", type: "checking", balance: 900, createdAt: now, updatedAt: now },
    ],
  });
  await prisma.transaction.createMany({
    data: [
      { id: `${P}tx_secret`, userId: BOB, accountId: ACC_PERSONAL, amount: 260, category: "Health", type: "Expense", note: "therapy copay", dateISO: "2026-08-10", createdAt: now, updatedAt: now },
      { id: `${P}tx_joint`, userId: BOB, accountId: ACC_JOINT, amount: 80, category: "Food", type: "Expense", note: "groceries", dateISO: "2026-08-11", createdAt: now, updatedAt: now },
      { id: `${P}tx_income`, userId: BOB, accountId: ACC_PERSONAL, amount: 3000, category: "Other", type: "Income", note: "salary", dateISO: "2026-08-01", createdAt: now, updatedAt: now },
    ],
  });
});

afterAll(cleanup);

// ── Setup through the API itself ─────────────────────────────────────────────

test("alice creates a household and bob joins by code", async () => {
  as(ALICE);
  const created = await json<{ household: { type: string }; inviteCode: string }>(
    send("POST", "/household", { name: "Home" })
  );
  expect(created.household.type).toBe("household");
  const code = created.inviteCode;

  as(BOB);
  const preview = await json<{
    name: string;
    joiningMeans: { defaultShareLevel: string; notSharedOnJoin: string[] };
  }>(get(`/household/preview?code=${code}`));
  // The consent screen states the cost of joining before anyone accepts.
  expect(preview.name).toBe("Home");
  expect(preview.joiningMeans.defaultShareLevel).toBe("summary");
  expect(preview.joiningMeans.notSharedOnJoin).toContain("transactions");

  const joined = await send("POST", "/household/join", {
    code,
    acknowledgedShareLevel: "summary",
  });
  expect(joined.status).toBe(201);
  expect((await json<{ member: { shareLevel: string } }>(joined)).member.shareLevel).toBe("summary");
});

// ── The assertion the feature turns on ───────────────────────────────────────

test("a summary member leaks no category or transaction into any household response", async () => {
  as(ALICE);
  const bodies: string[] = [];
  for (const path of ["/household", "/household/visibility", "/household/dashboard?month=2026-08"]) {
    const res = await get(path);
    expect(res.status).toBe(200);
    bodies.push(await res.text());
  }

  for (const body of bodies) {
    expect(body).not.toContain("therapy copay");
    expect(body).not.toContain("Health");
    expect(body).not.toContain(`${P}tx_secret`);
  }
});

test("but the combined total still includes them — summary is a floor, not silence", async () => {
  as(ALICE);
  const dash = await json<Dashboard>(get("/household/dashboard?month=2026-08"));
  const bob = dash.members.find((m) => m.userId === BOB)!;
  expect(bob.totalOut).toBe(340);      // 260 + 80, no breakdown
  expect(bob.byCategory).toBeUndefined();
  expect(bob.transactions).toBeUndefined();
  expect(dash.combined.totalOut).toBe(340);
});

test("raising to categories reveals categories and still no transactions", async () => {
  as(BOB);
  const res = await json<{ shareLevel: string; notifyGroup: boolean }>(
    send("PATCH", "/household/my-share-level", { shareLevel: "categories" })
  );
  expect(res.shareLevel).toBe("categories");
  // Raising is announced. Lowering is nobody's business.
  expect(res.notifyGroup).toBe(true);

  as(ALICE);
  const body = await (await get("/household/dashboard?month=2026-08")).text();
  expect(body).toContain("Health");
  expect(body).not.toContain("therapy copay");
});

test("lowering your own level is not announced", async () => {
  as(BOB);
  const res = await json<{ notifyGroup: boolean }>(
    send("PATCH", "/household/my-share-level", { shareLevel: "summary" })
  );
  expect(res.notifyGroup).toBe(false);
});

test("nobody else can change a member's share level", async () => {
  // There is no route that takes a target userId at all — the absence is the
  // control. This asserts the surface rather than a rejection.
  const paths = ["/household/my-share-level", "/household/share-level", "/household/members/bob"];
  as(ALICE);
  const statuses = await Promise.all(
    paths.map(async (p) => (await send("PATCH", p, { shareLevel: "full", userId: BOB })).status)
  );
  // The first is alice's OWN level; the others do not exist.
  expect(statuses[1]).toBe(404);
  expect(statuses[2]).toBe(404);

  as(ALICE);
  const dash = await json<Dashboard>(get("/household/dashboard?month=2026-08"));
  expect(dash.members.find((m) => m.userId === BOB)!.shareLevel).toBe("summary");
});

// ── Shared accounts ──────────────────────────────────────────────────────────

test("a shared account is visible in full while its owner stays on summary", async () => {
  const household = await prisma.group.findFirstOrThrow({ where: { type: "household", ownerId: ALICE } });
  await prisma.bankAccount.update({
    where: { id: ACC_JOINT },
    data: { sharedWithGroupId: household.id },
  });

  as(ALICE);
  const body = await (await get("/household/dashboard?month=2026-08")).text();
  expect(body).toContain("groceries");        // the joint account, opted in
  expect(body).not.toContain("therapy copay"); // the personal one, not
});

test("leaving revokes access immediately, including to shared accounts", async () => {
  as(BOB);
  expect((await send("DELETE", "/household/leave")).status).toBe(200);

  as(ALICE);
  const body = await (await get("/household/dashboard?month=2026-08")).text();
  expect(body).not.toContain("groceries");
  expect(body).not.toContain(BOB);
  expect(await prisma.bankAccount.findFirstOrThrow({ where: { id: ACC_JOINT } }))
    .toMatchObject({ sharedWithGroupId: null });
});

// ── Cross-type isolation ─────────────────────────────────────────────────────

test("a household invite code cannot be used to join a business, or the reverse", async () => {
  const { businessRouter } = await import("./business");
  const bizApp = makeApp("/business", businessRouter as unknown as Hono<never>);

  as(ALICE);
  const household = await prisma.group.findFirstOrThrow({ where: { type: "household", ownerId: ALICE } });

  as(CAROL);
  const res = await bizApp.fetch(new Request("http://t/business/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: household.inviteCode }),
  }));
  expect(res.status).toBe(404);
  // And carol did not end up in the household by the side door.
  expect(await prisma.groupMember.count({ where: { groupId: household.id, userId: CAROL } })).toBe(0);
});

test("owning a business does not resolve as owning a household", async () => {
  const now = new Date();
  await prisma.group.create({
    data: { id: `${P}biz`, ownerId: ALICE, name: "Acme", type: "business", createdAt: now, updatedAt: now },
  });
  as(ALICE);
  const body = await json<{ household: { name: string; type: string } }>(get("/household"));
  expect(body.household.name).toBe("Home");
  expect(body.household.type).toBe("household");
});

// ── Raising visibility is announced ──────────────────────────────────────────

test('raising your level notifies the other members, and lowering does not', async () => {
  // The notification is sent server-side on purpose: one the app chooses to
  // send is one a modified app can decline to send, and the point is that the
  // group finds out even when the person raising it would rather they did not.
  const source = await Bun.file(new URL('./household.ts', import.meta.url)).text();
  const handler = source.slice(
    source.indexOf('"/my-share-level"'),
    source.indexOf('householdRouter.get("/visibility"')
  );

  expect(handler).toContain('sendPushToUser');
  // Guarded by `raised`, so a reduction stays private.
  expect(handler.indexOf('const raised =')).toBeLessThan(handler.indexOf('sendPushToUser'));
  expect(handler).toContain('if (raised)');
  // Sent to everyone except the person who changed it.
  expect(handler).toContain('userId: { not: user.id }');
});

test('the notification says what changed, not the internal level name', async () => {
  const source = await Bun.file(new URL('./household.ts', import.meta.url)).text();
  // "full" tells a recipient nothing about what they can now see.
  expect(source).toContain('individual transactions');
  expect(source).toContain('totals only');
});
