import { test, expect } from "bun:test";
import {
  sniffImageType, contentTypeFor, isSafeId, receiptPath, logoPath,
} from "./receipt-store";
import { assertFilePath } from "./distributed/files";

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

test("an id that could escape its folder is rejected", () => {
  // This value becomes part of a file path, and a path is also a prefix that
  // a recursive delete matches: a separator or wildcard here could reach
  // another business's files.
  for (const bad of ["../../etc/passwd", "a/b", "..", "", "a".repeat(65), "a b", "a.png", "a%", "a\\b"]) {
    expect(isSafeId(bad)).toBe(false);
  }
});

test("a cuid is accepted", () => {
  expect(isSafeId("cmt9wose80001gabyut8tudrw")).toBe(true);
});

test("building a path with an unsafe id throws rather than returning one", () => {
  expect(() => receiptPath("biz", "../escape")).toThrow();
  expect(() => receiptPath("../escape", "e1")).toThrow();
  expect(() => receiptPath("a/b")).toThrow();
});

test("a receipt is filed under its business, so a business is one folder", () => {
  expect(receiptPath("biz1", "exp1")).toBe("receipts/biz1/exp1");
  expect(receiptPath("biz1")).toBe("receipts/biz1");
  // Deleting the business's folder is a prefix match on "receipts/biz1/":
  // a business whose id merely starts the same is a different folder.
  expect(receiptPath("biz10", "exp1").startsWith(receiptPath("biz1") + "/")).toBe(false);
});

test("a logo cannot collide with a receipt", () => {
  // Separate top-level folders, whatever the ids are.
  expect(logoPath("abc")).toBe("logos/abc");
  expect(receiptPath("abc", "abc")).toBe("receipts/abc/abc");
  expect(logoPath("abc")).not.toBe(receiptPath("abc"));
});

test("an unsafe business id throws rather than building a path", () => {
  expect(() => logoPath("../../etc/passwd")).toThrow();
});

test("every path built here is one the file store accepts", () => {
  for (const path of [receiptPath("biz_1-a", "exp_9"), receiptPath("biz_1-a"), logoPath("biz_1-a")]) {
    expect(assertFilePath(path)).toBe(path);
  }
});

test("the file store refuses a path that is not made of ids", () => {
  for (const bad of ["", "/abs", "a//b", "a/", "a/../b", "a%/b", "a/b c"]) {
    expect(() => assertFilePath(bad)).toThrow();
  }
});
