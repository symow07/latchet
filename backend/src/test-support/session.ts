/**
 * Real accounts and real sessions, made the way the phone makes them: a POST
 * to /api/auth/sign-up/email (or sign-in/email for a second device) through
 * the exported app, keeping the session cookie Better Auth sets. Every later
 * request carries that cookie in a `Cookie` header, as mobile/src/lib/api/api.ts
 * does.
 *
 * Each call comes from its own made-up client address (x-forwarded-for), so
 * the per-IP sign-up and sign-in limits (auth.ts) — shared, in Postgres, with
 * every other suite — are never what a test runs into.
 *
 * Imported only by tests.
 */
import { prisma } from "../prisma";

export interface Fetcher {
  fetch(request: Request): Response | Promise<Response>;
}

/** One signed-in session: what one phone holds. */
export interface Session {
  userId: string;
  /** The Cookie header value: every cookie the auth response set. */
  cookie: string;
}

export interface E2EUser {
  id: string;
  email: string;
  password: string;
  /** The session sign-up opened. */
  session: Session;
}

/** A client address no other request in the run uses. */
function freshAddress(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

/** name=value of every Set-Cookie header, joined as a Cookie header. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}

async function authPost(app: Fetcher, path: string, body: unknown): Promise<{ res: Response; json: any }> {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": freshAddress() },
      body: JSON.stringify(body),
    })
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { res, json };
}

function sessionFrom(res: Response, json: any, what: string): Session {
  if (res.status !== 200) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(json)}`);
  const userId = json?.user?.id;
  const cookie = cookieHeader(res);
  if (typeof userId !== "string" || !cookie.includes("session_token=")) {
    throw new Error(`${what}: no user or no session cookie in the response`);
  }
  return { userId, cookie };
}

/** A brand-new account, signed up over HTTP. Emails are unique per call. */
export async function signUp(app: Fetcher, label: string): Promise<E2EUser> {
  const email = `${label}-${crypto.randomUUID().slice(0, 12)}@e2e.test`;
  const password = `pw-${crypto.randomUUID()}-Xy9!`;
  const { res, json } = await authPost(app, "/api/auth/sign-up/email", { email, password, name: label });
  const session = sessionFrom(res, json, `sign-up ${label}`);
  return { id: session.userId, email, password, session };
}

/** A second session for the same account: another phone signing in. */
export async function signIn(app: Fetcher, user: E2EUser): Promise<Session> {
  const { res, json } = await authPost(app, "/api/auth/sign-in/email", { email: user.email, password: user.password });
  const session = sessionFrom(res, json, `sign-in ${user.email}`);
  if (session.userId !== user.id) throw new Error(`sign-in ${user.email} opened a session for another user`);
  return session;
}

/** A JSON request with a session, for the REST routes the phone calls. */
export async function request(
  app: Fetcher,
  session: Session,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { cookie: session.cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** Delete the accounts and everything of theirs, tombstones included (they have no foreign key). */
export async function deleteUsers(users: readonly { id: string }[]): Promise<void> {
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.syncTombstone.deleteMany({ where: { userId: { in: ids } } });
}
