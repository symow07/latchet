import { test, expect, afterEach } from "bun:test";
import {
  decodeBase64Message,
  extractConfirmationCode,
  isGmailForwardConfirm,
  legacyPayloadToMime,
  parseInboundToken,
} from "./inbound-email";
import { parseMime } from "./email-parse";
import worker from "../../docs/inbound-email-worker.js";

// ── Routing and Gmail's confirmation ─────────────────────────────────────────

test("extracts token from a bare address", () => {
  expect(parseInboundToken("u_ab12cd34@in.example.com")).toBe("ab12cd34");
});

test("extracts token from a display-name form", () => {
  expect(parseInboundToken('"Latchet Inbox" <u_ff00aa11@in.example.com>')).toBe("ff00aa11");
});

test("lowercases mixed-case tokens (addresses are case-insensitive)", () => {
  expect(parseInboundToken("U_AB12CD34@in.example.com")).toBe("ab12cd34");
});

test("returns null for non-matching recipients", () => {
  expect(parseInboundToken("someone@example.com")).toBeNull();
  expect(parseInboundToken("")).toBeNull();
  expect(parseInboundToken("user_x@example.com")).toBeNull();
  expect(parseInboundToken("menu_ab12cd34@example.com")).toBeNull();
});

test("detects Gmail confirmation by sender", () => {
  expect(isGmailForwardConfirm("forwarding-noreply@google.com", "anything")).toBe(true);
  expect(isGmailForwardConfirm("Gmail Team <forwarding-noreply@google.com>", "x")).toBe(true);
});

test("detects Gmail confirmation by subject", () => {
  expect(isGmailForwardConfirm("other@x.com", "Gmail Forwarding Confirmation - Receive Mail")).toBe(true);
});

test("regular receipts are not confirmations", () => {
  expect(isGmailForwardConfirm("billing@netflix.com", "Your Netflix receipt")).toBe(false);
});

test("pulls the numeric code from subject or body", () => {
  expect(extractConfirmationCode("(#584031299) Gmail Forwarding Confirmation", "")).toBe("584031299");
  expect(extractConfirmationCode("Confirmation", "your code is 123456 — enter it in Gmail")).toBe("123456");
});

test("ignores short numbers and returns null when absent", () => {
  expect(extractConfirmationCode("Order 42", "totally 99 problems")).toBeNull();
});

// ── The payload ──────────────────────────────────────────────────────────────

test("forwarding: the raw message comes back byte for byte from the worker's base64", () => {
  const bytes = new Uint8Array([0x46, 0x72, 0x6f, 0x6d, 0x3a, 0x20, 0xe9, 0x80, 0x00, 0xff, 0x0d, 0x0a]);
  const b64 = Buffer.from(bytes).toString("base64");
  expect(Buffer.from(decodeBase64Message(b64)!).equals(Buffer.from(bytes))).toBe(true);
  expect(Buffer.from(decodeBase64Message(Buffer.from(bytes).toString("base64url"))!).equals(Buffer.from(bytes))).toBe(true);
  expect(Buffer.from(decodeBase64Message(b64.replace(/(.{4})/g, "$1\r\n"))!).equals(Buffer.from(bytes))).toBe(true);
  expect(decodeBase64Message("")).toBeNull();
  expect(decodeBase64Message("not base64!")).toBeNull();
});

test("forwarding: an old worker's decoded fields become a message the parser reads, with no header injection", async () => {
  const raw = legacyPayloadToMime({
    from: "Café Crème <billing@cafe-creme.fr>",
    subject: "Votre reçu\r\nBcc: victim@example.com",
    text: "Montant payé : 4,50 €",
  });
  const msg = await parseMime(raw);
  expect(msg.fromAddress).toBe("billing@cafe-creme.fr");
  expect(msg.fromName).toBe("Café Crème");
  expect(msg.subject).toBe("Votre reçu Bcc: victim@example.com");
  expect(msg.text).toContain("4,50 €");
  expect(Buffer.from(raw).toString("utf8")).not.toMatch(/^Bcc:/m);
});

// ── The Cloudflare Email Worker, under bun with a fake message ───────────────

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A message as Cloudflare hands it to `email()`. */
function cfMessage(to: string, raw: Uint8Array) {
  const seen = { rejected: null as string | null, forwarded: [] as string[] };
  const message = {
    to,
    from: "sender@example.com",
    raw: new Response(raw).body,
    rawSize: raw.byteLength,
    headers: new Headers({ from: "Netflix <info@account.netflix.com>" }),
    setReject(reason: string) {
      seen.rejected = reason;
    },
    async forward(address: string) {
      seen.forwarded.push(address);
    },
  };
  return { message, seen };
}

/** A Workers KV namespace in memory. */
function kv() {
  const store = new Map<string, string>();
  return {
    store,
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async delete(k: string) {
      store.delete(k);
    },
    async list({ prefix, limit }: { prefix: string; limit: number }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) };
    },
  };
}

type Call = { url: string; headers: Headers; body: { to: string; raw: string } };
/** Stub fetch: answers in order (a status, or "down" for a network error), recording each call. */
function backend(answers: (number | "down" | { status: number; json: unknown })[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    const a = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (a === "down") throw new TypeError("fetch failed");
    if (typeof a === "number") return new Response(JSON.stringify({}), { status: a });
    return new Response(JSON.stringify(a.json), { status: a.status });
  }) as typeof fetch;
  return calls;
}

