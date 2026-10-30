import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No layout hides a screen with `href: null`.
 *
 * Since SDK 58, expo-router treats `href: null` as a hidden tab, and a hidden
 * tab that gains focus is replaced by the first visible one. The screens we
 * keep off the bar are opened from elsewhere — Ask from Home, business
 * Insights from its home card — so every one of those taps would land back
 * where it started. LiquidTabBar draws only the routes in its `tabs` map,
 * which is what keeps them off the bar instead.
 *
 * That shipped in step 5 of the SDK upgrade and was found by the e2e voice
 * flow, which could no longer reach the advisor.
 */
test('no layout hides a screen with href: null', () => {
  const root = join(import.meta.dir, '..', 'app');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name === '_layout.tsx' ? [join(dir, e.name)] : []
    );

  const offenders: string[] = [];
  for (const file of walk(root)) {
    // Comments blanked, line breaks kept, so a note about the rule is not
    // taken for a breach of it and line numbers still point at the source.
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '');
    source.split('\n').forEach((line, i) => {
      if (/href\s*[:=]\s*\{?\s*null/.test(line)) {
        offenders.push(`${file.split('/').slice(-2).join('/')}:${i + 1}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});
