/**
 * Builders for MIME messages and PDFs in tests: byte-exact charsets,
 * quoted-printable, base64 and RFC 2047 words, so each test states the bytes
 * a real sender would put on the wire.
 */

import iconv from "iconv-lite";

const CRLF = "\r\n";

export function encode(text: string, charset: string): Buffer {
  if (/^utf-?8$/i.test(charset)) return Buffer.from(text, "utf8");
  const out = iconv.encode(text, charset);
  if (iconv.decode(out, charset) !== text) throw new Error(`${charset} cannot hold the test text`);
  return out;
}

export function qp(buf: Buffer): string {
  const lines: string[] = [];
  let cur = "";
  for (const b of buf) {
    if (b === 0x0d) continue;
    if (b === 0x0a) {
      lines.push(cur.endsWith(" ") ? cur.slice(0, -1) + "=20" : cur);
      cur = "";
      continue;
    }
    const ch = (b >= 33 && b <= 126 && b !== 61) || b === 32 ? String.fromCharCode(b) : "=" + b.toString(16).toUpperCase().padStart(2, "0");
    if (cur.length + ch.length > 75) {
      lines.push(cur + "=");
      cur = "";
    }
    cur += ch;
  }
  lines.push(cur);
  return lines.join(CRLF);
}

export function b64(buf: Buffer): string {
  return buf.toString("base64").replace(/(.{76})/g, `$1${CRLF}`).replace(/\r\n$/, "");
}

/** An RFC 2047 encoded word (one word; keep test strings short). */
export function word(text: string, charset: string, mode: "B" | "Q" = "B"): string {
  const bytes = encode(text, charset);
  const data =
    mode === "B"
      ? bytes.toString("base64")
      : [...bytes].map((b) => (b === 0x20 ? "_" : /[A-Za-z0-9]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : "=" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");
  return `=?${charset}?${mode}?${data}?=`;
}

export interface MimePart {
  headers: string[];
  body: string;
}

export function text(type: "plain" | "html", content: string, charset = "UTF-8", cte: "quoted-printable" | "base64" | "8bit" = "quoted-printable", extra: string[] = []): MimePart {
  const bytes = encode(content, charset);
  const body = cte === "quoted-printable" ? qp(bytes) : cte === "base64" ? b64(bytes) : bytes.toString("latin1").replace(/\n/g, CRLF);
  return { headers: [`Content-Type: text/${type}; charset="${charset}"`, `Content-Transfer-Encoding: ${cte}`, ...extra], body };
}

export function binary(type: string, data: Uint8Array, extra: string[] = []): MimePart {
  return { headers: [`Content-Type: ${type}`, "Content-Transfer-Encoding: base64", ...extra], body: b64(Buffer.from(data)) };
}

let n = 0;
export function multipart(subtype: "mixed" | "alternative" | "related", parts: MimePart[]): MimePart {
  const boundary = `b_${subtype}_${++n}`;
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
    body: parts.map((p) => `--${boundary}${CRLF}${p.headers.join(CRLF)}${CRLF}${CRLF}${p.body}${CRLF}`).join("") + `--${boundary}--`,
  };
}

/** A whole message as the bytes a mail server would hand over. */
export function mail(headers: Record<string, string>, root: MimePart): Uint8Array {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  return new Uint8Array(Buffer.from([...lines, "MIME-Version: 1.0", ...root.headers].join(CRLF) + CRLF + CRLF + root.body + CRLF, "latin1"));
}

/** A minimal valid PDF, one page per entry, Helvetica with WinAnsi (€ is \\200). */
export function makePdf(pages: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => "\\" + m).replace(/€/g, "\\200").replace(/é/g, "\\351");
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((lines, i) => {
    const content = "BT /F1 11 Tf 14 TL 56 780 Td " + lines.map((l) => `(${esc(l)}) Tj T*`).join(" ") + " ET";
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Mojibake markers: UTF-8 read as Latin-1, or replacement characters. */
export const MOJIBAKE = /Ã|Â|â‚¬|ï¿½|\uFFFD/;
