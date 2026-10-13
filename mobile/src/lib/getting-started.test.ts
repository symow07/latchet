import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKLIST_ROUTES, gettingStartedModel, type ChecklistInput } from './getting-started';

const none = { email: false, statement: false, bank: false, goal: false };

const input = (over: Partial<ChecklistInput> = {}): ChecklistInput => ({
  onboarding: { completed: true, skipped: ['email', 'statement', 'bank'], dismissed: false },
  done: none,
  bankAvailable: true,
  ...over,
});

describe('getting started', () => {
  test('lists each source skipped at onboarding, and a savings goal, each opening its place', () => {
    const m = gettingStartedModel(input());
    expect(m.visible).toBe(true);
    expect(m.items.map((i) => [i.id, i.route])).toEqual([
      ['email', '/email-inbox'],
      ['statement', '/import'],
      ['bank', '/link-bank'],
      ['goal', '/goal'],
    ]);
    // Only what was skipped: someone who connected their email is not asked again.
    const some = gettingStartedModel(input({ onboarding: { completed: true, skipped: ['statement'], dismissed: false } }));
    expect(some.items.map((i) => i.id)).toEqual(['statement', 'goal']);
  });

  test('ticks a row off once it is done, however it got done, and goes once everything is', () => {
    const half = gettingStartedModel(input({ done: { ...none, email: true, goal: true } }));
    expect(half.visible).toBe(true);
    expect(half.items.filter((i) => i.done).map((i) => i.id)).toEqual(['email', 'goal']);
    expect([half.doneCount, half.total]).toEqual([2, 4]);
    const all = gettingStartedModel(input({ done: { email: true, statement: true, bank: true, goal: true } }));
    expect(all.visible).toBe(false);
    expect(all.items).toEqual([]);
  });

  test('can be hidden, and stays hidden', () => {
    expect(gettingStartedModel(input({ onboarding: { completed: true, skipped: ['email'], dismissed: true } })).visible).toBe(false);
  });

  test('only for an account that went through this onboarding, and only once it is finished', () => {
    // Onboarded before the checklist existed, or restored on a new phone: nothing skipped was recorded.
    expect(gettingStartedModel(input({ onboarding: { completed: true, skipped: undefined, dismissed: false } })).visible).toBe(false);
    expect(gettingStartedModel(input({ onboarding: null })).visible).toBe(false);
    // Still onboarding: the checklist is for afterwards.
    expect(gettingStartedModel(input({ onboarding: { completed: false, skipped: ['email'], dismissed: false } })).visible).toBe(false);
    // Skipped nothing: the goal alone, until it is set.
    const goalOnly = gettingStartedModel(input({ onboarding: { completed: true, skipped: [], dismissed: false } }));
    expect(goalOnly.items.map((i) => i.id)).toEqual(['goal']);
    expect(gettingStartedModel(input({ onboarding: { completed: true, skipped: [], dismissed: false }, done: { ...none, goal: true } })).visible).toBe(false);
  });

  test('a skipped bank is offered again only while Plaid serves the region', () => {
    const m = gettingStartedModel(input({ bankAvailable: false }));
    expect(m.items.map((i) => i.id)).toEqual(['email', 'statement', 'goal']);
  });

  test('every row opens a screen the app has, and Home shows the checklist', () => {
    const app = join(import.meta.dir, '..', 'app');
    const files: Record<string, string> = {
      '/email-inbox': 'email-inbox.tsx',
      '/import': 'import.tsx',
      '/link-bank': 'link-bank.tsx',
      '/goal': 'goal.tsx',
    };
    for (const route of Object.values(CHECKLIST_ROUTES)) {
      expect(() => readFileSync(join(app, files[route]!), 'utf8')).not.toThrow();
    }
    expect(readFileSync(join(app, '(tabs)', 'index.tsx'), 'utf8')).toContain('<GettingStarted');
  });
});
