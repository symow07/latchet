import { test, expect } from "bun:test";
import { ExpiringMap } from "./expiring-map";

// Moved here from the Gmail OAuth redirect helper's test file when that path
// was deleted. ExpiringMap holds Plaid's pending Link sessions.

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
