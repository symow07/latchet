import { describe, expect, test } from "bun:test";
import { parseMime } from "./mime";
import { extractFinding } from "./extract";
import { isPdfAttachment, pdfText, PDF_MAX_BYTES } from "./pdf";
import { binary, mail, makePdf, multipart, text } from "./test-utils";

const NOW = new Date("2026-10-12T12:00:00Z");
const HEADERS = { From: "CANAL+ <noreply@canalplus.com>", To: "camille@example.fr", Subject: "Votre facture CANAL+ est disponible", Date: "Mon, 05 Oct 2026 07:30:00 +0200" };
const INVOICE = ["CANAL+", "Facture FAC-2026-10-58213", "Date de facture : 05/10/2026", "Abonnement CANAL+ (mensuel)", "Montant HT 21,66 €", "TVA 20 % 4,33 €", "Total TTC 25,99 €"];

describe("pdf", () => {
  test("pdf invoice: the amount that is only in an attached PDF is read and extracted", async () => {
    const root = multipart("mixed", [
      text("plain", "Bonjour Camille,\n\nVotre facture du mois d'octobre est disponible en pièce jointe.\n\nLe Service Client CANAL+"),
      binary('application/pdf; name="facture.pdf"', makePdf([INVOICE]), ['Content-Disposition: attachment; filename="facture.pdf"']),
    ]);
    const msg = await parseMime(mail(HEADERS, root));
    expect(msg.attachmentsText).toHaveLength(1);
    expect(msg.attachmentsText[0]).toContain("Total TTC 25,99 €");
    expect(msg.text).not.toContain("25,99");
    const finding = await extractFinding(msg, { now: NOW });
    expect(finding).toMatchObject({ kind: "receipt", merchant: "CANAL+", amount: 25.99, currency: "EUR", cadence: "monthly" });
  });

  test("pdf invoice: an application/octet-stream attachment named .pdf is read too", async () => {
    const root = multipart("mixed", [
      text("plain", "Your invoice is attached."),
      binary('application/octet-stream; name="INV-0042.PDF"', makePdf([["Invoice INV-0042", "Total due £18.00"]]), ['Content-Disposition: attachment; filename="INV-0042.PDF"']),
    ]);
    const msg = await parseMime(mail({ ...HEADERS, From: "Acme Hosting <billing@acme-hosting.example.co.uk>", Subject: "Your invoice INV-0042" }, root));
    expect(msg.attachmentsText.join("\n")).toContain("Total due £18.00");
    expect(isPdfAttachment("application/octet-stream", "INV-0042.PDF", new Uint8Array([1]))).toBe(true);
    expect(isPdfAttachment("image/png", "logo.png", new Uint8Array([0x89, 0x50]))).toBe(false);
  });

  test("pdf invoice: only the first 3 pages are read", async () => {
    const pdf = makePdf([["Page one"], ["Page two"], ["Page three"], ["Page four secret 99,00 €"]]);
    const out = await pdfText(pdf);
    expect(out).toContain("Page one");
    expect(out).toContain("Page three");
    expect(out).not.toContain("Page four");
    expect(await pdfText(pdf, { maxPages: 1 })).toBe("Page one");
  });

  test("pdf invoice: files over 2 MB are skipped and the email still parses", async () => {
    const big = new Uint8Array(PDF_MAX_BYTES + 10);
    big.set(makePdf([["Total 10,00 €"]]));
    expect(await pdfText(big)).toBeNull();
    const msg = await parseMime(mail(HEADERS, multipart("mixed", [text("plain", "Facture jointe."), binary("application/pdf", big, ['Content-Disposition: attachment; filename="big.pdf"'])])));
    expect(msg.attachmentsText).toEqual([]);
    expect(msg.text).toBe("Facture jointe.");
  });

  test("pdf invoice: a corrupt or fake PDF is ignored, never thrown", async () => {
    const fake = new Uint8Array(Buffer.from("%PDF-1.7\nthis is not really a pdf\n%%EOF", "latin1"));
    expect(await pdfText(fake)).toBeNull();
    expect(await pdfText(new Uint8Array(Buffer.from("not a pdf at all")))).toBeNull();
    const msg = await parseMime(mail(HEADERS, multipart("mixed", [text("plain", "Total TTC 25,99 €"), binary("application/pdf", fake, ['Content-Disposition: attachment; filename="x.pdf"'])])));
    expect(msg.attachmentsText).toEqual([]);
    expect(msg.text).toBe("Total TTC 25,99 €");
  });

  test("pdf invoice: the time limit gives up without failing, and the document is always closed", async () => {
    const hang = () => new Promise<never>(() => {});
    // A document whose pages never arrive.
    let slowClosed = 0;
    const slowPages = async () => ({ numPages: 2, getPage: hang, loadingTask: { destroy: async () => void slowClosed++ } });
    expect(await pdfText(makePdf([INVOICE]), { timeoutMs: 20, load: slowPages })).toBeNull();
    expect(slowClosed).toBe(1);
    // A document that opens only after the limit has passed.
    let lateClosed = 0;
    const late = () =>
      new Promise<{ numPages: number; getPage: () => Promise<never>; loadingTask: { destroy: () => Promise<void> } }>((resolve) =>
        setTimeout(() => resolve({ numPages: 1, getPage: hang, loadingTask: { destroy: async () => void lateClosed++ } }), 40),
      );
    expect(await pdfText(makePdf([INVOICE]), { timeoutMs: 10, load: late })).toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(lateClosed).toBe(1);
  });
});
