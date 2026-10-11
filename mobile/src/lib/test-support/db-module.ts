/**
 * A complete stand-in for './db', for tests that cannot load the real one
 * (it imports expo-sqlite).
 *
 * Complete because Bun's module mocks are process-wide and keep the export
 * *names* of the first mock of a path: a later mock.module('./db') can change
 * the values behind existing names but cannot add new ones, so a test that
 * stubbed only addTransaction would leave every later test file unable to
 * import deleteUserDatabase — depending on nothing but the order the files
 * happen to run in. Every stand-in built here exports every runtime name db.ts
 * does; the ones a test does not supply throw if called.
 *
 * Imported only by tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every runtime export of db.ts, read from its source. */
export function dbRuntimeExports(): string[] {
  const source = readFileSync(join(import.meta.dir, '..', 'db.ts'), 'utf8');
  return [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]!);
}

export function dbModuleMock(impl: Record<string, unknown>): Record<string, unknown> {
  const names = dbRuntimeExports();
  for (const name of Object.keys(impl)) {
    if (!names.includes(name)) throw new Error(`db.ts has no export named ${name}`);
  }
  const module: Record<string, unknown> = {};
  for (const name of names) {
    module[name] =
      impl[name] ??
      (() => {
        throw new Error(`db.${name} is not part of this test's stand-in`);
      });
  }
  return module;
}
