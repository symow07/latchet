/**
 * Text from PDF invoices attached to billing emails (Canal+, telecoms and
 * utilities often put the amount only in the PDF). pdf.js through unpdf: pure
 * JavaScript, no native modules. Bounded: files over 2 MB are skipped, only
 * the first 3 pages are read, each file has a time limit, and any failure just
 * means no text — the email still parses.
 */

export const PDF_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_MAX_PAGES = 3;
export const PDF_TIMEOUT_MS = 4_000;
export const PDF_MAX_FILES = 3;
export const PDF_MAX_CHARS = 20_000;

/** The slice of pdf.js's document API this module uses. */
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
  loadingTask: { destroy(): Promise<void> };
}

export interface PdfOptions {
  maxBytes?: number;
  maxPages?: number;
  timeoutMs?: number;
  /** Opens a document; pdf.js through unpdf unless a test supplies another. */
  load?: (data: Uint8Array) => Promise<PdfDocument>;
}

async function loadWithPdfJs(data: Uint8Array): Promise<PdfDocument> {
  const { getDocumentProxy } = await import("unpdf");
  return (await getDocumentProxy(data, {
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  })) as unknown as PdfDocument;
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

/** Does this attachment look like a PDF (by type, by name, or by its first bytes)? */
export function isPdfAttachment(contentType: string | undefined, filename: string | undefined, bytes: Uint8Array): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type === "application/pdf" || type === "application/x-pdf") return true;
  if (/\.pdf$/i.test(filename ?? "") && /^(?:application\/(?:octet-stream|force-download|download|binary)|binary\/octet-stream|)$/.test(type)) return true;
  return startsWithPdfMagic(bytes);
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  // "%PDF-" within the first 1 KB, as readers allow leading junk.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/** Text of the first pages of a PDF, one line per text line; null when unreadable or out of bounds. */
export async function pdfText(bytes: Uint8Array, opts: PdfOptions = {}): Promise<string | null> {
  const maxBytes = opts.maxBytes ?? PDF_MAX_BYTES;
  const maxPages = opts.maxPages ?? PDF_MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? PDF_TIMEOUT_MS;
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes || !startsWithPdfMagic(bytes)) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const load = opts.load ?? loadWithPdfJs;
  let openDoc: PdfDocument | null = null;
  let closed = false;
  const close = () => {
    if (!openDoc || closed) return;
    closed = true;
    openDoc.loadingTask.destroy().catch(() => {});
  };
  const work = (async (): Promise<string | null> => {
    // pdf.js takes ownership of (and detaches) the buffer it is given.
    const doc = await load(new Uint8Array(bytes));
    openDoc = doc;
    if (cancelled) {
      close();
      return null;
    }
    try {
      const pages = Math.min(doc.numPages, maxPages);
      const out: string[] = [];
      for (let n = 1; n <= pages; n++) {
        if (cancelled) return null;
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        out.push(itemsToText(content.items as TextItemLike[]));
      }
      return out.join("\n\n");
    } finally {
      close();
    }
  })();
  // A late failure after the time limit must not surface as an unhandled rejection.
  work.catch(() => {});
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        cancelled = true;
        // Destroying the document also abandons a page read that hangs.
        close();
        resolve(null);
      }, timeoutMs);
    });
    const text = await Promise.race([work, timeout]);
    if (text === null) return null;
    const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return cleaned ? cleaned.slice(0, PDF_MAX_CHARS) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Join text runs into lines: a new baseline or an explicit end of line starts a new line. */
function itemsToText(items: TextItemLike[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const y = Array.isArray(item.transform) ? item.transform[5] ?? null : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
    else if (out && !out.endsWith("\n") && !out.endsWith(" ") && item.str && !item.str.startsWith(" ")) out += " ";
    out += item.str;
    if (item.hasEOL) out += "\n";
    if (y !== null) lastY = y;
  }
  return out;
}
