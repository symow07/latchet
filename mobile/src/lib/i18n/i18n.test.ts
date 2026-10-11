import { test, expect } from 'bun:test';
import { I18n } from 'i18n-js';
import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';
import ar from './locales/ar.json';
// The real configuration, plural rules and all — not a reimplementation.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { i18n, setLocale, normalizeLocale, SUPPORTED_LOCALES, LOCALE_LABELS } from './core';
import { BADGE_KEYS } from '../badge-meta';

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

test('Arabic covers every English key', () => {
  const arKeys = new Set(flatten(ar));
  expect(flatten(en).filter((k) => !arKeys.has(k))).toEqual([]);
});

test('no locale carries keys English does not, beyond plural forms', () => {
  // A stray key is a translation of something that no longer exists. Arabic is
  // the exception by design: it has six plural forms where English has two, so
  // `.two`, `.few` and `.many` exist there and nowhere else.
  const enKeys = new Set(flatten(en));
  const PLURAL_FORM = /\.(zero|one|two|few|many|other)$/;
  expect(flatten(fr).filter((k) => !enKeys.has(k))).toEqual([]);
  expect(flatten(zh).filter((k) => !enKeys.has(k))).toEqual([]);
  expect(flatten(ar).filter((k) => !enKeys.has(k) && !PLURAL_FORM.test(k))).toEqual([]);
});

test('Arabic picks the right form in every band', () => {
  const i = makeI18n('ar');
  // zero, one, two, few (3-10), many (11-99), other (100+). The bands repeat
  // every hundred, which is why 103 is few and 111 is many.
  expect(i.t('common.days', { count: 0 })).toBe('لا أيام');
  expect(i.t('common.days', { count: 1 })).toBe('يوم واحد');
  expect(i.t('common.days', { count: 2 })).toBe('يومان');
  expect(i.t('common.days', { count: 5 })).toBe('5 أيام');
  expect(i.t('common.days', { count: 30 })).toBe('30 يومًا');
  expect(i.t('common.days', { count: 100 })).toBe('100 يوم');
  expect(i.t('common.days', { count: 103 })).toBe('103 أيام');
  expect(i.t('common.days', { count: 111 })).toBe('111 يومًا');
});

test('every Arabic countable key defines all six forms', () => {
  // A key missing `few` falls through to `other`, which is the wrong noun form
  // for 3-10 — grammatically wrong rather than merely blunt, and invisible
  // unless someone counts to three.
  const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const countable = flatten(ar)
    .filter((k) => /\.(zero|one|two|few|many)$/.test(k))
    .map((k) => k.replace(/\.[a-z]+$/, ''));

  const incomplete: string[] = [];
  for (const base of new Set(countable)) {
    const has = new Set(flatten(ar).filter((k) => k.startsWith(`${base}.`)).map((k) => k.split('.').pop()));
    if (FORMS.some((f) => !has.has(f))) incomplete.push(base);
  }
  expect(incomplete).toEqual([]);
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

test('the shipped set is exactly the four languages', () => {
  expect([...SUPPORTED_LOCALES]).toEqual(['en', 'fr', 'zh', 'ar']);
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
  'Owner', 'Admin', 'Member', 'Manager', 'Employee',
  // Badge keys: stored by name and translated for display (badge-meta.ts).
  ...BADGE_KEYS,
  // Brand and format literals that are the same in every language.
  'Budget', 'Alipay 支付宝', 'WeChat Pay 微信', 'YYYY-MM-DD', 'ABC123',
]);

/**
 * Messages that are thrown for control flow and caught before anything is
 * shown, by their text with any `${…}` taken out. The catch shows its own
 * translated message, so these stay English for the log. Adding one means
 * arguing here that nobody reads it.
 */
const INTERNAL = new Set([
  // (tabs)/add.tsx: the mutation's onError only rolls back and buzzes.
  'Invalid amount',
  // (tabs)/advisor.tsx: caught at once; the user sees voice.failed.
  'Recording produced no file',
  // _layout.tsx withTimeout: logged; the startup gate shows errors.dbInit.
  'timed out after ms',
]);

const UI_ATTRS = 'placeholder|title|label|subtitle|body|message|header|description|buttonTitle|hint|stage';
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
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(s)) return false; // camelCase identifiers
  return true;
}

