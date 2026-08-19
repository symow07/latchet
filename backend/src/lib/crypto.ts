import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  hkdfSync,
} from "node:crypto";
import { env } from "../env";

/**
 * AES-256-GCM encryption for secrets at rest — Plaid access tokens and Gmail
 * refresh tokens.
 *
 * The key used to come straight from BETTER_AUTH_SECRET via a bare SHA-256,
 * which made one value responsible for two unrelated things: signing sessions
 * and encrypting data at rest. The practical consequence was that the auth
 * secret could never be rotated — changing it made every stored token
 * undecryptable and forced every affected user to relink their bank and inbox.
 * A leak, a departing collaborator, or ordinary hygiene all became "force every
 * user to relink", so in practice rotation never happened. That is the wrong
 * failure mode for the most sensitive key in a finance app.
 *
 * TOKEN_ENCRYPTION_KEY now owns encryption. BETTER_AUTH_SECRET is free to
 * rotate, costing only a forced re-login.
 *
 * Ciphertext is versioned, mirroring the password-hash format in auth.ts:
 *   v1 (legacy):  base64(iv).base64(tag).base64(data)      — key from BETTER_AUTH_SECRET
 *   v2:        v2.base64(iv).base64(tag).base64(data)      — key from TOKEN_ENCRYPTION_KEY
 * v1 payloads keep decrypting forever, so no migration is required to deploy.
 */

/** Domain separation, so this key can never collide with another use of the secret. */
const HKDF_INFO = "realbudget/token-encryption/v2";
const HKDF_SALT = "realbudget/token-encryption/salt/v2";

/**
 * The original derivation: a bare SHA-256 of the auth secret. Retained purely
 * to read v1 ciphertext — never used for new writes once v2 is configured.
 */
export function deriveLegacyKey(betterAuthSecret: string): Buffer {
  return createHash("sha256").update(betterAuthSecret).digest();
}

/** HKDF-SHA256, which is what a key-derivation step should be. */
export function deriveTokenKey(tokenEncryptionKey: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", tokenEncryptionKey, HKDF_SALT, HKDF_INFO, 32)
  );
}

export interface CryptoKeys {
  /** Reads v1 ciphertext. Always present. */
  legacy: Buffer;
  /** Writes and reads v2. Null when TOKEN_ENCRYPTION_KEY is unset. */
  current: Buffer | null;
}

const V2_PREFIX = "v2";

function encryptRaw(plaintext: string, key: Buffer): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function decryptRaw(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Encrypt under an explicit key set. Writes v2 whenever one is configured. */
export function encryptWith(plaintext: string, keys: CryptoKeys): string {
  const key = keys.current ?? keys.legacy;
  const { iv, tag, data } = encryptRaw(plaintext, key);
  const body = `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
  return keys.current ? `${V2_PREFIX}.${body}` : body;
}

/** Decrypt under an explicit key set, dispatching on the payload's version. */
export function decryptWith(payload: string, keys: CryptoKeys): string {
  const parts = payload.split(".");

  if (parts.length === 4 && parts[0] === V2_PREFIX) {
    if (!keys.current) {
      throw new Error(
        "ciphertext is v2 but TOKEN_ENCRYPTION_KEY is not set — restore it to read these tokens"
      );
    }
    return decryptRaw(keys.current, parts[1]!, parts[2]!, parts[3]!);
  }

  if (parts.length === 3) {
    // Written before the split, under the key derived from BETTER_AUTH_SECRET.
    const [ivB64, tagB64, dataB64] = parts;
    if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
    return decryptRaw(keys.legacy, ivB64, tagB64, dataB64);
  }

  throw new Error("malformed ciphertext");
}

/** Keys for this process, resolved once from the environment. */
const keys: CryptoKeys = {
  legacy: deriveLegacyKey(env.BETTER_AUTH_SECRET),
  current: env.TOKEN_ENCRYPTION_KEY ? deriveTokenKey(env.TOKEN_ENCRYPTION_KEY) : null,
};

export function encryptSecret(plaintext: string): string {
  return encryptWith(plaintext, keys);
}

export function decryptSecret(payload: string): string {
  return decryptWith(payload, keys);
}
