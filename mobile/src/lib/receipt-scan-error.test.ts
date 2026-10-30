import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from './i18n/locales/en.json';
import fr from './i18n/locales/fr.json';
import ar from './i18n/locales/ar.json';
import zh from './i18n/locales/zh.json';
import { setLocale, type AppLocale } from './i18n/core';
import { ApiError, NetworkError, TimeoutError } from './api/http-errors';
import { receiptScanError } from './receipt-scan-error';

afterEach(() => setLocale('en'));

const CATALOGUES = { en, fr, ar, zh };

test('a scan the server could not read says so in every language, never "Request failed (502)"', () => {
  // What the shared client throws for the backend's 502.
  const failed = new ApiError(502, 'Request failed (502)', { error: 'Receipt analysis failed' });
  for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
    setLocale(locale as AppLocale);
    const shown = receiptScanError(failed);
    expect(shown).toBe(catalogue.receiptScan.scanFailed);
    expect(shown).not.toMatch(/\d{3}|Request failed|Receipt analysis/);
  }
  // Anything else unforeseen (a reply that is not a receipt) reads the same.
  setLocale('en');
  expect(receiptScanError(new TypeError("Cannot read properties of undefined (reading 'toFixed')"))).toBe(
    en.receiptScan.scanFailed,
  );
});

test('a lost connection, a timeout or an image the server refuses say what the rest of the app says', () => {
  expect(receiptScanError(new NetworkError(new TypeError('Network request failed')))).toBe(en.apiErrors.network);
  expect(receiptScanError(new TimeoutError())).toBe(en.apiErrors.timeout);
  expect(receiptScanError(new ApiError(400, 'Request failed (400)', {}))).toBe(en.apiErrors.imageUnusable);
  expect(receiptScanError(new ApiError(413, 'Request failed (413)', {}))).toBe(en.apiErrors.tooLarge);
  setLocale('fr');
  expect(receiptScanError(new TimeoutError())).toBe(fr.apiErrors.timeout);
});

test("the screen shows this, not the error's own message", () => {
  const screen = readFileSync(join(import.meta.dir, '../app/receipt-scan.tsx'), 'utf8');
  const analyze = screen.slice(screen.indexOf('async function analyze('));
  const failure = analyze.slice(analyze.indexOf('} catch'), analyze.indexOf('function resetScan'));
  expect(failure).toMatch(/setErrorMsg\(receiptScanError\(err\)\)/);
  expect(failure).not.toMatch(/\.message/);
});