/**
 * Calls whose string arguments end up in front of someone: an error message
 * set into state or thrown to a handler that shows it, an alert, a toast, a
 * line pushed onto a list a screen prints. Any state setter counts — a
 * setter handed a sentence is a sentence on screen. Member calls such as
 * AsyncStorage.setItem do not.
 */
const UI_CALLS =
  /(?:\bnew\s+Error|\bAlert\.(?:alert|prompt)|\bshowToast|\btoast(?:\.\w+)?|(?<![.\w])set[A-Z]\w*|\.push|\bannounceForAccessibility)\s*\(/g;

/**
 * The string literals passed directly to a UI call: its own arguments,
 * including both sides of a ternary and the parts of a template, but nothing
 * nested in a callback, an object or an array it is also given (those are
 * scanned by the rules above, or are code).
 */
function callArgumentStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(UI_CALLS)) {
    let depth = 1;
    let quote: string | null = null;
    let start = 0;
    for (let j = m.index! + m[0].length; j < src.length && depth > 0; j++) {
      const c = src[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) {
          quote = null;
          if (depth === 1) out.push(src.slice(start, j).replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim());
        }
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        start = j + 1;
      } else if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
    }
  }
  return out;
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
  // Strings handed to a call. These slipped through every rule above: the
  // four messages on Receipt Scan were setErrorMsg('…') and new Error('…'),
  // and nothing here read call arguments. A trailing comment is dropped
  // first, so an apostrophe in one cannot open a string. `://` is kept.
  const code = src.replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const text of callArgumentStrings(code)) {
    if (isProse(text) && !INTERNAL.has(text)) found.push(text);
  }
  return found;
}

/** Every non-test file under `dir` with one of `exts`. */
function sourceFiles(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test-support' ? [] : sourceFiles(full, exts);
    return exts.some((x) => e.name.endsWith(x)) && !e.name.includes('.test.') ? [full] : [];
  });
}

const SRC = join(import.meta.dir, '..', '..');

/**
 * The src/lib modules whose words reach the screen.
 *
 * Every module that translates — imports the i18n core — builds something a
 * user reads (a label, an alert, an insight), so all of them are read. The
 * two named here are read whatever they import: they returned English
 * sentences that screens print (Health Score's suggestions, the advisor's
 * quick insights) without ever translating, which is exactly what a rule
 * keyed on the import could not see. The i18n machinery itself is excluded.
 */
const SCREEN_TEXT_LIB = ['health-score.ts', 'ai-analysis.ts'];

/**
 * Translating modules left out, each with its reason. notifications.ts puts
 * its words on the lock screen, not on a screen of the app: an action button
 * registered once at launch and a scheduled nudge, both still English, which
 * need re-registering on a language change to fix — a separate piece of work.
 */
const NOT_SCREEN_TEXT = ['notifications.ts'];

/**
 * Functions whose strings are written for the model, not for a person: the
 * advisor's prompt is English on purpose (it carries its own instruction to
 * answer in the user's language), and nothing in it is shown. Each entry must
 * still exist, so a stale one fails rather than silently widening the gap.
 */
const MODEL_FACING: Record<string, string[]> = {
  'ai-analysis.ts': ['buildAIPrompt'],
  'health-score.ts': ['getPersonalityDescription'],
};

function screenTextLibModules(): string[] {
  return sourceFiles(join(SRC, 'lib'), ['.ts']).filter((file) => {
    if (file.includes(`${join('lib', 'i18n')}/`)) return false;
    if (NOT_SCREEN_TEXT.some((name) => file.endsWith(`/lib/${name}`))) return false;
    if (SCREEN_TEXT_LIB.some((name) => file.endsWith(`/lib/${name}`))) return true;
    return /from '(?:\.{1,2}\/)+(?:lib\/)?i18n\/core'|from '@\/lib\/i18n(?:\/core)?'/.test(readFileSync(file, 'utf8'));
  });
}

