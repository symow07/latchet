/**
 * Maps thrown errors to HTTP responses, and installs the handlers that use it.
 *
 * Without this every Prisma error escaped as an opaque 500: a PUT or DELETE
 * with a wrong id (P2025) looked identical to the database being down, and
 * nothing in the response let a report be tied to a log line.
 *
 * Dependency-free — errors are identified by shape, not by importing Prisma —
 * so the mapping can be unit-tested on its own.
 */

export interface MappedError {
  status: number;
  /** Stable, machine-readable code for the client. */
  code: string;
  /** Safe to show a user; never contains internals. */
  message: string;
}

/** Prisma error codes worth distinguishing, and what they actually mean. */
const PRISMA_ERRORS: Record<string, MappedError> = {
  // "An operation failed because it depends on one or more records that were
  // required but not found" — i.e. the id in the URL doesn't exist.
  P2025: { status: 404, code: "not_found", message: "Not found" },
  P2002: { status: 409, code: "conflict", message: "That already exists" },
  P2003: {
    status: 400,
    code: "invalid_reference",
    message: "Referenced record does not exist",
  },
  P2000: {
    status: 400,
    code: "value_too_long",
    message: "A value is too long for its field",
  },
  P2014: {
    status: 400,
    code: "invalid_relation",
    message: "That change would break a required relation",
  },
};

function hasCode(err: unknown): err is { code: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}

function isZodError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "ZodError" || Array.isArray((err as { issues?: unknown }).issues);
}

/** Hono's HTTPException carries its own intended status. */
function honoStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status <= 599) return status;
  return null;
}

export function mapError(err: unknown): MappedError {
  if (hasCode(err)) {
    const mapped = PRISMA_ERRORS[err.code];
    if (mapped) return mapped;
  }

  if (isZodError(err)) {
    return { status: 400, code: "invalid_request", message: "Invalid request" };
  }

  const status = honoStatus(err);
  if (status !== null) {
    return {
      status,
      code: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "error",
      message: err instanceof Error && err.message ? err.message : "Request failed",
    };
  }

  // Anything unrecognised is a bug on our side. The detail goes to the log,
  // keyed by request id — never to the client.
  return { status: 500, code: "internal_error", message: "Something went wrong" };
}

/** Short, unique-enough id to correlate a client report with a server log. */
export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Minimal surface of the Hono app the handlers need. */
interface ErrorHandlingApp {
  use(path: string, handler: (c: any, next: () => Promise<void>) => Promise<void>): unknown;
  onError(handler: (err: Error, c: any) => Response): unknown;
  notFound(handler: (c: any) => Response): unknown;
}

/**
 * Install request-id tagging, the error mapper and a JSON 404.
 *
 * Kept here rather than inline in index.ts so the behaviour can be exercised
 * against a throwaway app in tests — the shipped handlers are the tested ones.
 */
export function installErrorHandlers(
  app: ErrorHandlingApp,
  opts: { isProduction: boolean }
): void {
  // Must run before anything that can throw, so every response has an id.
  app.use("*", async (c, next) => {
    c.set("requestId", newRequestId());
    await next();
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? newRequestId();
    const { status, code, message } = mapError(err);

    // 5xx is our bug and gets full detail in the log; 4xx is the caller's.
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    if (status >= 500) {
      console.error(`[error:${requestId}] ${c.req.method} ${c.req.path} ${status}`, detail);
    } else {
      console.warn(`[error:${requestId}] ${c.req.method} ${c.req.path} ${status} ${code}`);
    }

    return c.json(
      {
        error: message,
        code,
        requestId,
        // Stack traces never leave the server in production.
        ...(!opts.isProduction && status >= 500 ? { detail } : {}),
      },
      status
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: `No route for ${c.req.method} ${c.req.path}`,
        code: "not_found",
        requestId: c.get("requestId") ?? newRequestId(),
      },
      404
    )
  );
}
