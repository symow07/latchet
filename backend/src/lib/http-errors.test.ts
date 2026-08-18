import { test, expect } from "bun:test";
import { mapError, newRequestId } from "./http-errors";

/** Stand-in for a Prisma error, which carries a `code` string. */
const prismaError = (code: string) =>
  Object.assign(new Error(`Prisma error ${code}`), { code });

test("a missing record is a 404, not a 500", () => {
  // P2025 is what a PUT or DELETE with a wrong id throws. It previously
  // surfaced as an opaque 500, indistinguishable from the database being down.
  expect(mapError(prismaError("P2025"))).toEqual({
    status: 404,
    code: "not_found",
    message: "Not found",
  });
});

test("a uniqueness clash is a 409", () => {
  expect(mapError(prismaError("P2002")).status).toBe(409);
});

test("a broken foreign key is a 400", () => {
  expect(mapError(prismaError("P2003")).status).toBe(400);
});

test("an unknown Prisma code is still a 500", () => {
  expect(mapError(prismaError("P9999")).status).toBe(500);
});

test("a Zod failure is a 400", () => {
  const zodError = Object.assign(new Error("bad input"), {
    name: "ZodError",
    issues: [{ path: ["amount"], message: "Required" }],
  });
  expect(mapError(zodError)).toEqual({
    status: 400,
    code: "invalid_request",
    message: "Invalid request",
  });
});

test("an HTTPException keeps its own status", () => {
  const unauthorized = Object.assign(new Error("Unauthorized"), { status: 401 });
  expect(mapError(unauthorized)).toMatchObject({ status: 401, code: "unauthorized" });

  const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });
  expect(mapError(forbidden)).toMatchObject({ status: 403, code: "forbidden" });
});

test("an out-of-range status is not trusted as an HTTP status", () => {
  const weird = Object.assign(new Error("nope"), { status: 42 });
  expect(mapError(weird).status).toBe(500);
});

test("an unrecognised error never leaks its message to the client", () => {
  const leaky = new Error("connect ECONNREFUSED 10.0.0.5:5432 as user 'admin'");
  const mapped = mapError(leaky);

  expect(mapped.status).toBe(500);
  expect(mapped.message).toBe("Something went wrong");
  expect(mapped.message).not.toContain("ECONNREFUSED");
});

test("non-Error throws do not crash the mapper", () => {
  expect(mapError("a string").status).toBe(500);
  expect(mapError(null).status).toBe(500);
  expect(mapError(undefined).status).toBe(500);
  expect(mapError({ nothing: true }).status).toBe(500);
});

test("request ids are short and distinct", () => {
  const a = newRequestId();
  const b = newRequestId();
  expect(a).toHaveLength(8);
  expect(a).not.toBe(b);
});

// ── The installed handlers, exercised against a real Hono app ────────────────

import { Hono } from "hono";
import { installErrorHandlers } from "./http-errors";

function appThatThrows(err: unknown, isProduction = false) {
  const app = new Hono<{ Variables: { requestId: string } }>();
  installErrorHandlers(app as never, { isProduction });
  app.get("/boom", () => {
    throw err;
  });
  app.get("/fine", (c) => c.json({ ok: true }));
  return app;
}

test("a wrong-id route answers 404 with a request id", async () => {
  const res = await appThatThrows(prismaError("P2025")).request("/boom");
  const body = (await res.json()) as { error: string; code: string; requestId: string };

  expect(res.status).toBe(404);
  expect(body.code).toBe("not_found");
  expect(body.requestId).toHaveLength(8);
});

test("an unmatched path answers a JSON 404, not an HTML default", async () => {
  const res = await appThatThrows(new Error("unused")).request("/no-such-route");
  const body = (await res.json()) as { code: string; requestId: string };

  expect(res.status).toBe(404);
  expect(body.code).toBe("not_found");
  expect(body.requestId).toHaveLength(8);
});

test("production responses carry no stack trace", async () => {
  const leaky = new Error("connect ECONNREFUSED 10.0.0.5:5432");
  const res = await appThatThrows(leaky, true).request("/boom");
  const body = (await res.json()) as Record<string, unknown>;

  expect(res.status).toBe(500);
  expect(body.detail).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
});

test("development responses do include detail, for debugging", async () => {
  const res = await appThatThrows(new Error("kaboom"), false).request("/boom");
  const body = (await res.json()) as Record<string, unknown>;

  expect(res.status).toBe(500);
  expect(String(body.detail)).toContain("kaboom");
});

test("successful requests are untouched", async () => {
  const res = await appThatThrows(new Error("unused")).request("/fine");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("each request gets its own id", async () => {
  const app = appThatThrows(prismaError("P2002"));
  const a = (await (await app.request("/boom")).json()) as { requestId: string };
  const b = (await (await app.request("/boom")).json()) as { requestId: string };

  expect(a.requestId).not.toBe(b.requestId);
});