/** A lib module's source without its model-facing functions (top-level, so they end at a "}" in column 0). */
function screenTextOf(file: string): string {
  let src = readFileSync(file, 'utf8');
  for (const name of MODEL_FACING[file.split('/src/lib/')[1] ?? ''] ?? []) {
    const start = src.search(new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, 'm'));
    if (start < 0) throw new Error(`${file}: no function ${name} to leave out`);
    src = src.slice(0, start) + src.slice(src.indexOf('\n}\n', start) + 3);
  }
  return src;
}

test('call arguments included, no screen, component or on-screen lib module has hardcoded English', () => {
  const offenders: string[] = [];
  const files = [
    ...sourceFiles(join(SRC, 'app'), ['.tsx']),
    ...sourceFiles(join(SRC, 'components'), ['.tsx']),
  ];
  for (const file of files) {
    for (const text of scanForHardcodedStrings(readFileSync(file, 'utf8'))) {
      offenders.push(`${file.split('/src/')[1]}: ${text.slice(0, 60)}`);
    }
  }
  for (const file of screenTextLibModules()) {
    for (const text of scanForHardcodedStrings(screenTextOf(file))) {
      offenders.push(`${file.split('/src/')[1]}: ${text.slice(0, 60)}`);
    }
  }
  expect(offenders).toEqual([]);
});

// ── Call arguments: the gap Receipt Scan fell through ───────────────────────

test('call arguments: English handed to setErrorMsg, Alert.alert, new Error or a toast is caught', () => {
  // The four Receipt Scan messages, as they were, plus the other shapes the
  // same mistake takes.
  const fixture = `
    async function pick() {
      if (status !== 'granted') {
        setErrorMsg('Camera permission is required to take photos.');
        return;
      }
      Alert.alert('Delete this account?', "This can't be undone.");
      if (isNaN(parsed)) throw new Error('Enter a valid amount greater than 0.');
      showToast(\`Saved \${count} transactions\`);
      setStatus(ok ? 'All caught up' : 'Something needs a look');
      tips.push('Wait 24 hours before buying');
    }
  `;
  expect(scanForHardcodedStrings(fixture)).toEqual([
    'Camera permission is required to take photos.',
    'Delete this account?',
    "This can't be undone.",
    'Enter a valid amount greater than 0.',
    'Saved transactions',
    'All caught up',
    'Something needs a look',
    'Wait 24 hours before buying',
  ]);
});

test('call arguments that are keys, storage, logs or nested callbacks are left alone', () => {
  const fixture = `
    setErrorMsg(t('receiptScan.readFailed'));
    throw new Error(t('receiptScan.errAmount'));
    await AsyncStorage.setItem('@biometric_lock', 'true');
    setStage('biometrics');
    setFilter('all');
    Alert.alert(t('dialogs.resetTitle'), t('dialogs.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dialogs.delete'), onPress: async () => {
          try { await reset(); } catch (e) { console.error('[Reset] could not reset the data', e); }
        } },
    ]);
    setTimeout(() => reject(new Error(\`\${label} timed out after \${ms}ms\`)), ms);
    setOpen(false); // don't close twice
    setUrl('https://example.test/a page');
  `;
  expect(scanForHardcodedStrings(fixture)).toEqual([]);
});

test('call arguments are scanned in the lib modules that put words on screen', () => {
  const modules = screenTextLibModules().map((f) => f.split('/src/lib/')[1]);
  // The ones Phase 4 found building English, and the ones that translate.
  for (const name of ['health-score.ts', 'ai-analysis.ts', 'behavior-detection.ts', 'business-subscription-detection.ts', 'expense-meta.ts']) {
    expect(modules).toContain(name);
  }
  // A module that only talks to the server is not among them.
  expect(modules).not.toContain('expenseApi.ts');
});

// ── Every count pluralises ───────────────────────────────────────────────────

