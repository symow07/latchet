import { afterAll, beforeAll, describe, expect, spyOn, test, type Mock } from "bun:test";
import { prisma } from "./prisma";
import { app } from "./index";
import { createAuthMailer, type AuthMailDeps } from "./auth";
import type { EmailMessage } from "./lib/email";

/**
 * Password reset and email verification.
 *
 * The first half holds the mail sender to its two rules with injected deps:
 * a send never fails or slows the request that caused it, and never says
 * anything about whether an account exists. The second half runs the real
 * flows through the exported app, reading the links out of the development
 * mail log — every address here is @e2e.test, which lib/email.ts logs
 * instead of handing to a provider.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));
const RESET = { id: "u_reset", email: "sam@e2e.test", name: "Sam" };

function fakeDeps(over: Partial<AuthMailDeps> = {}) {
  const sent: EmailMessage[] = [];
  const deps: AuthMailDeps = {
    send: async (msg) => {
      sent.push(msg);
    },
    savedLocale: async () => null,
    allow: async () => true,
    ...over,
  };
  return { deps, sent };
}

describe("the auth mail sender", () => {
  let errorSpy: Mock<typeof console.error>;
  let warnSpy: Mock<typeof console.warn>;
  beforeAll(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("answers before the provider does: a send that never finishes holds nothing up", async () => {
    let started = false;
    const { deps } = fakeDeps({
      send: () => {
        started = true;
        return new Promise<void>(() => {});
      },
    });
    const mailer = createAuthMailer(deps);
    const outcome = await Promise.race([
      mailer.sendResetPassword({ user: RESET, url: "http://localhost:3000/api/auth/reset-password/T?callbackURL=" }).then(() => "returned"),
      new Promise((r) => setTimeout(() => r("blocked"), 200)),
    ]);
    expect(outcome).toBe("returned");
    await flush();
    await flush();
    expect(started).toBe(true);
  });

  test("a provider failure (production with no provider throws) is logged, never thrown", async () => {
    errorSpy.mockClear();
    const { deps } = fakeDeps({
      send: async () => {
        throw new Error("No email provider configured (set RESEND_API_KEY or SMTP_SERVICE_URL)");
      },
    });
    const mailer = createAuthMailer(deps);
    await expect(mailer.sendVerificationEmail({ user: RESET, url: "http://localhost:3000/api/auth/verify-email?token=a&callbackURL=%2F" })).resolves.toBeUndefined();
    await expect(mailer.sendResetPassword({ user: RESET, url: "http://localhost:3000/api/auth/reset-password/T?callbackURL=" })).resolves.toBeUndefined();
    await Bun.sleep(10);
    const logged = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes("[auth-mail] verify mail for user u_reset failed"))).toBe(true);
    expect(logged.some((l) => l.includes("[auth-mail] reset mail for user u_reset failed"))).toBe(true);
    // The log names the account by id: no address, no link.
    expect(logged.join("\n")).not.toContain("sam@e2e.test");
    expect(logged.join("\n")).not.toContain("reset-password/T");
  });

  test("a database failure while preparing the mail is logged, never thrown", async () => {
    errorSpy.mockClear();
    const { deps, sent } = fakeDeps({
      savedLocale: async () => {
        throw new Error("connection refused");
      },
    });
    await expect(createAuthMailer(deps).sendResetPassword({ user: RESET, url: "http://x/api/auth/reset-password/T?callbackURL=" })).resolves.toBeUndefined();
    await Bun.sleep(10);
    expect(sent).toHaveLength(0);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("connection refused"))).toBe(true);
  });

  test("a reset link lands in the app even when the request named somewhere else", async () => {
    const { deps, sent } = fakeDeps();
    await createAuthMailer(deps).sendResetPassword({
      user: RESET,
      url: "http://localhost:3000/api/auth/reset-password/TOK?callbackURL=exp%3A%2F%2Fattacker.example%3A8081%2F--%2Fsteal",
    });
    await Bun.sleep(10);
    expect(sent[0]!.text).toContain("/api/auth/reset-password/TOK?callbackURL=realbudget%3A%2F%2Freset-password");
    expect(sent[0]!.text).not.toContain("attacker");
  });

  test("links with no callback land in the app", async () => {
    const { deps, sent } = fakeDeps();
    const mailer = createAuthMailer(deps);
    await mailer.sendVerificationEmail({ user: RESET, url: "http://localhost:3000/api/auth/verify-email?token=a.b.c&callbackURL=%2F" });
    await mailer.sendResetPassword({ user: RESET, url: "http://localhost:3000/api/auth/reset-password/TOK?callbackURL=" });
    await Bun.sleep(10);
    expect(sent.map((m) => m.to)).toEqual(["sam@e2e.test", "sam@e2e.test"]);
    expect(sent[0]!.text).toContain("callbackURL=realbudget%3A%2F%2Fverify-email");
    expect(sent[1]!.text).toContain("/api/auth/reset-password/TOK?callbackURL=realbudget%3A%2F%2Freset-password");
  });

  test("writes in the saved language, else the request's Accept-Language", async () => {
    const saved = fakeDeps({ savedLocale: async () => "fr" });
    await createAuthMailer(saved.deps).sendResetPassword(
      { user: RESET, url: "http://x/api/auth/reset-password/T?callbackURL=" },
      new Request("http://x", { headers: { "accept-language": "zh" } })
    );
    const fresh = fakeDeps();
    await createAuthMailer(fresh.deps).sendVerificationEmail(
      { user: RESET, url: "http://x/api/auth/verify-email?token=t&callbackURL=%2F" },
      new Request("http://x", { headers: { "accept-language": "ar-MA" } })
    );
    await Bun.sleep(10);
    expect(saved.sent[0]!.subject).toBe("Réinitialisez votre mot de passe Budget");
    expect(fresh.sent[0]!.subject).toBe("أكّد بريدك الإلكتروني في Budget");
  });

  test("past the hourly limit for an account, nothing is sent and the caller cannot tell", async () => {
    const { deps, sent } = fakeDeps({ allow: async () => false });
    await expect(createAuthMailer(deps).sendResetPassword({ user: RESET, url: "http://x/api/auth/reset-password/T?callbackURL=" })).resolves.toBeUndefined();
    await Bun.sleep(10);
    expect(sent).toHaveLength(0);
  });
});

// ── The real flows, in process ───────────────────────────────────────────────

const ORIGIN = "http://localhost:3000";
const RUN = `${process.pid}-${Date.now().toString(36)}`;
const userIds: string[] = [];

/** A client address no other request in the run uses, so no per-IP limit is shared. */
function freshAddress(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

async function call(
  method: "GET" | "POST",
  url: string,
  opts: { body?: unknown; cookie?: string } = {}
): Promise<{ status: number; text: string; location: string; res: Response }> {
  const headers: Record<string, string> = { "x-forwarded-for": freshAddress(), origin: ORIGIN };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await app.fetch(
    new Request(url.startsWith("http") ? url : `http://localhost${url}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      redirect: "manual",
    })
  );
  return { status: res.status, text: await res.text(), location: res.headers.get("location") ?? "", res };
}

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}

describe("password reset and email verification, through the app", () => {
  let warnSpy: Mock<typeof console.warn>;
  const mail: string[] = [];

  beforeAll(() => {
    warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      mail.push(args.map(String).join(" "));
    });
  });
  afterAll(async () => {
    warnSpy.mockRestore();
    await prisma.rateLimitBucket.deleteMany({ where: { OR: userIds.map((id) => ({ key: { contains: id } })) } });
    await prisma.verification.deleteMany({ where: { value: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  /** Every mail logged to `email` whose body has a link containing `marker`, oldest first. */
  function linksTo(email: string, marker: string): string[] {
    return mail
      .filter((m) => m.startsWith("[mail:dev]") && m.includes(`To ${email}:`))
      .flatMap((m) => [...m.matchAll(/https?:\/\/\S+/g)].map((x) => x[0]))
      .filter((link) => link.includes(marker));
  }

  async function waitForLink(email: string, marker: string, count = 1): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const found = linksTo(email, marker);
      if (found.length >= count) return found[count - 1]!;
      await Bun.sleep(20);
    }
    throw new Error(`no mail to ${email} with a ${marker} link`);
  }

  async function signUp(label: string, extra: Record<string, string> = {}) {
    const email = `${label}-${RUN}@e2e.test`;
    const password = `Old-pass-${RUN}-Xy9!`;
    const r = await call("POST", "/api/auth/sign-up/email", { body: { email, password, name: label, ...extra } });
    expect(r.status).toBe(200);
    const id = JSON.parse(r.text).user.id as string;
    userIds.push(id);
    return { id, email, password, cookie: cookieOf(r.res) };
  }

  test("sign-up mails a verification link that verifies the address and lands in the app", async () => {
    const u = await signUp("verify");
    const link = await waitForLink(u.email, "/api/auth/verify-email");
    // Sign-up named no callback; the server pointed the link at the app.
    expect(new URL(link).searchParams.get("callbackURL")).toBe("realbudget://verify-email");

    const opened = await call("GET", link);
    expect(opened.status).toBe(302);
    expect(opened.location).toBe("realbudget://verify-email");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerified).toBe(true);

    // A tampered token lands in the app with the error, not on a server page.
    const bad = await call("GET", link.replace(/token=[^&]+/, "token=not-a-jwt"));
    expect(bad.status).toBe(302);
    expect(bad.location).toBe("realbudget://verify-email?error=INVALID_TOKEN");
  });

  test("the app's sign-up names realbudget://verify-email as the callback; it passes the origin check and is kept", async () => {
    // What mobile/src/app/signup.tsx sends (VERIFY_EMAIL_CALLBACK).
    const u = await signUp("appsignup", { callbackURL: "realbudget://verify-email" });
    const link = await waitForLink(u.email, "/api/auth/verify-email");
    expect(new URL(link).searchParams.get("callbackURL")).toBe("realbudget://verify-email");
    const opened = await call("GET", link);
    expect([opened.status, opened.location]).toEqual([302, "realbudget://verify-email"]);
  });

  test("verification is offered, not required: an unverified account signs in, and Settings can resend", async () => {
    const u = await signUp("unverified");
    const signIn = await call("POST", "/api/auth/sign-in/email", { body: { email: u.email, password: u.password } });
    expect(signIn.status).toBe(200);

    const resend = await call("POST", "/api/auth/send-verification-email", {
      body: { email: u.email, callbackURL: "realbudget://verify-email" },
      cookie: u.cookie,
    });
    expect(resend.status).toBe(200);
    const second = await waitForLink(u.email, "/api/auth/verify-email", 2);
    expect(new URL(second).searchParams.get("callbackURL")).toBe("realbudget://verify-email");

    // Signed out, the resend answers the same for an address with no account.
    const ghost = await call("POST", "/api/auth/send-verification-email", { body: { email: `ghost-${RUN}@e2e.test` } });
    const known = await call("POST", "/api/auth/send-verification-email", { body: { email: u.email } });
    expect([ghost.status, ghost.text]).toEqual([known.status, known.text]);
  });

  test("reset: same answer for any address, a single-use link into the app, and every old session ends", async () => {
    const u = await signUp("reset");
    const before = await call("GET", "/api/v1/me", { cookie: u.cookie });
    expect(before.status).toBe(200);

    const known = await call("POST", "/api/auth/request-password-reset", { body: { email: u.email, redirectTo: "realbudget://reset-password" } });
    const unknown = await call("POST", "/api/auth/request-password-reset", { body: { email: `nobody-${RUN}@e2e.test`, redirectTo: "realbudget://reset-password" } });
    expect(known.status).toBe(200);
    expect([unknown.status, unknown.text]).toEqual([known.status, known.text]);

    const link = await waitForLink(u.email, "/api/auth/reset-password/");
    const opened = await call("GET", link);
    expect(opened.status).toBe(302);
    expect(opened.location.startsWith("realbudget://reset-password?token=")).toBe(true);
    const token = new URL(opened.location.replace("realbudget://", "http://x/")).searchParams.get("token")!;

    // Stored hashed: the token itself is nowhere in the table.
    expect(await prisma.verification.count({ where: { identifier: { contains: token } } })).toBe(0);

    const NEW = `New-pass-${RUN}-Qz7!`;
    expect((await call("POST", "/api/auth/reset-password", { body: { newPassword: NEW, token } })).status).toBe(200);
    const reuse = await call("POST", "/api/auth/reset-password", { body: { newPassword: NEW + "x", token } });
    expect(reuse.status).toBe(400);
    expect(reuse.text).toContain("INVALID_TOKEN");

    expect((await call("GET", "/api/v1/me", { cookie: u.cookie })).status).toBe(401);
    // What the app reads after a reset made on the phone that was signed in
    // (refreshSession in mobile/src/lib/auth/use-session.ts): no session, not
    // an error, so it signs that phone out and goes to sign-in.
    const gone = await call("GET", "/api/auth/get-session", { cookie: u.cookie });
    expect([gone.status, gone.text]).toEqual([200, "null"]);
    expect((await call("POST", "/api/auth/sign-in/email", { body: { email: u.email, password: u.password } })).status).toBe(401);
    expect((await call("POST", "/api/auth/sign-in/email", { body: { email: u.email, password: NEW } })).status).toBe(200);

    // The used link now lands in the app with the error the screen explains.
    const spent = await call("GET", link);
    expect(spent.location).toBe("realbudget://reset-password?error=INVALID_TOKEN");
  });

  test("reset links redirect only to trusted places", async () => {
    const evil = await call("GET", "/api/auth/reset-password/whatever?callbackURL=https%3A%2F%2Fevil.example.com%2Fsteal");
    expect(evil.status).toBe(403);
    expect(evil.location).toBe("");
    const asked = await call("POST", "/api/auth/request-password-reset", {
      body: { email: `x-${RUN}@e2e.test`, redirectTo: "https://evil.example.com/steal" },
    });
    expect(asked.status).toBe(403);
  });

  test("one account gets at most five reset mails an hour, however the requests arrive", async () => {
    const u = await signUp("flood");
    for (let i = 0; i < 7; i++) {
      const r = await call("POST", "/api/auth/request-password-reset", { body: { email: u.email, redirectTo: "realbudget://reset-password" } });
      expect(r.status).toBe(200);
    }
    await waitForLink(u.email, "/api/auth/reset-password/", 5);
    await Bun.sleep(300);
    expect(linksTo(u.email, "/api/auth/reset-password/")).toHaveLength(5);
  });
});
