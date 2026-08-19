import { test, expect } from "bun:test";
import { safeReturnUrl } from "./return-url";
import { secretsMatch } from "./secrets";
import { ExpiringMap } from "./expiring-map";

const FALLBACK = "realbudget://email-connected";

test("our own deep link is allowed through", () => {
  expect(safeReturnUrl("realbudget://email-connected", FALLBACK)).toBe(
    "realbudget://email-connected"
  );
});

test("an external host is refused", () => {
  // The callback redirects to `${returnUrl}?status=success&email=<address>`,
  // so an unchecked value hands the user's email to whoever asked.
  expect(safeReturnUrl("https://evil.example.com/steal", FALLBACK)).toBe(FALLBACK);
  expect(safeReturnUrl("http://127.0.0.1:9000", FALLBACK)).toBe(FALLBACK);
});

test("a lookalike scheme is refused", () => {
  expect(safeReturnUrl("realbudget-evil://x", FALLBACK)).toBe(FALLBACK);
  expect(safeReturnUrl("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
});

test("embedded credentials are refused", () => {
  expect(safeReturnUrl("realbudget://user:pass@host/path", FALLBACK)).toBe(FALLBACK);
});

test("missing or unparseable input falls back", () => {
  expect(safeReturnUrl(undefined, FALLBACK)).toBe(FALLBACK);
  expect(safeReturnUrl(null, FALLBACK)).toBe(FALLBACK);
  expect(safeReturnUrl("", FALLBACK)).toBe(FALLBACK);
  expect(safeReturnUrl("not a url", FALLBACK)).toBe(FALLBACK);
});

test("a renamed app scheme can be allowed explicitly", () => {
  expect(safeReturnUrl("cowry://done", FALLBACK, ["cowry:"])).toBe("cowry://done");
});

// ── Secret comparison ────────────────────────────────────────────────────────

test("matching secrets compare equal", () => {
  expect(secretsMatch("s3cret-value", "s3cret-value")).toBe(true);
});

test("differing secrets do not match", () => {
  expect(secretsMatch("s3cret-value", "s3cret-valuf")).toBe(false);
  expect(secretsMatch("short", "a-much-longer-secret")).toBe(false);
});

test("absent secrets never match", () => {
  expect(secretsMatch(undefined, "expected")).toBe(false);
  expect(secretsMatch("provided", undefined)).toBe(false);
  expect(secretsMatch("", "")).toBe(false);
});

// ── Expiring map ─────────────────────────────────────────────────────────────

test("entries are readable before they expire", () => {
  const map = new ExpiringMap<string, number>(60_000);
  map.set("a", 1);
  expect(map.get("a")).toBe(1);
});

test("an expired entry reads as absent and is discarded", () => {
  const map = new ExpiringMap<string, number>(-1); // already expired
  map.set("a", 1);
  expect(map.get("a")).toBeUndefined();
  expect(map.size).toBe(0);
});

test("sweeping clears abandoned OAuth state", () => {
  // Every abandoned consent screen used to leave an entry for the lifetime of
  // the process, since state was only deleted on a successful callback.
  const map = new ExpiringMap<string, string>(1_000);
  map.set("state-1", "user-1");
  map.set("state-2", "user-2");
  expect(map.size).toBe(2);

  expect(map.sweep(Date.now() + 2_000)).toBe(2);
  expect(map.size).toBe(0);
});

test("sweeping leaves live entries alone", () => {
  const map = new ExpiringMap<string, string>(60_000);
  map.set("live", "user");
  expect(map.sweep()).toBe(0);
  expect(map.get("live")).toBe("user");
});

test("delete removes an entry outright", () => {
  const map = new ExpiringMap<string, string>(60_000);
  map.set("a", "1");
  expect(map.delete("a")).toBe(true);
  expect(map.get("a")).toBeUndefined();
});