const ENV = { BACKEND_URL: "https://latchet.example/", INBOUND_SECRET: "s3cret", RETRY_DELAYS_MS: "0,0,0" };
// A real message with non-ASCII bytes in an 8-bit body: the worker must not touch them.
const RAW = new Uint8Array(Buffer.concat([
  Buffer.from("From: Netflix <info@account.netflix.com>\r\nSubject: Your receipt\r\nContent-Type: text/plain; charset=ISO-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nMontant : 13,49 "),
  Buffer.from([0xa4, 0xe9, 0x0d, 0x0a]),
]));
const TO = "u_ab12cd34ef56ab12cd@in.latchet.example";

test("forwarding: the worker posts the raw message untouched, base64, with the shared secret", async () => {
  const calls = backend([200]);
  const { message, seen } = cfMessage(TO, RAW);
  await worker.email(message, ENV);
  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toBe("https://latchet.example/api/v1/email/inbound");
  expect(calls[0]!.headers.get("x-inbound-secret")).toBe("s3cret");
  expect(calls[0]!.body.to).toBe(TO);
  expect(Buffer.from(calls[0]!.body.raw, "base64").equals(Buffer.from(RAW))).toBe(true);
  expect(seen).toEqual({ rejected: null, forwarded: [] });
});

test("forwarding: the worker retries a sleeping or failing backend instead of bouncing", async () => {
  const calls = backend(["down", 503, 200]);
  const { message, seen } = cfMessage(TO, RAW);
  await worker.email(message, ENV);
  expect(calls.length).toBe(3);
  expect(seen.rejected).toBeNull();
});

test("forwarding: during an outage the message is parked, then the cron delivers it — never a bounce", async () => {
  const PARKED = kv();
  backend([503]);
  const { message, seen } = cfMessage(TO, RAW);
  await worker.email(message, { ...ENV, PARKED });
  expect(seen.rejected).toBeNull();
  expect(PARKED.store.size).toBe(1);
  const parked = JSON.parse([...PARKED.store.values()][0]!);
  expect(Buffer.from(parked.raw, "base64").equals(Buffer.from(RAW))).toBe(true);

  // Still down at the next cron: kept.
  backend(["down"]);
  await worker.scheduled({}, { ...ENV, PARKED });
  expect(PARKED.store.size).toBe(1);
  // Back up: delivered once and removed.
  const calls = backend([200]);
  await worker.scheduled({}, { ...ENV, PARKED });
  expect(calls.length).toBe(1);
  expect(calls[0]!.body).toEqual(parked);
  expect(PARKED.store.size).toBe(0);
});

test("forwarding: the worker rejects only addresses that are not ours", async () => {
  // Not a Latchet address at all: refused without asking the backend.
  let calls = backend([200]);
  for (const to of ["postmaster@in.latchet.example", "u_@in.latchet.example", "u_ab12cd34ef56ab12cd@other.example"]) {
    const { message, seen } = cfMessage(to, RAW);
    await worker.email(message, { ...ENV, INBOUND_DOMAIN: "in.latchet.example" });
    expect(seen.rejected).toBe("Address does not exist");
  }
  expect(calls.length).toBe(0);

  // A well-formed address no user has: the backend says so, and only then is it refused.
  calls = backend([{ status: 404, json: { error: "unknown_recipient" } }]);
  const unknown = cfMessage(TO, RAW);
  await worker.email(unknown.message, ENV);
  expect(unknown.seen.rejected).toBe("Address does not exist");
  expect(calls.length).toBe(1);

  // Our own misconfiguration (a wrong secret, a wrong URL) is not the sender's problem: kept.
  for (const answer of [401, 404, 400]) {
    const PARKED = kv();
    backend([answer]);
    const { message, seen } = cfMessage(TO, RAW);
    await worker.email(message, { ...ENV, PARKED });
    expect(seen.rejected).toBeNull();
    expect(PARKED.store.size).toBe(1);
  }
});

test("forwarding: without a KV namespace the message goes to the fallback mailbox", async () => {
  backend(["down"]);
  const { message, seen } = cfMessage(TO, RAW);
  await worker.email(message, { ...ENV, FALLBACK_FORWARD: "ops@latchet.example" });
  expect(seen).toEqual({ rejected: null, forwarded: ["ops@latchet.example"] });
});

test("forwarding: with nowhere to keep it, the worker throws rather than reject the mail", async () => {
  backend([500]);
  const { message, seen } = cfMessage(TO, RAW);
  await expect(worker.email(message, ENV)).rejects.toThrow("Latchet backend unavailable");
  expect(seen.rejected).toBeNull();
});

test("forwarding: without a native encoder the worker's plain-JS base64 gives the same bytes", async () => {
  const native = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");
  const NodeBuffer = globalThis.Buffer;
  const big = new Uint8Array(200_000).map((_, i) => (i * 7919) % 256);
  const calls = backend([200]);
  const { message } = cfMessage(TO, big);
  try {
    if (native) delete (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
    (globalThis as { Buffer?: unknown }).Buffer = undefined;
    await worker.email(message, ENV);
  } finally {
    if (native) Object.defineProperty(Uint8Array.prototype, "toBase64", native);
    (globalThis as { Buffer?: unknown }).Buffer = NodeBuffer;
  }
  expect(Buffer.from(calls[0]!.body.raw, "base64").equals(Buffer.from(big))).toBe(true);
});