test('no %{count} string is a flat string in any locale', () => {
  // "1 expenses", "1 records found": a count in a flat string reads wrong for
  // one of the numbers in every language, and for most of them in Arabic.
  // i18n-js reads {{count}} as the same placeholder, so it counts too.
  const FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
  const isPlural = (v: object) =>
    Object.keys(v).includes('other') && Object.keys(v).every((k) => FORMS.has(k));
  // Strings inside a plural object are its forms; any other string is flat.
  const flatCounts = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string'
        ? /%\{count\}|\{\{\s*count\s*\}\}/.test(v) ? [`${p}${k}`] : []
        : v && typeof v === 'object' && !isPlural(v)
          ? flatCounts(v as Record<string, unknown>, `${p}${k}.`)
          : []
    );
  for (const [lang, data] of Object.entries({ en, fr, zh, ar })) {
    expect([lang, flatCounts(data)]).toEqual([lang, []]);
  }
});

test('every plural has its forms: one and other everywhere, all six in Arabic', () => {
  const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const plurals = (o: Record<string, unknown>, p = ''): [string, Record<string, unknown>][] =>
    Object.entries(o).flatMap(([k, v]) => {
      if (!v || typeof v !== 'object') return [];
      const keys = Object.keys(v);
      return keys.includes('other') && keys.every((x) => FORMS.includes(x))
        ? [[`${p}${k}`, v as Record<string, unknown>]]
        : plurals(v as Record<string, unknown>, `${p}${k}.`);
    });
  const missing: string[] = [];
  for (const [lang, data] of Object.entries({ en, fr, zh, ar })) {
    const need = lang === 'ar' ? FORMS : ['one', 'other'];
    for (const [key, forms] of plurals(data)) {
      for (const f of need) if (typeof forms[f] !== 'string') missing.push(`${lang}:${key}.${f}`);
    }
  }
  expect(missing).toEqual([]);
  expect(plurals(en).map(([k]) => k).sort()).toEqual(plurals(ar).map(([k]) => k).sort());
});

test('the converted counts read right at 0, 1, 2, 11 and 100', () => {
  const en1 = makeI18n('en');
  expect(en1.t('businessExpenses.expenseCount', { count: 1 })).toBe('1 expense');
  expect(en1.t('businessExpenses.expenseCount', { count: 0 })).toBe('No expenses');
  expect(en1.t('transactionsScreen.recordsFound', { count: 1 })).toBe('1 record found');
  expect(en1.t('transactionsScreen.recordsFound', { count: 11 })).toBe('11 records found');
  expect(en1.t('subscriptionDetail.basedOn', { count: 1 })).toContain('1 recurring charge detected');

  const fr1 = makeI18n('fr');
  expect(fr1.t('transactionsScreen.recordsFound', { count: 1 })).toBe('1 enregistrement trouvé');
  expect(fr1.t('billReminders.daysLeft', { count: 2 })).toBe('2 j restants');

  const ar1 = makeI18n('ar');
  expect(ar1.t('businessExpenses.expenseCount', { count: 2 })).toBe('مصروفان');
  expect(ar1.t('businessExpenses.expenseCount', { count: 3 })).toBe('3 مصاريف');
  expect(ar1.t('businessExpenses.expenseCount', { count: 11 })).toBe('11 مصروفًا');
  expect(ar1.t('businessExpenses.expenseCount', { count: 100 })).toBe('100 مصروف');

  const zh1 = makeI18n('zh');
  expect(zh1.t('businessExpenses.expenseCount', { count: 1 })).toBe('1 笔报销');
  makeI18n('en');
});

test('the Chinese option says which Chinese it is', () => {
  // The strings are Simplified. An unqualified "中文" invites a Traditional
  // reader to pick it and be misled.
  expect(LOCALE_LABELS.zh).toBe('简体中文');
});

test('Traditional tags narrow to Simplified rather than falling back to English', () => {
  // Simplified is readable for a Traditional reader; English is not the
  // better answer just because the script differs.
  expect(normalizeLocale('zh-Hant')).toBe('zh');
  expect(normalizeLocale('zh-Hant-TW')).toBe('zh');
  expect(normalizeLocale('zh-HK')).toBe('zh');
});
