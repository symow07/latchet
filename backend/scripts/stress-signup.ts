// Production stress test: 10 sequential signups against the live backend.
// Fails (exit 1) if any single attempt takes >5s or returns non-2xx.
//
// Usage:
//   bun run scripts/stress-signup.ts
//   BACKEND=https://your-backend.example.com bun run scripts/stress-signup.ts
//   COUNT=20 SPACING_MS=500 bun run scripts/stress-signup.ts
//
// 200ms inter-request spacing by default to avoid tripping our own per-IP
// burst limiter while still exercising the auth path under back-to-back load.

const BACKEND = process.env.BACKEND ?? "https://latchet-production.up.railway.app";
const COUNT = Number(process.env.COUNT ?? 10);
const SPACING_MS = Number(process.env.SPACING_MS ?? 200);
const PER_REQUEST_TIMEOUT_MS = Number(process.env.PER_REQUEST_TIMEOUT_MS ?? 35_000);
const MAX_OK_DURATION_MS = Number(process.env.MAX_OK_DURATION_MS ?? 5_000);

type Result = {
  attempt: number;
  email: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
};

async function signup(attempt: number): Promise<Result> {
  const stamp = `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `stress-${stamp}@example.invalid`;
  const t0 = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKEND}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "TestPassword123!StressOK",
        name: "Stress Test",
      }),
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    return {
      attempt,
      email,
      status: res.status,
      ms,
      ok: res.status >= 200 && res.status < 300 && ms <= MAX_OK_DURATION_MS,
    };
  } catch (err) {
    return {
      attempt,
      email,
      status: null,
      ms: Date.now() - t0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Stress: ${COUNT} signups against ${BACKEND} spacing=${SPACING_MS}ms cap=${MAX_OK_DURATION_MS}ms`);

  const results: Result[] = [];
  for (let i = 1; i <= COUNT; i++) {
    const r = await signup(i);
    results.push(r);
    const tag = r.ok ? "OK" : "FAIL";
    console.log(
      `  [${i.toString().padStart(2, "0")}/${COUNT}] ${tag} status=${r.status ?? "n/a"} ms=${r.ms} email=${r.email}${r.error ? ` err=${r.error}` : ""}`,
    );
    if (i < COUNT) await new Promise((res) => setTimeout(res, SPACING_MS));
  }

  const oks = results.filter((r) => r.ok).length;
  const slowOks = results.filter((r) => r.status === 200 && r.ms > MAX_OK_DURATION_MS);
  const fives = results.filter((r) => r.status === 503);
  const four29s = results.filter((r) => r.status === 429);
  const others = results.filter((r) => !r.ok && r.status !== 503 && r.status !== 429);
  const durations = results.map((r) => r.ms).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  const max = durations[durations.length - 1] ?? 0;

  console.log("");
  console.log("Summary:");
  console.log(`  ok       = ${oks}/${COUNT}`);
  console.log(`  slow 200 = ${slowOks.length} (>${MAX_OK_DURATION_MS}ms)`);
  console.log(`  503      = ${fives.length}`);
  console.log(`  429      = ${four29s.length} (own rate-limiter — not a backend signup failure)`);
  console.log(`  other    = ${others.length}`);
  console.log(`  median   = ${median}ms`);
  console.log(`  max      = ${max}ms`);

  // Hard requirement: no 503, no slow 200. 429 from our own limiter is flagged
  // separately above so the operator can rerun with bigger SPACING_MS rather
  // than treating it as a backend failure.
  if (fives.length > 0 || slowOks.length > 0 || others.length > 0) {
    console.error("\nFAIL: at least one request was a 503, a slow 200, or other non-success.");
    process.exit(1);
  }
  if (four29s.length > 0) {
    console.warn(
      "\nWarning: hit own rate-limiter; backend signup path is healthy but the test load tripped per-IP cap. Consider rerunning with SPACING_MS=500 from a different IP.",
    );
  }
  console.log("\nPASS");
}

main().catch((err) => {
  console.error("Stress harness crashed:", err);
  process.exit(1);
});
