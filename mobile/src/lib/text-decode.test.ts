import { test, expect } from 'bun:test';
import { decodeStatementBytes, decodeUtf8Strict, base64ToBytes } from './text-decode';

const cp1252 = (s: string) => {
  const map: Record<string, number> = { '€': 0x80, '’': 0x92, '–': 0x96 };
  return Uint8Array.from([...s].map((ch) => map[ch] ?? ch.charCodeAt(0)));
};

test('statement encoding: UTF-8 with and without a BOM', () => {
  const text = 'Date;Libellé;Montant\n05/10/2026;Prélèvement Free;-19,99 €\n';
  const bytes = new TextEncoder().encode(text);
  expect(decodeStatementBytes(bytes)).toEqual({ text, encoding: 'utf-8' });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
  expect(decodeStatementBytes(bom)).toEqual({ text, encoding: 'utf-8' });
});

test('statement encoding: a Windows-1252 French export keeps its accents and euro sign', () => {
  const text = 'Date;Libellé;Débit\n05/10/2026;PRLV SEPA – Free’s offre;19,99 €\n';
  const got = decodeStatementBytes(cp1252(text));
  expect(got.encoding).toBe('windows-1252');
  expect(got.text).toBe(text);
});

test('statement encoding: Excel Unicode text (UTF-16 LE with BOM)', () => {
  const text = 'التاريخ\tالمبلغ\n2026-10-05\t99,00\n';
  const units = [...text].map((c) => c.charCodeAt(0));
  const bytes = new Uint8Array(2 + units.length * 2);
  bytes[0] = 0xff; bytes[1] = 0xfe;
  units.forEach((u, i) => { bytes[2 + i * 2] = u & 0xff; bytes[3 + i * 2] = u >> 8; });
  expect(decodeStatementBytes(bytes)).toEqual({ text, encoding: 'utf-16le' });
});

test('statement encoding: invalid or truncated UTF-8 is rejected, not half-decoded', () => {
  expect(decodeUtf8Strict(new Uint8Array([0x41, 0xc3]))).toBeNull();
  expect(decodeUtf8Strict(new Uint8Array([0xc0, 0x80]))).toBeNull();
  expect(decodeUtf8Strict(new Uint8Array([0xed, 0xa0, 0x80]))).toBeNull();
  expect(decodeUtf8Strict(new TextEncoder().encode('爱奇艺 25,00元 😀'))).toBe('爱奇艺 25,00元 😀');
});

test('statement encoding: base64 from the file system round-trips', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const b64 = Buffer.from(bytes).toString('base64');
  expect([...base64ToBytes(b64)]).toEqual([...bytes]);
  expect([...base64ToBytes(Buffer.from('ab').toString('base64'))]).toEqual([0x61, 0x62]);
});
