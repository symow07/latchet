import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * DATABASE_URL validation in env.ts. env.ts validates once at import and exits
 * the process on bad config, so each case imports it in a child process. The
 * child runs in an empty directory so no .env file is auto-loaded into it.
 */
const ENV_TS = join(import.meta.dir, "env.ts");
const SECRET = "x".repeat(40);

function loadEnv(vars: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "budget-env-"));
  try {
    const r = Bun.spawnSync(
      [process.execPath, "-e", `const m = await import(${JSON.stringify(ENV_TS)}); console.log("URL=" + m.env.DATABASE_URL)`],
      { cwd: dir, env: { PATH: process.env.PATH ?? "", BETTER_AUTH_SECRET: SECRET, ...vars } }
    );
    return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("outside production, an unset DATABASE_URL means the local developer database", () => {
  const r = loadEnv({});
  expect(r.code).toBe(0);
  expect(r.out).toContain("URL=postgresql://localhost:5432/budget_dev");
});

test("production refuses to boot without a DATABASE_URL", () => {
  // Falling back to a developer default would come up healthy and empty.
  const r = loadEnv({ NODE_ENV: "production" });
  expect(r.code).not.toBe(0);
  expect(r.out).toContain("DATABASE_URL is required in production");
});

test("a non-Postgres URL, such as the old single-file one, is refused", () => {
  const r = loadEnv({ DATABASE_URL: "file:dev.db" });
  expect(r.code).not.toBe(0);
  expect(r.out).toContain("must be a postgres:// or postgresql:// URL");
});

test("a production Postgres URL is used as given", () => {
  const url = "postgresql://postgres:secret@postgres.railway.internal:5432/railway";
  const r = loadEnv({ NODE_ENV: "production", DATABASE_URL: url });
  expect(r.code).toBe(0);
  expect(r.out).toContain(`URL=${url}`);
});
