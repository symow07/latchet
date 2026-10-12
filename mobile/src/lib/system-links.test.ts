import { test, expect } from 'bun:test';
import { routeForSystemPath } from './system-links';

test('system links: an email or bank return link while running does not navigate', () => {
  expect(routeForSystemPath('realbudget://email/connected?provider=gmail&result=success', false)).toBe('');
  expect(routeForSystemPath('realbudget://bank/linked?result=done', false)).toBe('');
  expect(routeForSystemPath('exp://192.168.1.4:8081/--/email/connected?result=cancel', false)).toBe('');
});

test('system links: a cold start from a return link opens the screen that shows the outcome', () => {
  expect(routeForSystemPath('realbudget://email/connected?result=success', true)).toBe('/email-inbox');
  expect(routeForSystemPath('realbudget:///bank/linked', true)).toBe('/link-bank');
});

test('system links: every other link is left alone', () => {
  for (const p of ['realbudget://subscription-detail?id=sub_netflix', 'realbudget://household-join?code=AB12', '/import', 'realbudget://email-inbox', 'realbudget://bank-linked-help']) {
    expect(routeForSystemPath(p, false)).toBe(p);
    expect(routeForSystemPath(p, true)).toBe(p);
  }
});
