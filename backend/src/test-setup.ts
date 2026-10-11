/**
 * Test preload. Runs before any test module is evaluated.
 *
 * env.ts parses process.env once at import time and exports a frozen result,
 * so anything a test needs configured must be set before the first module that
 * imports it — otherwise behaviour depends on test file ordering.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";
import {
  databaseName, forPlainDriver, isPostgresUrl, prismaSchema, withDatabase, withDefaultUser,
} from "./lib/database-url";

process.env.PLAID_CLIENT_ID ??= "test_client_id";
process.env.PLAID_SECRET ??= "test_secret";
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long!!";
process.env.REVENUECAT_WEBHOOK_SECRET ??= "test-revenuecat-webhook-secret-value";
// Set so the AI guard reaches its entitlement check rather than 503-ing on
// missing config. No request in the suite actually calls OpenAI.
process.env.OPENAI_API_KEY ??= "test-openai-key";

/**
 * The suite's own Postgres database: TEST_DATABASE_URL, or budget_test on the
 * local server. Never DATABASE_URL — bun auto-loads .env, so deferring to it
 * would run the suite against the developer's own database, free to mutate
 * (and, on a schema change, to drop) real local data.
 *
 * Created if missing. Rebuilt from the migrations only when schema.prisma or a
 * migration changes, or when the database no longer matches the migrations on
 * disk: migrating takes seconds and the suite otherwise finishes quickly. The
 * stamp lives in .test-db/; delete that directory to force a rebuild.
 *
 * Every test file shares this one database, one file at a time. A test that
 * needs a clean slate deletes or truncates the rows it uses; most scope their
 * fixtures by an id prefix so cleanup cannot reach anyone else's.
 */
const DEFAULT_TEST_DATABASE_URL = "postgresql://localhost:5432/budget_test";

const backendDir = join(import.meta.dir, "..");
const migrationsDir = join(backendDir, "prisma", "migrations");
const stampDir = join(backendDir, ".test-db");
const stampPath = join(stampDir, "schema.stamp");

const testUrl = withDefaultUser(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
if (!isPostgresUrl(testUrl)) {
  throw new Error("TEST_DATABASE_URL must be a postgres:// or postgresql:// URL naming a database");
}
const testDb = databaseName(testUrl);
/** The same database for Bun.SQL, which rejects Prisma's URL parameters. */
const driverUrl = forPlainDriver(testUrl);

// The rebuild below drops this database. Refuse anything that is not plainly a
// test database, so a mistyped TEST_DATABASE_URL cannot take real data with it.
if (!/test/i.test(testDb)) {
  throw new Error(`Refusing to use "${testDb}" for tests: the test database's name must contain "test"`);
}
if (process.env.DATABASE_URL && databaseName(process.env.DATABASE_URL) === testDb &&
    isPostgresUrl(process.env.DATABASE_URL) &&
    new URL(withDefaultUser(process.env.DATABASE_URL)).host === new URL(testUrl).host) {
  throw new Error(`TEST_DATABASE_URL and DATABASE_URL name the same database ("${testDb}")`);
}

/** Migration directories on disk, in the order Prisma applies them. */
function migrationNames(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Changes whenever the schema, a migration or the target database does. */
async function currentStamp(): Promise<string> {
  const parts = [testUrl, await Bun.file(join(backendDir, "prisma", "schema.prisma")).text()];
  parts.push(await Bun.file(join(migrationsDir, "migration_lock.toml")).text());
  for (const name of migrationNames()) {
    parts.push(name, await Bun.file(join(migrationsDir, name, "migration.sql")).text());
  }
  return Bun.hash(parts.join("\u0000")).toString();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A connection to the server's maintenance database, to create or drop ours. */
async function connectAdmin(): Promise<SQL> {
  let lastError: unknown;
  for (const maintenance of ["postgres", "template1"]) {
    const admin = new SQL(withDatabase(driverUrl, maintenance));
    try {
      await admin`SELECT 1`;
      return admin;
    } catch (error) {
      lastError = error;
      await admin.close().catch(() => {});
    }
  }
  throw new Error(
    `Cannot reach Postgres for the test database at ${new URL(testUrl).host}. ` +
      `Is the server running? (${lastError instanceof Error ? lastError.message : String(lastError)})`
  );
}

/** True when the database exists and has exactly the migrations on disk applied. */
async function isUpToDate(admin: SQL): Promise<boolean> {
  const found = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDb}`;
  if (found.length === 0) return false;
  const db = new SQL(driverUrl);
  try {
    const rows = await db.unsafe(
      `SELECT migration_name FROM ${quoteIdent(prismaSchema(testUrl))}."_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY migration_name`
    );
    const applied = rows.map((r: { migration_name: string }) => r.migration_name);
    return JSON.stringify(applied) === JSON.stringify(migrationNames());
  } catch {
    return false; // no _prisma_migrations table: never migrated
  } finally {
    await db.close().catch(() => {});
  }
}

{
  const stamp = await currentStamp();
  const admin = await connectAdmin();
  // Two suites starting at once must not both rebuild, one dropping the
  // database under the other. Advisory locks are per database, and every run
  // takes this one through the same maintenance database.
  const lockKey = `budget:test-setup:${testDb}`;
  await admin`SELECT pg_advisory_lock(hashtext(${lockKey}))`;
  try {
    const recorded = existsSync(stampPath) ? await Bun.file(stampPath).text() : "";
    if (recorded !== stamp || !(await isUpToDate(admin))) {
      rmSync(stampDir, { recursive: true, force: true });
      mkdirSync(stampDir, { recursive: true });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(testDb)} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${quoteIdent(testDb)}`);
      try {
        execFileSync("bunx", ["prisma", "migrate", "deploy"], {
          cwd: backendDir,
          env: { ...process.env, DATABASE_URL: testUrl },
          stdio: "pipe",
        });
      } catch (error) {
        const e = error as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(
          `prisma migrate deploy failed on the test database:\n${e.stdout ?? ""}${e.stderr ?? ""}`
        );
      }
      await Bun.write(stampPath, stamp);
    }
  } finally {
    await admin`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch(() => {});
    await admin.close().catch(() => {});
  }
  process.env.DATABASE_URL = testUrl;
}
