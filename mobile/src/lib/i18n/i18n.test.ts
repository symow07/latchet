import { test, expect } from 'bun:test';
import { I18n } from 'i18n-js';
import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';
// The real configuration, plural rules and all — not a reimplementation.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { i18n, setLocale, normalizeLocale, SUPPORTED_LOCALES } from './core';

/** Point the shared instance at a locale and return it. */
function makeI18n(locale: string) {
  setLocale(locale as 'en' | 'fr' | 'zh');
  return i18n;
}

// ── Key coverage ─────────────────────────────────────────────────────────────

const flatten = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
  );

test('French covers every English key', () => {
  const missing = flatten(en).filter((k) => !new Set(flatten(fr)).has(k));
  expect(missing).toEqual([]);
});

test('Chinese covers every English key except singular forms it has no use for', () => {
  const zhKeys = new Set(flatten(zh));
  const missing = flatten(en).filter((k) => !zhKeys.has(k) && !k.endsWith('.one'));
  expect(missing).toEqual([]);
});

test('no locale carries keys English does not', () => {
  // A stray key is a translation of something that no longer exists.
  const enKeys = new Set(flatten(en));
  expect(flatten(fr).filter((k) => !enKeys.has(k))).toEqual([]);
  expect(flatten(zh).filter((k) => !enKeys.has(k))).toEqual([]);
});

// ── Pluralisation ────────────────────────────────────────────────────────────

test('English pluralises the way English does', () => {
  const i = makeI18n('en');
  expect(i.t('common.days', { count: 1 })).toBe('1 day');
  expect(i.t('common.days', { count: 3 })).toBe('3 days');
});

test('French treats zero as singular', () => {
  // "0 jour", not "0 jours" — the opposite of English.
  const i = makeI18n('fr');
  expect(i.t('common.days', { count: 0 })).toBe('0 jour');
  expect(i.t('common.days', { count: 1 })).toBe('1 jour');
  expect(i.t('common.days', { count: 2 })).toBe('2 jours');
});

test('Chinese uses one form for every count', () => {
  const i = makeI18n('zh');
  expect(i.t('common.days', { count: 1 })).toBe('1 天');
  expect(i.t('common.days', { count: 7 })).toBe('7 天');
});

test('a zero form is preferred over "0 things" in every language', () => {
  expect(makeI18n('en').t('common.transactions', { count: 0 })).toBe('No transactions');
  expect(makeI18n('fr').t('common.transactions', { count: 0 })).toBe('Aucune transaction');
  expect(makeI18n('zh').t('common.transactions', { count: 0 })).toBe('暂无交易');
});

// ── Interpolation and fallback ───────────────────────────────────────────────

test('placeholders are filled, not printed', () => {
  const i = makeI18n('fr');
  const out = i.t('deleteAccount.confirmPrompt', { email: 'a@b.com' });
  expect(out).toContain('a@b.com');
  expect(out).not.toContain('%{');
});

test('an untranslated key falls back to English rather than showing the key', () => {
  const i = new I18n({ en, fr: {}, zh: {} });
  i.enableFallback = true;
  i.defaultLocale = 'en';
  i.locale = 'fr';
  expect(i.t('settings.logOut')).toBe('Log Out');
});

// ── Locale negotiation ───────────────────────────────────────────────────────

test('regional variants narrow to a language we ship', () => {
  expect(normalizeLocale('fr-CA')).toBe('fr');
  expect(normalizeLocale('zh-Hant-TW')).toBe('zh');
  expect(normalizeLocale('en_GB')).toBe('en');
  expect(normalizeLocale('EN')).toBe('en');
});

test('an unsupported language is rejected rather than guessed at', () => {
  expect(normalizeLocale('de')).toBeNull();
  expect(normalizeLocale('')).toBeNull();
  expect(normalizeLocale(null)).toBeNull();
});

test('the shipped set is exactly the three languages', () => {
  expect([...SUPPORTED_LOCALES]).toEqual(['en', 'fr', 'zh']);
});

