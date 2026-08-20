/**
 * Test preload. Runs before any test module is evaluated.
 *
 * env.ts parses process.env once at import time and exports a frozen result,
 * so anything a test needs configured must be set before the first file that
 * imports it — otherwise behaviour depends on test file ordering.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.PLAID_CLIENT_ID ??= "test_client_id";
process.env.PLAID_SECRET ??= "test_secret";
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long!!";
process.env.REVENUECAT_WEBHOOK_SECRET ??= "test-revenuecat-webhook-secret-value";
// Set so the AI guard reaches its entitlement check rather than 503-ing on
// missing config. No request in the suite actually calls OpenAI.
process.env.OPENAI_API_KEY ??= "test-openai-key";

/**
 * A migrated SQLite database for tests that need one.
 *
 * Rebuilt whenever the schema changes rather than on every run — migrating
 * takes seconds and the suite otherwise finishes in milliseconds. Delete
 * .test-db/ to force a rebuild.
 */
const testDbDir = join(import.meta.dir, "..", ".test-db");
const testDbPath = join(testDbDir, "test.db");
const stamp = join(testDbDir, "schema.stamp");

// Always override, never defer to an existing value: bun auto-loads .env, so
// without this the suite would run against the developer's own database and be
// free to mutate real local data.
{
  const schema = Bun.hash(
    await Bun.file(join(import.meta.dir, "..", "prisma", "schema.prisma")).text()
  ).toString();

  const current = existsSync(stamp) ? await Bun.file(stamp).text() : "";
  if (current !== schema) {
    rmSync(testDbDir, { recursive: true, force: true });
    mkdirSync(testDbDir, { recursive: true });
    execSync("bunx prisma migrate deploy", {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
      stdio: "ignore",
    });
    await Bun.write(stamp, schema);
  }
  process.env.DATABASE_URL = `file:${testDbPath}`;
}
