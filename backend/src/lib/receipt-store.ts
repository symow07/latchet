import { dirname, join } from "node:path";

/**
 * Where receipt images live.
 *
 * Expense.imageUrl used to hold whatever the picker handed the client — a
 * `file://` path on the submitter's phone. It rendered for them and for nobody
 * else, so a manager approving an expense could not see the receipt they were
 * approving. The bytes have to reach the server or the feature does not work.
 *
 * They are written next to the database rather than into it: on Railway the
 * SQLite file sits on the attached volume, so deriving the directory from
 * DATABASE_URL puts receipts on that same volume with no second setting to
 * forget. Blobs in the database would work too, but they would be copied by
 * every backup and read into memory by queries that never wanted them.
 */

/** Matches the AI routes' cap, and roughly a 12-megapixel phone photo. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_BASE64_CHARS = Math.ceil(MAX_RECEIPT_BYTES * 1.37);

export type ReceiptType = "jpg" | "png" | "webp" | "heic";

/**
 * The image format, read from the bytes themselves.
 *
 * Never from a client-supplied name or extension: that is what decides the
 * filename written to disk, and trusting it means the client picks the path.
 * An unrecognised format returns null and is refused rather than stored as
 * something the server cannot serve back.
 */
export function sniffImageType(bytes: Uint8Array): ReceiptType | null {
  const at = (i: number) => bytes[i];

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";

  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) return "png";

  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

  // RIFF....WEBP
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";

  // ISO-BMFF: size, "ftyp", then a brand. HEIC photos are the iPhone default.
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand === "heic" || brand === "heix" || brand === "mif1" || brand === "msf1") {
      return "heic";
    }
  }

  return null;
}

/** Content type to serve a stored receipt back with. */
export function contentTypeFor(type: ReceiptType): string {
  return type === "jpg" ? "image/jpeg" : type === "heic" ? "image/heic" : `image/${type}`;
}

/**
 * An id safe to use as a filename.
 *
 * Ids are cuids and already safe, but this is the value that becomes a path,
 * so it is checked rather than assumed — a traversal here would let a request
 * read or overwrite anything the process can reach.
 */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Directory receipts are written to, derived from the database location. */
export function receiptDir(databaseUrl = process.env.DATABASE_URL ?? ""): string {
  if (process.env.RECEIPT_DIR) return process.env.RECEIPT_DIR;
  const file = databaseUrl.replace(/^file:/, "");
  // No DATABASE_URL at all only happens in tooling; keep it beside the code
  // rather than writing to the filesystem root.
  return join(file ? dirname(file) : "./prisma", "receipts");
}

export function receiptPath(id: string, type: ReceiptType, dir = receiptDir()): string {
  if (!isSafeId(id)) throw new Error("Unsafe receipt id");
  return join(dir, `${id}.${type}`);
}

/**
 * Where a company logo lives.
 *
 * Same directory and the same volume as receipts — it is the same kind of
 * thing, a file a business uploaded. Prefixed so it can never collide with an
 * expense id.
 */
export function logoPath(businessId: string, type: ReceiptType, dir = receiptDir()): string {
  if (!isSafeId(businessId)) throw new Error("Unsafe business id");
  return join(dir, `logo-${businessId}.${type}`);
}