// ── Length, which breaks fixed-width UI ──────────────────────────────────────

test('no French string is wildly longer than its English source', () => {
  // French runs ~20% longer and several dashboard tiles are already tight.
  // Anything more than double is a layout break waiting to happen.
  const flat = (o: Record<string, unknown>, p = ''): [string, string][] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object'
        ? flat(v as Record<string, unknown>, `${p}${k}.`)
        : [[`${p}${k}`, String(v)] as [string, string]]
    );

  const enMap = new Map(flat(en));
  const offenders = flat(fr)
    .filter(([k, v]) => {
      const source = enMap.get(k);
      return source && source.length >= 12 && v.length > source.length * 2;
    })
    .map(([k]) => k);

  expect(offenders).toEqual([]);
});

// ── Every key the app asks for must exist ────────────────────────────────────

/** Every t('…') key referenced anywhere in src, excluding tests. */
function usedKeys(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') usedKeys(full, found);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
      for (const m of readFileSync(full, 'utf8').matchAll(/\bt\('([^']+)'/g)) {
        found.add(m[1]!);
      }
    }
  }
  return found;
}

test('every translation key used in the app exists in the catalogue', () => {
  // A missing key renders its own path — "settings.logOut" — at the user.
  const available = new Set(flatten(en));
  // Namespaces count too: t('a.b') where b is an object is a plural lookup.
  for (const key of flatten(en)) {
    const parts = key.split('.');
    for (let i = 1; i < parts.length; i++) available.add(parts.slice(0, i).join('.'));
  }

  const missing = [...usedKeys(join(import.meta.dir, '..', '..'))].filter(
    (k) => !available.has(k)
  );
  expect(missing).toEqual([]);
});

test('the catalogue is actually being used', () => {
  // Guards against the extraction silently reverting.
  expect(usedKeys(join(import.meta.dir, '..', '..')).size).toBeGreaterThan(50);
});

// ── t() must not be called at module scope ───────────────────────────────────

test('no screen resolves a translation at module scope', () => {
  // A t() call outside a function body runs once, when the module is first
  // imported, and keeps whatever language was active at that moment. It then
  // survives everything: the locale change, the remount the change triggers,
  // and every re-render after. The failure is silent — the string is a real
  // translation, just the wrong one, and only in whichever language the app
  // happened to start in.
  //
  // Counting brackets is not enough to detect this, which an earlier version
  // of this test got wrong: a module-scope `const ROWS = [...]` is inside
  // brackets and still evaluated at import. What matters is whether the
  // enclosing top-level declaration is a *function*. So this walks top-level
  // statements — anything starting in column 0 — and flags a t() inside one
  // that is a plain data initialiser rather than a function or component.
  const FN_START = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b|=>|=\s*\(|\bfunction\s*\(/;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && full.endsWith('.tsx') ? [full] : [];
    });

  const offenders: string[] = [];
  for (const file of ['app', 'components'].flatMap((r) => walk(join(import.meta.dir, '..', '..', r)))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let stmtIsFunction = true;   // before any declaration, assume safe
    let stmtStart = 0;
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      // a new top-level statement starts at column 0
      if (/^[A-Za-z]/.test(code) && /^(?:export|const|let|var|function|type|interface|import)\b/.test(code)) {
        stmtIsFunction = FN_START.test(code);
        stmtStart = i;
      }
      if (!stmtIsFunction && /\bt\(['"`]/.test(code)) {
        offenders.push(`${file.split('/src/')[1]}:${i + 1} (declared line ${stmtStart + 1})`);
      }
    });
  }

  expect(offenders).toEqual([]);
});

// ── Guard against new hardcoded UI strings ───────────────────────────────────

