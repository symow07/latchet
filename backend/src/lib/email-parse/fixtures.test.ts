import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractFinding, parseMime } from "./index";
import { MOJIBAKE } from "./test-utils";

/**
 * Every realistic email under fixtures/<country>/ against what a person reads
 * in it (<name>.expected.json, written by hand; null = not a bill). Only the
 * fields an expectation names are compared.
 */
const ROOT = path.join(import.meta.dir, "fixtures");
const NOW = new Date("2026-10-12T12:00:00Z");

const cases = readdirSync(ROOT)
  .filter((cc) => !cc.startsWith("."))
  .flatMap((cc) =>
    readdirSync(path.join(ROOT, cc))
      .filter((f) => f.endsWith(".eml"))
      .map((f) => ({ cc, name: f.replace(/\.eml$/, "") })),
  );

describe("email fixtures", () => {
  test("email fixtures: at least 25, at least 4 per country", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
    for (const cc of ["us", "uk", "fr", "ma", "cn"]) expect(cases.filter((c) => c.cc === cc).length).toBeGreaterThanOrEqual(4);
  });

  for (const { cc, name } of cases) {
    test(`email fixtures: ${cc}/${name}`, async () => {
      const raw = new Uint8Array(readFileSync(path.join(ROOT, cc, `${name}.eml`)));
      const expected = JSON.parse(readFileSync(path.join(ROOT, cc, `${name}.expected.json`), "utf8")) as Record<string, unknown> | null;
      const msg = await parseMime(raw);
      expect(msg.subject + msg.text + msg.attachmentsText.join("")).not.toMatch(MOJIBAKE);
      const got = await extractFinding(msg, { ai: null, now: NOW });
      if (expected === null) {
        expect(got === null || got.kind === "other").toBe(true);
        return;
      }
      expect(got).not.toBeNull();
      for (const [key, want] of Object.entries(expected)) {
        const value = (got as unknown as Record<string, unknown>)[key];
        if (typeof want === "number") expect(value as number).toBeCloseTo(want, 2);
        else if (typeof want === "string" && typeof value === "string") expect(value.toLowerCase()).toBe(want.toLowerCase());
        else expect(value).toEqual(want);
      }
      expect(got!.label.length).toBeLessThanOrEqual(60);
      expect(got!.label).not.toMatch(/\d/);
    });
  }
});
