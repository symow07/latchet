/**
 * Receipt images and company logos.
 *
 * Expense.imageUrl used to hold whatever the picker handed the client — a
 * `file://` path on the submitter's phone. It rendered for them and for nobody
 * else, so a manager approving an expense could not see the receipt they were
 * approving. The bytes have to reach the server or the feature does not work.
 *
 * They are stored in Postgres (StoredFile, through lib/distributed/files.ts),
 * under the paths built here. They used to be written to a directory on the
 * instance's volume, which only that instance could read and which had to
 * exist for uploads to work at all; in the database every instance serves
 * every file, and a business's files go in the same transaction as the
 * business.
 */

/** Matches the AI routes' cap, and roughly a 12-megapixel phone photo. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_BASE64_CHARS = Math.ceil(MAX_RECEIPT_BYTES * 1.37);

export type ReceiptType = "jpg" | "png" | "webp" | "heic";

/**
 * The image format, read from the bytes themselves.
 *
 * Never from a client-supplied name or extension: that decides the content
 * type the file is served back with, and trusting it means the client picks
 * what a viewer's app renders. An unrecognised format returns null and is
 * refused rather than stored as something the server cannot serve back.
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
 * An id safe to use in a file path.
 *
 * Ids are cuids and already safe, but this is the value that becomes part of
 * a path, so it is checked rather than assumed — and a path is also a prefix
 * that a recursive delete matches, so a stray separator here could reach
 * another business's files.
 */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** StoredFile.kind of a receipt; its ownerId is the expense's id. */
export const RECEIPT_KIND = "receipt";
/** StoredFile.kind of a company logo; its ownerId is the business's id. */
export const LOGO_KIND = "logo";

/**
 * Where a business's receipts live: `receipts/<groupId>` is the business's
 * folder, `receipts/<groupId>/<expenseId>` one expense's receipt in it.
 *
 * Grouped by business so that deleting a business removes all of its receipts
 * with one recursive rm, without first listing every expense it had.
 */
export function receiptPath(groupId: string, expenseId?: string): string {
  if (!isSafeId(groupId)) throw new Error("Unsafe business id");
  if (expenseId === undefined) return `receipts/${groupId}`;
  if (!isSafeId(expenseId)) throw new Error("Unsafe receipt id");
  return `receipts/${groupId}/${expenseId}`;
}

/**
 * Where a company logo lives. Its own top-level folder, so it can never
 * collide with a receipt whatever the ids are.
 */
export function logoPath(groupId: string): string {
  if (!isSafeId(groupId)) throw new Error("Unsafe business id");
  return `logos/${groupId}`;
}