/**
 * Everything a user reads has to come from a translation key.
 *
 * This exists because the untranslated strings were missed three times by
 * hand-written greps that each matched a narrower pattern than the last: JSX
 * text, then attributes, then object literals, then template literals. Each
 * pass reported a smaller number than the truth. A test is the only version of
 * that check that stays honest.
 *
 * Values that are stored, sent to the backend, or are brand names are listed in
 * ALLOWED: those must stay canonical English, and translating them would break
 * the enum the backend validates against.
 */
const ALLOWED = new Set([
  // Canonical stored values — see category-meta.ts and tx-display.ts.
  'Travel', 'Software', 'Meals', 'Office', 'Transport', 'Food', 'Gym', 'Shopping',
  'Subscriptions', 'Other', 'Expense', 'Income', 'Approved', 'Rejected', 'Pending',
  'Owner', 'Admin', 'Member', 'Manager', 'Employee', 'Business',
  // Brand and format literals that are the same in every language.
  'Budget', 'Alipay 支付宝', 'WeChat Pay 微信', 'YYYY-MM-DD', 'ABC123',
]);

const UI_ATTRS = 'placeholder|title|label|subtitle|body|message|header|description|buttonTitle|hint';
const CODEISH = /=>|\);|;\s|\bconst\b|\blet\b|\breturn\b|useState|React\.|StyleProp|Promise|\?:|&&|\|\||:\s*(string|number|boolean)|\bprops\b|\bcase\b|[{}=()`]|Record</;
const NOISE = /^(https?:|\/|#[0-9a-fA-F]{3,8}$|rgba?\(|PlusJakartaSans|(bg|text|font|border|flex|items|justify|rounded|px|py|mt|mb|ml|mr|w|h|gap)-|[a-z]+Idx$|en-US|UTC)/;

function isProse(value: string): boolean {
  const s = value.trim();
  if (s.length < 3 || ALLOWED.has(s)) return false;
  if (NOISE.test(s) || CODEISH.test(s)) return false;
  if (!/[A-Za-z]{3}/.test(s)) return false;
  if (/^[a-z0-9_.-]+$/.test(s)) return false;   // identifiers and keys
  // A dotted camelCase literal is an i18n key chosen by a ternary inside t(),
  // e.g. t(n === 1 ? 'a.one' : 'a.other') — a key, not something a user reads.
  if (/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(s)) return false;
  if (/^[A-Z_]{2,}$/.test(s)) return false;     // CONSTANTS
  return true;
}

function scanForHardcodedStrings(source: string): string[] {
  // Comments, and the keys inside t('…'), are not user-facing strings.
  let src = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\bt\(\s*'[^']*'/g, "t(''")
    .replace(/\bt\(\s*"[^"]*"/g, 't("")');

  const found: string[] = [];
  for (const m of src.matchAll(/>([^<>{}]*(?:\{'[^']*'\}[^<>{}]*)*)</g)) {
    const text = m[1].replace(/\{'[^']*'\}/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && isProse(text)) found.push(text);
  }
  for (const m of src.matchAll(new RegExp(`\\b(${UI_ATTRS})\\s*=\\s*"([^"]{3,})"`, 'g'))) {
    if (isProse(m[2])) found.push(m[2]);
  }
  for (const m of src.matchAll(/\b(title|sub|subtitle|label|desc|description|body|text|hint|placeholder)\s*:\s*'([^']{3,})'/g)) {
    if (isProse(m[2])) found.push(m[2]);
  }
  for (const m of src.matchAll(/\{[^{}]*?(?:&&|\?|:)\s*'([^']{4,})'/g)) {
    if (isProse(m[1])) found.push(m[1]);
  }
  return found;
}

test('no screen renders a hardcoded English string', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory()
        ? walk(full)
        : full.endsWith('.tsx') && !full.endsWith('.test.tsx')
          ? [full]
          : [];
    });

  const offenders: string[] = [];
  for (const file of [...walk('src/app'), ...walk('src/components')]) {
    for (const text of scanForHardcodedStrings(readFileSync(file, 'utf8'))) {
      offenders.push(`${file}: ${text.slice(0, 60)}`);
    }
  }
  expect(offenders).toEqual([]);
});
