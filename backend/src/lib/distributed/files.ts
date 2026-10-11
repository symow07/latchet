import { prisma } from "../../prisma";
import { DB_NOW, type Db } from "./clock";

/**
 * Uploaded files (receipt photos, company logos), stored in Postgres in the
 * StoredFile table as bytea.
 *
 * They used to be written to a directory on the instance's volume, which only
 * that instance could read: a second instance served 404 for every receipt the
 * first one stored, and the volume had to exist at all. In the database every
 * instance serves every file, and a file can be written in the same
 * transaction as the row that points at it.
 *
 * The API keeps the three verbs of node:fs/promises it replaced — writeFile,
 * readFile, rm — over path-like keys ("receipts/<groupId>/<expenseId>"), the
 * way an object store keys its objects. A "directory" is just a key prefix, so
 * `rm(dir, { recursive: true })` removes everything under it in one statement.
 *
 * Files are read whole into memory, as readFile did; uploads are capped by the
 * routes (lib/receipt-store.ts) and again here.
 */

/** Hard ceiling for one stored file, above every route's own limit. */
export const MAX_STORED_FILE_BYTES = 16 * 1024 * 1024;

/** Path segments are ids: letters, digits, "_" and "-", separated by "/". */
const PATH = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,7}$/;

/**
 * A path is checked rather than trusted, though every caller builds it from
 * ids: it is a primary key and a prefix for recursive deletes, so a stray "%"
 * or an empty segment must fail loudly instead of matching something else.
 */
export function assertFilePath(path: string): string {
  if (!PATH.test(path)) throw new Error(`invalid file path: ${JSON.stringify(path)}`);
  return path;
}

export interface FileMeta {
  /** What the file is ("receipt", "logo"); the retention job sweeps by it. */
  kind: string;
  /** The row the file belongs to, so a file whose owner is gone can be found. */
  ownerId: string | null;
  contentType: string;
}

export interface StoredFileData {
  contentType: string;
  size: number;
  bytes: Buffer;
}

/** Store `bytes` at `path`, replacing any file already there. */
export async function writeFile(
  path: string,
  bytes: Uint8Array,
  meta: FileMeta,
  db: Db = prisma
): Promise<void> {
  assertFilePath(path);
  if (bytes.byteLength > MAX_STORED_FILE_BYTES) {
    throw new Error(`file too large: ${bytes.byteLength} bytes`);
  }
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Raw SQL so the bytes are sent once; an upsert through the model API
  // carries them twice (create and update branches).
  await db.$executeRaw`
    INSERT INTO "StoredFile" ("id", "kind", "ownerId", "contentType", "size", "bytes", "createdAt")
    VALUES (${path}, ${meta.kind}, ${meta.ownerId}, ${meta.contentType},
            ${data.byteLength}::int, ${data}, ${DB_NOW})
    ON CONFLICT ("id") DO UPDATE SET
      "kind" = EXCLUDED."kind",
      "ownerId" = EXCLUDED."ownerId",
      "contentType" = EXCLUDED."contentType",
      "size" = EXCLUDED."size",
      "bytes" = EXCLUDED."bytes",
      "createdAt" = EXCLUDED."createdAt"`;
}

/** The file at `path`, or null when there is none. */
export async function readFile(path: string, db: Db = prisma): Promise<StoredFileData | null> {
  assertFilePath(path);
  const file = await db.storedFile.findUnique({
    where: { id: path },
    select: { contentType: true, size: true, bytes: true },
  });
  if (!file) return null;
  return { contentType: file.contentType, size: file.size, bytes: Buffer.from(file.bytes) };
}

/**
 * Remove the file at `path`. With `recursive`, also every file under
 * `path/`. Removing nothing is not an error. Returns how many were removed.
 */
export async function rm(
  path: string,
  opts: { recursive?: boolean } = {},
  db: Db = prisma
): Promise<number> {
  assertFilePath(path);
  if (!opts.recursive) {
    return db.$executeRaw`DELETE FROM "StoredFile" WHERE "id" = ${path}`;
  }
  // starts_with, not LIKE: "_" is a LIKE wildcard and is legal in ids.
  return db.$executeRaw`
    DELETE FROM "StoredFile"
     WHERE "id" = ${path} OR starts_with("id", ${path + "/"})`;
}
