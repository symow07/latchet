import { test, expect, describe, afterEach } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  DEVICE_STORAGE_KEYS,
  USER_KEY_SEPARATOR,
  USER_STORAGE_KEYS,
  NoStorageUserError,
  allUserKeysFor,
  setStorageUser,
  userKey,
  userKeyFor,
} from './storage-keys';

/**
 * Every AsyncStorage key in src/ is declared exactly once, as a device key or
 * a user key, and every user key goes through userKey()/userKeyFor().
 *
 * The scan reads each AsyncStorage call's key argument and resolves it — a
 * string literal, a `const` in the same file, or a userKey()/userKeyFor()
 * call around one of those. Anything it cannot resolve fails the test: a key
 * the scan cannot read is a key nobody can audit.
 *
 * user-session.ts is the one exception. It removes keys in bulk (a user's on
 * sign-out, the old bare keys once), computed from the declared lists rather
 * than spelled out, and user-session.test.ts holds those removals to account.
 */

const SRC = join(import.meta.dir, '..');
const EXEMPT = new Set(['lib/user-session.ts']);
const PACKAGE = '@react-native-async-storage/async-storage';
const METHODS = ['getItem', 'setItem', 'removeItem', 'mergeItem', 'multiGet', 'multiSet', 'multiRemove', 'multiMerge'];

interface KeyUse {
  file: string;
  line: number;
  method: string;
  /** The resolved base key, when the argument could be resolved. */
  key?: string;
  /** Wrapped in userKey()/userKeyFor(). */
  scoped: boolean;
  problem?: string;
}

/** Comments out, strings and code kept (URLs inside strings survive). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/**
 * Whether `index` falls inside a string literal on its line. Line-local on
 * purpose (a key never spans lines): it is what keeps a log message such as
 * 'AsyncStorage.getItem(@biometric_lock)' from being read as a call.
 */
function insideString(src: string, index: number): boolean {
  const prefix = src.slice(src.lastIndexOf('\n', index - 1) + 1, index).replace(/\\./g, '');
  return ["'", '"', '`'].some((q) => prefix.split(q).length % 2 === 0);
}

