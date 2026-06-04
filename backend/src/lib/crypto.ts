import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "../env";

/**
 * AES-256-GCM encryption for secrets at rest (e.g. Plaid access tokens).
 * The key is derived from BETTER_AUTH_SECRET so no extra config is required.
 * Output format: base64(iv).base64(authTag).base64(ciphertext).
 */

const key = createHash("sha256").update(env.BETTER_AUTH_SECRET).digest(); // 32 bytes

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
