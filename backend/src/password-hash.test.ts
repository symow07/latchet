import { test, expect } from "bun:test";
import { parsePasswordHash } from "./auth";

test("a current hash carries its iteration count", () => {
  const parsed = parsePasswordHash("pbkdf2:600000:abcd1234:deadbeef");
  expect(parsed).toEqual({
    iterations: 600_000,
    saltHex: "abcd1234",
    keyHex: "deadbeef",
  });
});

test("a pre-existing hash is read at the old cost", () => {
  // Hashes written before the iteration count was recorded have three parts.
  // Reading them at anything other than 100k would lock every existing user out.
  const parsed = parsePasswordHash("pbkdf2:abcd1234:deadbeef");
  expect(parsed).toEqual({
    iterations: 100_000,
    saltHex: "abcd1234",
    keyHex: "deadbeef",
  });
});

test("raising the cost again stays readable", () => {
  // The whole point of storing the count: a future bump is just a new value.
  expect(parsePasswordHash("pbkdf2:1000000:aa:bb")?.iterations).toBe(1_000_000);
});

test("malformed hashes are rejected rather than guessed at", () => {
  expect(parsePasswordHash("scrypt:abcd:beef")).toBeNull();
  expect(parsePasswordHash("pbkdf2:abcd")).toBeNull();
  expect(parsePasswordHash("pbkdf2:a:b:c:d")).toBeNull();
  expect(parsePasswordHash("")).toBeNull();
});

test("a non-numeric iteration count is rejected", () => {
  expect(parsePasswordHash("pbkdf2:many:abcd:beef")).toBeNull();
  expect(parsePasswordHash("pbkdf2:0:abcd:beef")).toBeNull();
  expect(parsePasswordHash("pbkdf2:-5:abcd:beef")).toBeNull();
});