/** The text of the argument starting at `from`, up to its top-level `,` or `)`. */
function readArgument(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return src.slice(from, i);
      depth--;
    } else if (c === ',' && depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

function splitTopLevel(args: string): string[] {
  const out: string[] = [];
  let rest = args;
  while (rest.length > 0) {
    const arg = readArgument(rest, 0);
    out.push(arg.trim());
    rest = rest.slice(arg.length + 1);
  }
  return out;
}

/** Resolve a key expression within one file's source. */
function resolveKey(expr: string, src: string, seen = new Set<string>()): { key: string; scoped: boolean } | { problem: string } {
  const e = expr.trim();
  const literal = e.match(/^(['"`])([^'"`$\\]*)\1$/);
  if (literal) return { key: literal[2]!, scoped: false };

  const call = e.match(/^(userKey|userKeyFor)\s*\(([\s\S]*)\)$/);
  if (call) {
    const args = splitTopLevel(call[2]!);
    const base = call[1] === 'userKey' ? args[0] : args[1];
    if (!base) return { problem: `${call[1]}() without a key` };
    const inner = resolveKey(base, src, seen);
    if ('problem' in inner) return inner;
    if (inner.scoped) return { problem: 'a key scoped twice' };
    return { key: inner.key, scoped: true };
  }

  if (/^[A-Za-z_$][\w$]*$/.test(e) && !seen.has(e)) {
    const def = src.match(new RegExp(`\\b(?:const|let)\\s+${e}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`));
    if (def) return resolveKey(def[1]!, src, new Set([...seen, e]));
  }
  return { problem: `cannot resolve the key \`${e}\`` };
}

/** Every AsyncStorage key argument in one file. */
function findKeyUses(file: string, source: string): KeyUse[] {
  const src = stripComments(source);
  const uses: KeyUse[] = [];
  const lineOf = (index: number) => src.slice(0, index).split('\n').length;

  // Every storage-method call must be on a receiver named AsyncStorage, or
  // the scan below could not see it: `(await storage()).getItem(...)` would
  // slip past a check that only looks for `AsyncStorage.getItem(`.
  if (src.includes(PACKAGE)) {
    for (const m of src.matchAll(new RegExp(`(\\S)\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(`, 'g'))) {
      if (insideString(src, m.index!)) continue;
      const before = src.slice(0, m.index! + 1);
      if (!/\bAsyncStorage$/.test(before)) {
        uses.push({ file, line: lineOf(m.index!), method: m[2]!, scoped: false, problem: 'storage call not on `AsyncStorage`' });
      }
    }
  }

  for (const m of src.matchAll(new RegExp(`\\bAsyncStorage\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(`, 'g'))) {
    if (insideString(src, m.index!)) continue;
    const argument = readArgument(src, m.index! + m[0].length);
    const resolved = resolveKey(argument, src);
    uses.push({ file, line: lineOf(m.index!), method: m[1]!, scoped: 'key' in resolved && resolved.scoped, ...resolved });
  }
  return uses;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const DEVICE = new Set<string>(DEVICE_STORAGE_KEYS);
const USER = new Set<string>(USER_STORAGE_KEYS);

/** Everything wrong with a set of key uses: undeclared, mis-scoped or unreadable. */
function auditKeyUses(uses: KeyUse[]): string[] {
  return uses.flatMap((u) => {
    const at = `${u.file}:${u.line} ${u.method}`;
    if (u.problem) return [`${at}: ${u.problem}`];
    if (!u.key) return [`${at}: no key`];
    if (USER.has(u.key)) return u.scoped ? [] : [`${at}: per-user key '${u.key}' used without userKey()`];
    if (DEVICE.has(u.key)) return u.scoped ? [`${at}: device key '${u.key}' wrapped in userKey()`] : [];
    return [`${at}: undeclared key '${u.key}' — add it to DEVICE_STORAGE_KEYS or USER_STORAGE_KEYS`];
  });
}

const appUses = sourceFiles(SRC)
  .map((f) => relative(SRC, f))
  .filter((f) => !EXEMPT.has(f))
  .flatMap((f) => findKeyUses(f, readFileSync(join(SRC, f), 'utf8')));

describe('every AsyncStorage key in src/', () => {
  test('is declared, and scoped the way it is declared', () => {
    expect(auditKeyUses(appUses)).toEqual([]);
  });

  test('the scan is actually reading the app', () => {
    // Guards against the scan silently matching nothing.
    expect(appUses.length).toBeGreaterThan(15);
    expect(new Set(appUses.map((u) => u.file)).size).toBeGreaterThan(8);
  });

  test('no declaration is stale: every declared key is used somewhere', () => {
    const used = new Set(appUses.map((u) => u.key));
    expect([...DEVICE_STORAGE_KEYS, ...USER_STORAGE_KEYS].filter((k) => !used.has(k))).toEqual([]);
  });

  test('each key is declared exactly once, in exactly one list', () => {
    const all = [...DEVICE_STORAGE_KEYS, ...USER_STORAGE_KEYS];
    expect(new Set(all).size).toBe(all.length);
    for (const k of all) expect(k.includes(USER_KEY_SEPARATOR)).toBe(false);
  });
});

describe('the scan itself', () => {
  const audit = (source: string) => auditKeyUses(findKeyUses('fixture.ts', source));

  test('catches an undeclared key, however it is spelled', () => {
    expect(audit(`AsyncStorage.getItem('@brand_new_key')`)).toHaveLength(1);
    expect(audit(`const K = 'secret_cache';\nawait AsyncStorage.setItem(K, v);`)[0]).toMatch(/undeclared key 'secret_cache'/);
    expect(audit(`AsyncStorage.removeItem(userKey('@not_declared'))`)[0]).toMatch(/undeclared/);
  });

  test('catches a per-user key used bare, and a device key scoped by mistake', () => {
    expect(audit(`AsyncStorage.getItem('linked_banks')`)[0]).toMatch(/without userKey/);
    expect(audit(`AsyncStorage.getItem(userKey('@biometric_lock'))`)[0]).toMatch(/device key/);
  });

  test('accepts declared keys through literals, consts and userKey', () => {
    expect(
      audit(
        [
          `const KEY = '@biometric_lock';`,
          `const BANKS = 'linked_banks';`,
          `await AsyncStorage.getItem(KEY);`,
          `await AsyncStorage.setItem(userKey(BANKS), JSON.stringify(x));`,
          `await AsyncStorage.getItem(userKeyFor(userId, '@account_type'));`,
          `// AsyncStorage.getItem('commented_out_key')`,
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  test('refuses a key it cannot read, and storage reached under another name', () => {
    expect(audit(`AsyncStorage.getItem(\`@k_\${id}\`)`)[0]).toMatch(/cannot resolve/);
    expect(audit(`AsyncStorage.getItem(keyFor(id))`)[0]).toMatch(/cannot resolve/);
    expect(
      audit(`const s = await import('${PACKAGE}');\nawait (await storage()).getItem(K);`)[0],
    ).toMatch(/not on `AsyncStorage`/);
  });
});

describe('userKey', () => {
  afterEach(() => setStorageUser(null));

  test('scopes a key to a user, distinctly per user', () => {
    expect(userKeyFor('alice', 'linked_banks')).toBe(`linked_banks${USER_KEY_SEPARATOR}alice`);
    expect(userKeyFor('alice', 'linked_banks')).not.toBe(userKeyFor('bob', 'linked_banks'));
    expect(allUserKeysFor('alice')).toEqual(USER_STORAGE_KEYS.map((k) => userKeyFor('alice', k)));
  });

  test('refuses to produce a key with nobody signed in, rather than fall back to a shared one', () => {
    setStorageUser(null);
    expect(() => userKey('@import_profiles_v1')).toThrow(NoStorageUserError);
    expect(() => userKeyFor('', '@import_profiles_v1')).toThrow();
    setStorageUser('carol');
    expect(userKey('@import_profiles_v1')).toBe(userKeyFor('carol', '@import_profiles_v1'));
  });
});
