import { test, expect, afterAll } from "bun:test";
import { prisma } from "../../prisma";
import { MAX_STORED_FILE_BYTES, readFile, rm, writeFile } from "./files";

const RUN = `files${process.pid}${Date.now().toString(36)}`;
const meta = { kind: "test", ownerId: RUN, contentType: "application/octet-stream" };
afterAll(async () => {
  await prisma.storedFile.deleteMany({ where: { id: { startsWith: `${RUN}/` } } });
});

test("a file round-trips byte for byte, with its type and size", async () => {
  const bytes = new Uint8Array(256).map((_, i) => i);
  await writeFile(`${RUN}/a`, bytes, { ...meta, contentType: "image/png" });
  const file = await readFile(`${RUN}/a`);
  expect(file).not.toBeNull();
  expect(file!.contentType).toBe("image/png");
  expect(file!.size).toBe(256);
  expect(new Uint8Array(file!.bytes)).toEqual(bytes);
});

test("writing the same path replaces the file", async () => {
  await writeFile(`${RUN}/b`, new Uint8Array([1, 2, 3]), meta);
  await writeFile(`${RUN}/b`, new Uint8Array([9]), { ...meta, contentType: "image/jpeg" });
  const file = await readFile(`${RUN}/b`);
  expect(new Uint8Array(file!.bytes)).toEqual(new Uint8Array([9]));
  expect(file!.contentType).toBe("image/jpeg");
  expect(await prisma.storedFile.count({ where: { id: `${RUN}/b` } })).toBe(1);
});

test("a missing file reads as null", async () => {
  expect(await readFile(`${RUN}/nothing`)).toBeNull();
});

test("a 10 MB file is stored and read back whole", async () => {
  const big = new Uint8Array(10 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
  await writeFile(`${RUN}/big`, big, meta);
  const file = await readFile(`${RUN}/big`);
  expect(file!.size).toBe(big.length);
  expect(Buffer.compare(file!.bytes, Buffer.from(big))).toBe(0);
});

test("a file over the ceiling is refused", async () => {
  await expect(writeFile(`${RUN}/huge`, new Uint8Array(MAX_STORED_FILE_BYTES + 1), meta)).rejects.toThrow(/too large/);
});

test("rm removes one file; recursive rm removes a folder and nothing beside it", async () => {
  for (const p of ["d/x", "d/sub/y", "d", "d2/z", "d_/w"]) {
    await writeFile(`${RUN}/${p}`, new Uint8Array([1]), meta);
  }
  expect(await rm(`${RUN}/d/x`)).toBe(1);
  expect(await rm(`${RUN}/d/x`)).toBe(0);
  // "d2" and "d_" start like "d" but are other folders: "_" is a LIKE
  // wildcard, which is why the prefix match is not a LIKE.
  expect(await rm(`${RUN}/d`, { recursive: true })).toBe(2);
  expect(await readFile(`${RUN}/d2/z`)).not.toBeNull();
  expect(await readFile(`${RUN}/d_/w`)).not.toBeNull();
});

test("a path that is not made of ids is refused before any query", async () => {
  for (const bad of ["", "../x", "a/../b", "a%", "a b", "/a", "a/"]) {
    await expect(readFile(bad)).rejects.toThrow(/invalid file path/);
    await expect(rm(bad, { recursive: true })).rejects.toThrow(/invalid file path/);
  }
});

test("a file written in a rolled-back transaction is not stored", async () => {
  await prisma
    .$transaction(async (tx) => {
      await writeFile(`${RUN}/tx`, new Uint8Array([1]), meta, tx);
      throw new Error("roll back");
    })
    .catch(() => {});
  expect(await readFile(`${RUN}/tx`)).toBeNull();
});
