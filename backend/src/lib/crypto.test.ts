import { test, expect } from "bun:test";

// crypto.ts derives its key from BETTER_AUTH_SECRET via env validation, so set
// it before importing the module under test.
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "test-secret-for-crypto-roundtrip";

const { encryptSecret, decryptSecret } = await import("./crypto");

test("encrypt → decrypt round-trips the original plaintext", () => {
  const secret = "access-sandbox-1234567890abcdef";
  const enc = encryptSecret(secret);
  expect(enc).not.toBe(secret);
  expect(decryptSecret(enc)).toBe(secret);
});

test("ciphertext is non-deterministic (random IV per call)", () => {
  const a = encryptSecret("same-input");
  const b = encryptSecret("same-input");
  expect(a).not.toBe(b);
  expect(decryptSecret(a)).toBe("same-input");
  expect(decryptSecret(b)).toBe("same-input");
});

test("tampered ciphertext fails authentication", () => {
  const enc = encryptSecret("important");
  const [iv, tag, data] = enc.split(".");
  // Flip a byte in the ciphertext segment.
  const tamperedData = Buffer.from(data!, "base64");
  tamperedData[0] = tamperedData[0]! ^ 0xff;
  const tampered = `${iv}.${tag}.${tamperedData.toString("base64")}`;
  expect(() => decryptSecret(tampered)).toThrow();
});

test("malformed payload throws", () => {
  expect(() => decryptSecret("not-a-valid-payload")).toThrow();
});
