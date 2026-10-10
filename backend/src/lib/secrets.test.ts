import { test, expect } from "bun:test";
import { secretsMatch } from "./secrets";

// Moved here from the Gmail OAuth redirect helper's test file when that path
// was deleted. secretsMatch guards the inbound-email webhook.

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
