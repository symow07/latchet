import { test, expect, afterAll } from "bun:test";
import { app } from "../index";
import { deleteUsers, request, signUp, type E2EUser } from "../test-support/session";

/**
 * The email API as the app serves it — CORS, the session middleware, both
 * mounts, the error handlers — with real accounts and sessions. This test
 * environment configures no Google, Microsoft or forwarding, which is itself
 * a state the API must handle.
 */

const users: E2EUser[] = [];
afterAll(() => deleteUsers(users));

test("email oauth: the served callback needs no session and goes back to the app on an unknown state", async () => {
  for (const prefix of ["/api/v1", "/api"]) {
    const res = await app.fetch(new Request(`http://localhost${prefix}/email/oauth/gmail/callback?code=x&state=nope`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("realbudget://email/connected?provider=gmail&result=error&reason=invalid_state");
  }
  const odd = await app.fetch(new Request("http://localhost/api/v1/email/oauth/yahoo/callback?state=nope"));
  expect(odd.headers.get("location")).toBe("realbudget://email/connected?provider=unknown&result=error&reason=invalid_state");
});

test("findings api: a signed-in user gets their mailboxes and findings; an unconfigured server says so", async () => {
  const u = await signUp(app, "email-flow");
  users.push(u);
  const conns = await request(app, u.session, "GET", "/api/v1/email/connections");
  expect(conns.status).toBe(200);
  expect(conns.json.connections).toEqual([]);
  expect(conns.json.providers).toEqual({
    gmail: { configured: false, verified: false, capReached: false },
    outlook: { configured: false },
    forwarding: { configured: false },
  });
  const findings = await request(app, u.session, "GET", "/api/email/findings");
  expect(findings.status).toBe(200);
  expect(findings.json).toMatchObject({ findings: [], more: false });
  expect(await request(app, u.session, "POST", "/api/v1/email/connect/gmail", { returnUrl: "realbudget://email/connected" })).toMatchObject({
    status: 503,
    json: { error: "not_configured" },
  });
  expect(await request(app, u.session, "POST", "/api/v1/email/sync")).toMatchObject({ status: 202, json: { started: 0 } });
});

test("findings api: the phone's old /status, /inbox and /inbox/imported routes are gone", async () => {
  const u = await signUp(app, "email-flow-old");
  users.push(u);
  for (const [method, path] of [["GET", "/status"], ["GET", "/inbox"], ["POST", "/inbox/imported"]] as const) {
    for (const prefix of ["/api/v1/email", "/api/email"]) {
      expect((await request(app, u.session, method, `${prefix}${path}`, method === "POST" ? { ids: [] } : undefined)).status).toBe(404);
    }
  }
});

test("forwarding: the served webhook needs no session, and answers 503 until forwarding is configured", async () => {
  const res = await app.fetch(
    new Request("http://localhost/api/v1/email/inbound", {
      method: "POST",
      headers: { "content-type": "application/json", "x-inbound-secret": "anything" },
      body: JSON.stringify({ to: "u_abcdef@in.example", raw: Buffer.from("From: a@b.c\r\n\r\nhi").toString("base64") }),
    })
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "not_configured" });
});
