import { test, expect } from "bun:test";
import {
  sniffImageType, contentTypeFor, isSafeId, receiptPath, receiptDir, logoPath,
} from "./receipt-store";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text).map((c) => c.charCodeAt(0));

test("a JPEG is recognised", () => {
  expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpg");
});

test("a PNG is recognised by its full signature", () => {
  expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
  // The first four bytes alone are not enough — truncating the check is how
  // a non-PNG gets stored under a .png name the server then cannot serve.
  expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0))).toBeNull();
});

test("WEBP is recognised by both of its markers", () => {
  expect(sniffImageType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toBe("webp");
  // RIFF alone is also WAV and AVI.
  expect(sniffImageType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
});

test("HEIC is recognised, since it is what an iPhone camera produces", () => {
  expect(sniffImageType(bytes(0, 0, 0, 24, ...ascii("ftyp"), ...ascii("heic")))).toBe("heic");
  expect(sniffImageType(bytes(0, 0, 0, 24, ...ascii("ftyp"), ...ascii("mif1")))).toBe("heic");
});

test("an ISO-BMFF file that is not an image is refused", () => {
  // ftypqt is a QuickTime movie. Same container family, not a receipt.
  expect(sniffImageType(bytes(0, 0, 0, 24, ...ascii("ftyp"), ...ascii("qt  ")))).toBeNull();
});

test("anything unrecognised is refused rather than guessed at", () => {
  expect(sniffImageType(bytes(...ascii("<?php system($_GET[0]);")))).toBeNull();
  expect(sniffImageType(bytes(...ascii("%PDF-1.7")))).toBeNull();
  expect(sniffImageType(bytes())).toBeNull();
});

test("HEIC is served as HEIC, and jpg as image/jpeg", () => {
  expect(contentTypeFor("jpg")).toBe("image/jpeg");
  expect(contentTypeFor("png")).toBe("image/png");
  expect(contentTypeFor("heic")).toBe("image/heic");
});

// ── Path safety ──────────────────────────────────────────────────────────────

test("an id that could escape the directory is rejected", () => {
  // This value becomes a filesystem path. A traversal here would let a request
  // read or overwrite anything the process can reach.
  for (const bad of ["../../etc/passwd", "a/b", "..", "", "a".repeat(65), "a b", "a.png"]) {
    expect(isSafeId(bad)).toBe(false);
  }
});

test("a cuid is accepted", () => {
  expect(isSafeId("cmt9wose80001gabyut8tudrw")).toBe(true);
});

test("building a path with an unsafe id throws rather than returning one", () => {
  expect(() => receiptPath("../escape", "jpg", "/tmp/receipts")).toThrow();
});

test("receipts sit beside the database, so they land on the same volume", () => {
  // The Railway volume is mounted at /data and DATABASE_URL points into it.
  // Deriving the directory means there is no second setting to forget.
  delete process.env.RECEIPT_DIR;
  expect(receiptDir("file:/data/prod.db")).toBe("/data/receipts");
});

test("an explicit RECEIPT_DIR wins", () => {
  process.env.RECEIPT_DIR = "/mnt/uploads";
  expect(receiptDir("file:/data/prod.db")).toBe("/mnt/uploads");
  delete process.env.RECEIPT_DIR;
});

test("a logo cannot collide with an expense id", () => {
  // Both live in one directory; without the prefix a business whose id matched
  // an expense id would overwrite that receipt.
  expect(logoPath("abc", "png", "/r")).toBe("/r/logo-abc.png");
  expect(receiptPath("abc", "png", "/r")).toBe("/r/abc.png");
});

test("an unsafe business id throws rather than building a path", () => {
  expect(() => logoPath("../../etc/passwd", "png", "/r")).toThrow();
});
