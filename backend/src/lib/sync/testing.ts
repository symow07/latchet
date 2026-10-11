/**
 * Test support for the sync suites: real users with real sessions, driven
 * through the exported app. Not a test file itself, and imported only by tests.
 *
 * Users are created with Better Auth's own server API rather than by POSTing
 * to /api/auth/sign-up: the result is the same user and session, without
 * spending the sign-up rate limit other suites share. Requests then carry the
 * session token as a bearer token, which the session middleware in index.ts
 * resolves exactly as it would for the phone.
 */
import { auth } from "../../auth";
import { prisma } from "../../prisma";

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export interface Fetcher {
  fetch(request: Request): Response | Promise<Response>;
}

/** A fresh user with a live session. Emails are unique per call. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `${label}-${crypto.randomUUID().slice(0, 12)}@sync.test`;
  const result = await auth.api.signUpEmail({
    body: { email, password: `pw-${crypto.randomUUID()}-Xy9!`, name: label },
  });
  if (!result.token) throw new Error("sign-up returned no session token");
  return { id: result.user.id, email, token: result.token };
}

/** Delete test users and everything of theirs, tombstones included (no foreign key). */
export async function deleteTestUsers(users: readonly TestUser[]): Promise<void> {
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.syncTombstone.deleteMany({ where: { userId: { in: ids } } });
}

/** An HTTP client for one user (or none) against an in-process app. */
export function client(app: Fetcher, user?: TestUser) {
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (user) headers.authorization = `Bearer ${user.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      })
    );
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown) => call("POST", path, body),
    put: (path: string, body?: unknown) => call("PUT", path, body),
    del: (path: string) => call("DELETE", path),
  };
}
