import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stepProgressValue, type StepProgressValue } from './progress-a11y';
import { progressPosition } from './onboarding-flow';

/** What iOS says for a value, as React Native builds it (RCTView.m accessibilityValue). */
function spoken(v: StepProgressValue): string | null {
  if (v.text) return v.text;
  if (!(v.min < v.max && v.min <= v.now && v.now <= v.max)) return null;
  return `${Math.trunc((v.now * 100) / (v.max - v.min))} percent`;
}

test('counted from 1, the last of 4 steps was "133 percent"', () => {
  expect(spoken({ min: 1, max: 4, now: 4 })).toBe('133 percent');
});

test('each step of the onboarding bar is read as itself, and the numbers alone stay within 100', () => {
  const steps = (['currency', 'income', 'connect', 'payoff'] as const).map(progressPosition);
  expect(steps.map((p) => spoken(stepProgressValue(p.total, p.index, `Step ${p.index + 1} of ${p.total}`)))).toEqual([
    'Step 1 of 4',
    'Step 2 of 4',
    'Step 3 of 4',
    'Step 4 of 4',
  ]);
  expect(steps.map((p) => spoken(stepProgressValue(p.total, p.index)))).toEqual([
    '25 percent',
    '50 percent',
    '75 percent',
    '100 percent',
  ]);
  // Out of range either way, never past the ends.
  expect(stepProgressValue(4, 7)).toEqual({ min: 0, max: 4, now: 4 });
  expect(stepProgressValue(4, -3)).toEqual({ min: 0, max: 4, now: 0 });
});

test('the kit bar takes its value from here, and onboarding hands it the step in words', () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, f), 'utf8');
  const kit = read('../components/kit.tsx');
  const bar = kit.slice(kit.indexOf('export function StepProgress'));
  expect(bar.slice(0, bar.indexOf('\n}\n'))).toMatch(/accessibilityValue=\{stepProgressValue\(total, current, label\)\}/);
  const screen = read('../app/onboarding.tsx');
  expect(screen).toMatch(/const stepCounter = t\('onboardingFlow\.stepCounter'/);
  expect(screen).toMatch(/<StepProgress [^>]*label=\{stepCounter\}/);
});
