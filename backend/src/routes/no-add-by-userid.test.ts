import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Nobody can be put into a group by someone else.
 *
 * Membership is created by the joiner, from an invite code they typed. The
 * endpoint that accepted a target userId was removed in Task 16 — it let a
 * victim be silently resolved into a stranger's business and have their
 * screens read and write that stranger's data. It is also the exact shape
 * App Store guideline 5.1.2 rejects, so this is a shipping condition and not
 * a preference.
 *
 * Scanning the source rather than probing endpoints, because the property is
 * "no such route exists" — and a test that probes can only ever assert about
 * the routes someone thought to probe.
 */

const ROUTES = join(import.meta.dir);

function handlersCreatingMembership(source: string): string[] {
  // Every groupMember.create / createMany call, with the surrounding ~400
  // characters of context that would contain the userId it uses.
  const out: string[] = [];
  const re = /prisma\.groupMember\.create(Many)?\(/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    out.push(source.slice(Math.max(0, m.index - 700), m.index + 400));
  }
  return out;
}

test("membership is only ever created for the caller", async () => {
  const files = readdirSync(ROUTES).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
  let checked = 0;

  for (const file of files) {
    const source = await Bun.file(join(ROUTES, file)).text();
    for (const context of handlersCreatingMembership(source)) {
      checked++;
      // The userId written must come from the session, never from the body.
      expect(context).toContain("userId: user.id");
      // And nothing nearby may be reading a userId out of the request.
      expect(context).not.toMatch(/userId:\s*(body|input|data|patch|valid)/);
    }
  }

  // If this drops to zero the scan has stopped finding the calls it guards.
  expect(checked).toBeGreaterThan(0);
});

test("no route validator accepts a userId or memberId field", async () => {
  const files = readdirSync(ROUTES).filter(
    (f) => f.endsWith(".ts") && !f.includes(".test.") &&
      (f.includes("business") || f.includes("household"))
  );
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const source = await Bun.file(join(ROUTES, file)).text();
    // A zod object declaring a userId is a route taking one from the client.
    const schemas = source.match(/z\.object\(\{[^}]*\}\)/gs) ?? [];
    for (const schema of schemas) {
      expect(schema).not.toMatch(/\buserId\s*:/);
      expect(schema).not.toMatch(/\bmemberId\s*:/);
      expect(schema).not.toMatch(/\bemail\s*:/);
    }
  }
});
