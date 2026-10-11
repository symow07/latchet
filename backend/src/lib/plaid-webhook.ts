/**
 * Plaid webhook verification.
 *
 * Plaid signs every webhook with an ES256 JWT in the `Plaid-Verification`
 * header. The JWT's `request_body_sha256` claim binds the signature to the
 * exact body, so verifying both proves the request came from Plaid and was not
 * tampered with. Without this anyone could POST a SYNC_UPDATES_AVAILABLE body
 * and force unbounded /transactions/sync runs against our Plaid quota and our
 * database.
 *
 * Dependency-free (WebCrypto only) so it can be unit-tested without network.
 */

export interface PlaidJwk {
  kty: string;
  crv: string;
  kid?: string;
  x: string;
  y: string;
  alg?: string;
  use?: string;
  /** Epoch seconds; set once Plaid rotates a key out of service. */
  expired_at?: number | null;
}

export interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

export interface JwtPayload {
  iat?: number;
  request_body_sha256?: string;
}

/** Plaid's recommended tolerance for replayed webhooks. */
export const MAX_AGE_SECONDS = 5 * 60;

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment<T>(segment: string | undefined): T | null {
  if (!segment) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    return null;
  }
}

export function decodeJwtHeader(token: string): JwtHeader | null {
  return decodeSegment<JwtHeader>(token.split(".")[0]);
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  return decodeSegment<JwtPayload>(token.split(".")[1]);
}

/** Lowercase hex SHA-256 of a string, matching Plaid's request_body_sha256. */
export async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body)
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** Constant-time comparison for the body digest. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify the JWS signature of an ES256 token against a JWK.
 *
 * JWS encodes the ECDSA signature as raw r||s, which is exactly the format
 * WebCrypto's ECDSA verify expects — no DER unwrapping needed.
 */
export async function verifyJws(token: string, jwk: PlaidJwk): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
  } catch {
    return false;
  }
}

export interface VerifyDeps {
  /** Fetch (and ideally cache) a verification key by its `kid`. */
  getKey(keyId: string): Promise<PlaidJwk | null>;
  /** Epoch seconds; injectable for tests. */
  now?(): number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Full verification: algorithm, key, signature, body digest and freshness.
 * Every failure path returns a reason rather than throwing so the caller can
 * log it and answer 401 without leaking detail to the caller.
 */
export async function verifyPlaidWebhook(
  token: string | undefined | null,
  rawBody: string,
  deps: VerifyDeps
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "missing Plaid-Verification header" };

  const header = decodeJwtHeader(token);
  if (!header) return { ok: false, reason: "malformed token header" };
  // Reject anything but ES256 — notably "none", the classic JWT bypass.
  if (header.alg !== "ES256") return { ok: false, reason: `unsupported alg ${header.alg}` };
  if (!header.kid) return { ok: false, reason: "token has no kid" };

  const jwk = await deps.getKey(header.kid);
  if (!jwk) return { ok: false, reason: "unknown key id" };
  if (jwk.expired_at) return { ok: false, reason: "key is expired" };

  if (!(await verifyJws(token, jwk))) return { ok: false, reason: "bad signature" };

  const payload = decodeJwtPayload(token);
  if (!payload) return { ok: false, reason: "malformed token payload" };

  const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== "number") return { ok: false, reason: "token has no iat" };
  if (now - payload.iat > MAX_AGE_SECONDS) return { ok: false, reason: "token is stale" };

  if (!payload.request_body_sha256) {
    return { ok: false, reason: "token has no body digest" };
  }
  const actual = await sha256Hex(rawBody);
  if (!timingSafeEqualHex(actual, payload.request_body_sha256)) {
    return { ok: false, reason: "body does not match signed digest" };
  }

  return { ok: true };
}
