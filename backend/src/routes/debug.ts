import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env";
import { fetchWithTimeout } from "../lib/fetch-timeout";

const debugRouter = new Hono();

const CHECK_TIMEOUT_MS = 3_000;

type CheckResult = {
  check: string;
  ok: boolean;
  ms: number;
  error?: string;
  detail?: unknown;
};

async function timed<T>(name: string, fn: () => Promise<T>): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${name} timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        ),
      ),
    ]);
    return { check: name, ok: true, ms: Date.now() - t0, detail: result as unknown };
  } catch (err) {
    return {
      check: name,
      ok: false,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

debugRouter.get("/signup-prereq", async (c) => {
  const overallT0 = Date.now();

  const envPresent = {
    BETTER_AUTH_SECRET: Boolean(env.BETTER_AUTH_SECRET),
    BACKEND_URL: Boolean(env.BACKEND_URL),
    DATABASE_URL: Boolean(env.DATABASE_URL),
    SMTP_SERVICE_URL: Boolean(env.SMTP_SERVICE_URL),
    NODE_ENV: env.NODE_ENV ?? null,
  };

  const checks: CheckResult[] = [];

  checks.push(
    await timed("db.select1", async () => {
      const rows = await prisma.$queryRawUnsafe<{ one: number }[]>("SELECT 1 as one");
      return { rowCount: rows.length };
    }),
  );

  checks.push(
    await timed("db.user.findFirst", async () => {
      const row = await prisma.user.findFirst({ select: { id: true } });
      return { hasAny: row != null };
    }),
  );

  checks.push(
    await timed("db.verification.findFirst", async () => {
      const row = await prisma.verification.findFirst({ select: { id: true } });
      return { hasAny: row != null };
    }),
  );

  checks.push(
    await timed("db.session.findFirst", async () => {
      const row = await prisma.session.findFirst({ select: { id: true } });
      return { hasAny: row != null };
    }),
  );

  checks.push(
    await timed("db.account.findFirst", async () => {
      const row = await prisma.account.findFirst({ select: { id: true } });
      return { hasAny: row != null };
    }),
  );

  checks.push(
    await timed("db.user.findUnique.byEmail", async () => {
      const row = await prisma.user.findUnique({
        where: { email: "debug-prereq-nonexistent@example.invalid" },
        select: { id: true },
      });
      return { hasAny: row != null };
    }),
  );

  // Synthetic insert/delete to prove the write path end to end.
  // Email is namespaced + timestamped so retries never collide. Same id used
  // for both ops so the delete cleans up even if mid-flow we error out.
  const debugId = `debug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const debugEmail = `debug-prereq-${debugId}@example.invalid`;
  checks.push(
    await timed("db.user.insert.synthetic", async () => {
      const created = await prisma.user.create({
        data: {
          id: debugId,
          name: "Debug Prereq",
          email: debugEmail,
          emailVerified: false,
        },
        select: { id: true },
      });
      return { id: created.id };
    }),
  );
  checks.push(
    await timed("db.user.delete.synthetic", async () => {
      await prisma.user.delete({ where: { id: debugId } }).catch(() => null);
      return { id: debugId };
    }),
  );

  // SMTP reachability — HEAD is cheap and most services accept it; if not,
  // even a 405 proves the host is up. Connection error vs timeout is the
  // signal we want. Skipped when no webhook URL is configured (e.g. using
  // Resend or the dev console sender instead).
  const smtpUrl = env.SMTP_SERVICE_URL;
  if (smtpUrl) {
    checks.push(
      await timed("smtp.reachability", async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS - 200);
        try {
          const res = await fetchWithTimeout(smtpUrl, {
            method: "HEAD",
            signal: controller.signal,
          });
          return { status: res.status };
        } finally {
          clearTimeout(timer);
        }
      }),
    );
  }

  const overallMs = Date.now() - overallT0;
  const allOk = checks.every((c) => c.ok);

  return c.json({
    ok: allOk,
    overallMs,
    envPresent,
    checks,
  });
});

export { debugRouter };
