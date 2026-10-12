import { describe, expect, test } from "bun:test";
import { extractFinding, parseMime } from "./index";
import { htmlToText } from "./html-text";

/**
 * Size and shape limits: whatever a sender puts in an email, parsing and
 * extraction finish quickly and never throw. Inputs are built in memory.
 */
const NOW = new Date("2026-10-12T12:00:00Z");
const HEAD = "From: Shop <billing@shop.example.com>\r\nSubject: Your receipt\r\nDate: Mon, 12 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\n";
const BOUND_MS = 2_000;

async function timed(raw: string) {
  const t0 = performance.now();
  const msg = await parseMime(raw);
  const finding = await extractFinding(msg, { now: NOW });
  return { ms: performance.now() - t0, msg, finding };
}

describe("limits", () => {
  test("limits: a 2 MB plain-text body full of dates and amounts is read within the time bound", async () => {
    const body = "Your receipt\nTotal $12.99\n" + "may march june 12 3 4 Nov 5 2026 total amount $1 renews on Oct 3 ".repeat(32_000);
    expect(body.length).toBeGreaterThan(2_000_000);
    const { ms, finding } = await timed(HEAD + "Content-Type: text/plain; charset=utf-8\r\n\r\n" + body);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(finding?.kind).toBe("receipt");
    expect(finding?.amount).toBe(12.99);
  }, 20_000);

  test("limits: a large HTML table receipt is read within the time bound", async () => {
    const rows = Array.from({ length: 8000 }, (_, i) => `<tr><td>Item ${i}</td><td>$${(i % 97) + 0.99}</td></tr>`).join("");
    const html = `<table><tr><td>Total</td><td>$12.99</td></tr>${rows}</table>`;
    const { ms, finding } = await timed(HEAD + "Content-Type: text/html; charset=utf-8\r\n\r\n" + html);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(finding?.amount).toBe(12.99);
  }, 20_000);

  test("limits: pathological HTML (unclosed quotes, stray brackets, deep nesting) finishes within the time bound without throwing", async () => {
    const cases = [
      '<a href="'.repeat(20_000) + "Total $5.00",
      '<a title="x>y" '.repeat(30_000) + "Total $5.00",
      "< <a <b <".repeat(50_000),
      "<!".repeat(100_000),
      "<div>".repeat(50_000) + "Total $5.00" + "</div>".repeat(50_000),
      "<table><tr><td>".repeat(20_000) + "Total $5.00",
      "<p>" + "&amp;".repeat(200_000),
      "<div><x>".repeat(30_000) + "</y>".repeat(30_000),
    ];
    for (const html of cases) {
      const t0 = performance.now();
      const text = htmlToText(html);
      expect(typeof text).toBe("string");
      const { ms } = await timed(HEAD + "Content-Type: text/html; charset=utf-8\r\n\r\n" + html);
      expect(performance.now() - t0 - ms).toBeLessThan(BOUND_MS);
      expect(ms).toBeLessThan(BOUND_MS);
    }
    // Deeply nested real content is still read.
    expect(htmlToText("<div>".repeat(50_000) + "Total $5.00" + "</div>".repeat(50_000))).toContain("Total $5.00");
  }, 60_000);

  test("limits: one very long line and a body of separators finish within the time bound", async () => {
    for (const body of ["a".repeat(2_000_000), "1,234.56 ".repeat(100_000), "trial trial ".repeat(150_000), "12/11/2026 ".repeat(150_000)]) {
      const { ms } = await timed(HEAD + "Content-Type: text/plain; charset=utf-8\r\n\r\n" + body);
      expect(ms).toBeLessThan(BOUND_MS);
    }
  }, 60_000);
});
