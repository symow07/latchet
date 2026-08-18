import { test, expect } from "bun:test";
import {
  verifyPlaidWebhook,
  sha256Hex,
  decodeJwtHeader,
  MAX_AGE_SECONDS,
  type PlaidJwk,
} from "./plaid-webhook";

function toBase64Url(bytes: Uint8Array | string): string {
  const b =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of b) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeKeypair() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as PlaidJwk & {
    kid?: string;
  };
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid: "key_1" } as PlaidJwk };
}

async function signToken(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "ES256", kid: "key_1", typ: "JWT" }
) {
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload)
  )}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
}

const body = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "item_abc",
});

async function freshToken(privateKey: CryptoKey, over: Record<string, unknown> = {}) {
  return signToken(privateKey, {
    iat: Math.floor(Date.now() / 1000),
    request_body_sha256: await sha256Hex(body),
    ...over,
  });
}

const deps = (jwk: PlaidJwk) => ({ getKey: async () => jwk });

test("a correctly signed webhook is accepted", async () => {
  const { privateKey, jwk } = await makeKeypair();
  const token = await freshToken(privateKey);

  expect(await verifyPlaidWebhook(token, body, deps(jwk))).toEqual({ ok: true });
});

test("a request with no verification header is rejected", async () => {
  const { jwk } = await makeKeypair();
  const result = await verifyPlaidWebhook(undefined, body, deps(jwk));

  expect(result.ok).toBe(false);
});

test("a token signed by the wrong key is rejected", async () => {
  const { privateKey } = await makeKeypair();
  const attacker = await makeKeypair();
  const token = await freshToken(privateKey);

  // Verified against a different public key than the one that signed it.
  const result = await verifyPlaidWebhook(token, body, deps(attacker.jwk));
  expect(result).toEqual({ ok: false, reason: "bad signature" });
});

test('alg "none" is rejected rather than trusted', async () => {
  const { jwk } = await makeKeypair();
  const forged = `${toBase64Url(
    JSON.stringify({ alg: "none", kid: "key_1" })
  )}.${toBase64Url(
    JSON.stringify({ iat: Math.floor(Date.now() / 1000) })
  )}.`;

  const result = await verifyPlaidWebhook(forged, body, deps(jwk));
  expect(result).toEqual({ ok: false, reason: "unsupported alg none" });
});

test("a valid signature over a different body is rejected", async () => {
  const { privateKey, jwk } = await makeKeypair();
  const token = await freshToken(privateKey);

  // Signature is genuine, but the payload has been swapped in flight.
  const tampered = JSON.stringify({
    webhook_code: "SYNC_UPDATES_AVAILABLE",
    item_id: "item_someone_else",
  });
  const result = await verifyPlaidWebhook(token, tampered, deps(jwk));
  expect(result).toEqual({ ok: false, reason: "body does not match signed digest" });
});

test("a replayed token past the freshness window is rejected", async () => {
  const { privateKey, jwk } = await makeKeypair();
  const issued = Math.floor(Date.now() / 1000) - MAX_AGE_SECONDS - 1;
  const token = await freshToken(privateKey, { iat: issued });

  const result = await verifyPlaidWebhook(token, body, deps(jwk));
  expect(result).toEqual({ ok: false, reason: "token is stale" });
});

test("a token just inside the freshness window is accepted", async () => {
  const { privateKey, jwk } = await makeKeypair();
  const issued = Math.floor(Date.now() / 1000) - (MAX_AGE_SECONDS - 10);
  const token = await freshToken(privateKey, { iat: issued });

  expect(await verifyPlaidWebhook(token, body, deps(jwk))).toEqual({ ok: true });
});

test("a token with no kid is rejected before any key lookup", async () => {
  const { privateKey, jwk } = await makeKeypair();
  const token = await signToken(
    privateKey,
    { iat: Math.floor(Date.now() / 1000) },
    { alg: "ES256", typ: "JWT" }
  );

  let lookups = 0;
  const result = await verifyPlaidWebhook(token, body, {
    getKey: async () => {
      lookups++;
      return jwk;
    },
  });

  expect(result).toEqual({ ok: false, reason: "token has no kid" });
  expect(lookups).toBe(0);
});

test("an unknown key id is rejected", async () => {
  const { privateKey } = await makeKeypair();
  const token = await freshToken(privateKey);

  const result = await verifyPlaidWebhook(token, body, { getKey: async () => null });
  expect(result).toEqual({ ok: false, reason: "unknown key id" });
});

test("an expired key is rejected", async () => {
  const { privateKey, jwk } = await makeKeypair();
  const token = await freshToken(privateKey);

  const result = await verifyPlaidWebhook(token, body, {
    getKey: async () => ({ ...jwk, expired_at: 1_700_000_000 }),
  });
  expect(result).toEqual({ ok: false, reason: "key is expired" });
});

test("the header decoder surfaces alg and kid", async () => {
  const { privateKey } = await makeKeypair();
  const token = await freshToken(privateKey);

  expect(decodeJwtHeader(token)).toMatchObject({ alg: "ES256", kid: "key_1" });
});

test("garbage in the header position does not throw", async () => {
  const { jwk } = await makeKeypair();
  const result = await verifyPlaidWebhook("not-a-jwt", body, deps(jwk));

  expect(result.ok).toBe(false);
});
