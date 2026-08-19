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

// ── Key decoupling (TOKEN_ENCRYPTION_KEY) ────────────────────────────────────

import {
  deriveLegacyKey,
  deriveTokenKey,
  encryptWith,
  decryptWith,
  type CryptoKeys,
} from "./crypto";

const AUTH_SECRET_OLD = "auth-secret-original-at-least-32-chars";
const AUTH_SECRET_NEW = "auth-secret-ROTATED-at-least-32-chars!";
const TOKEN_KEY = "token-encryption-key-at-least-32-chars";

const legacyOnly = (authSecret: string): CryptoKeys => ({
  legacy: deriveLegacyKey(authSecret),
  current: null,
});

const withTokenKey = (authSecret: string, tokenKey: string): CryptoKeys => ({
  legacy: deriveLegacyKey(authSecret),
  current: deriveTokenKey(tokenKey),
});

test("v1 ciphertext written before the split still decrypts", () => {
  // Nothing already in the database may become unreadable by deploying this.
  const v1 = encryptWith("access-sandbox-legacy", legacyOnly(AUTH_SECRET_OLD));
  expect(v1.startsWith("v2.")).toBe(false);

  // Read back by a process that now has a token key configured.
  const after = withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY);
  expect(decryptWith(v1, after)).toBe("access-sandbox-legacy");
});

test("a token key produces versioned ciphertext", () => {
  const enc = encryptWith("access-sandbox-new", withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY));
  expect(enc.startsWith("v2.")).toBe(true);
  expect(enc.split(".")).toHaveLength(4);
});

test("v2 round-trips", () => {
  const keys = withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY);
  expect(decryptWith(encryptWith("round-trip", keys), keys)).toBe("round-trip");
});

test("rotating BETTER_AUTH_SECRET no longer destroys stored tokens", () => {
  // This is the entire point of the change. Previously the auth secret *was*
  // the encryption key, so rotating it made every Plaid and Gmail token
  // undecryptable and forced every user to relink.
  const before = withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY);
  const enc = encryptWith("access-sandbox-survives", before);

  const afterRotation = withTokenKey(AUTH_SECRET_NEW, TOKEN_KEY);
  expect(decryptWith(enc, afterRotation)).toBe("access-sandbox-survives");
});

test("rotating the auth secret would have destroyed v1 tokens — the old behaviour", () => {
  // Documents why the coupling mattered: the same rotation against v1
  // ciphertext fails, which is what users would have experienced.
  const v1 = encryptWith("access-sandbox-legacy", legacyOnly(AUTH_SECRET_OLD));
  expect(() => decryptWith(v1, legacyOnly(AUTH_SECRET_NEW))).toThrow();
});

test("the two derivations produce different keys", () => {
  // A bare SHA-256 of the auth secret must never coincide with the HKDF output.
  expect(deriveLegacyKey(TOKEN_KEY).equals(deriveTokenKey(TOKEN_KEY))).toBe(false);
});

test("derived keys are 32 bytes, as AES-256 requires", () => {
  expect(deriveLegacyKey(AUTH_SECRET_OLD)).toHaveLength(32);
  expect(deriveTokenKey(TOKEN_KEY)).toHaveLength(32);
});

test("key derivation is deterministic", () => {
  expect(deriveTokenKey(TOKEN_KEY).equals(deriveTokenKey(TOKEN_KEY))).toBe(true);
});

test("a tampered v2 auth tag still throws", () => {
  const keys = withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY);
  const [prefix, iv, tag, data] = encryptWith("important", keys).split(".");

  const tamperedTag = Buffer.from(tag!, "base64");
  tamperedTag[0] = tamperedTag[0]! ^ 0xff;

  expect(() =>
    decryptWith(`${prefix}.${iv}.${tamperedTag.toString("base64")}.${data}`, keys)
  ).toThrow();
});

test("a tampered v2 body still throws", () => {
  const keys = withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY);
  const [prefix, iv, tag, data] = encryptWith("important", keys).split(".");

  const tamperedData = Buffer.from(data!, "base64");
  tamperedData[0] = tamperedData[0]! ^ 0xff;

  expect(() =>
    decryptWith(`${prefix}.${iv}.${tag}.${tamperedData.toString("base64")}`, keys)
  ).toThrow();
});

test("v2 ciphertext cannot be read with the wrong token key", () => {
  const enc = encryptWith("secret", withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY));
  const wrong = withTokenKey(AUTH_SECRET_OLD, "a-completely-different-key-32chars!!");
  expect(() => decryptWith(enc, wrong)).toThrow();
});

test("losing the token key gives a message that says what happened", () => {
  const enc = encryptWith("secret", withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY));
  expect(() => decryptWith(enc, legacyOnly(AUTH_SECRET_OLD))).toThrow(
    /TOKEN_ENCRYPTION_KEY is not set/
  );
});

test("malformed payloads are rejected in both formats", () => {
  const keys = withTokenKey(AUTH_SECRET_OLD, TOKEN_KEY);
  expect(() => decryptWith("nonsense", keys)).toThrow();
  expect(() => decryptWith("v2.only.three", keys)).toThrow();
  expect(() => decryptWith("v9.a.b.c", keys)).toThrow();
});
