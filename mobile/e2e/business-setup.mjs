#!/usr/bin/env node
// Puts the e2e business in the state flow 18 needs. See e2e/README.md.
//
// Business Insights opens from Home's "Adjust budget", which Home offers only
// when the month's approved spending is over the budget and nothing waits for
// review. An owner cannot approve their own expense, so a second account joins
// the business and submits one, and the owner approves it. Talks to the local
// backend only, as the two @example.test accounts in
// .claude/test-accounts.local.json; the member never signs in to the app.
//
//   node e2e/business-setup.mjs <backend> <run>
//
// Safe to repeat: the member joins once, the budget is set to the same figure,
// and each run adds one approved expense named after the run, so a new month
// is over budget from its first run. Flow 17 creates the business itself, the
// way a user does, so this fails until it has run once.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [backend, run] = process.argv.slice(2);
if (!backend || !run) fail('usage: business-setup.mjs <backend> <run>');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(backend)) fail(`refusing ${backend}: the local backend only`);

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accounts = JSON.parse(readFileSync(join(root, '.claude', 'test-accounts.local.json'), 'utf8'));
const owner = account('e2e-business');
const member = account('e2e-business-member');

/** Under the budget's figure by any approved expense, so one is enough. */
const BUDGET = 10;
const EXPENSE = 25;

const ownerSession = await signIn(owner);
const memberSession = await signIn(member);

const invite = await api(ownerSession, 'GET', '/api/business/invite-code');
if (invite.status === 404) fail('the e2e business does not exist yet: flow 17 creates it');
expect(invite, 200, 'read the invite code');

// Joining again answers 409 and counts against the join limit, so only once.
const mine = await api(memberSession, 'GET', '/api/business');
if (mine.status !== 200) expect(await api(memberSession, 'POST', '/api/business/join', { code: invite.json.code }), 201, 'join the business');

expect(await api(ownerSession, 'PUT', '/api/business/budget', { totalMonthly: BUDGET }), 200, 'set the budget');

const submitted = await api(memberSession, 'POST', '/api/expenses', {
  amount: EXPENSE,
  category: 'Office',
  description: `E2E ${run}`,
});
expect(submitted, 201, 'submit the expense');

// Everything the member has waiting, this run's and any a failed run left, so
// Home's "waiting for your review" does not outrank the budget.
const pending = await api(ownerSession, 'GET', '/api/expenses?status=pending&limit=100');
expect(pending, 200, 'list pending expenses');
let approved = 0;
for (const e of pending.json.expenses) {
  if ((e.submitterId ?? e.submitter?.id) === ownerSession.userId) continue;
  expect(await api(ownerSession, 'PATCH', `/api/expenses/${e.id}/approve`), 200, `approve ${e.id}`);
  approved++;
}
console.log(`business-setup: budget ${BUDGET}, ${approved} expense(s) of the member's approved`);

function account(key) {
  const a = accounts[key];
  if (!a?.email || !a?.password) fail(`no "${key}" entry in .claude/test-accounts.local.json (README)`);
  if (!a.email.endsWith('@example.test')) fail(`"${key}" must be an @example.test address`);
  return a;
}

async function signIn({ email, password }) {
  const res = await fetch(`${backend}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: backend },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) fail(`sign-in as ${email} answered ${res.status}`);
  const body = await res.json();
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { cookie, userId: body.user?.id };
}

async function api(session, method, path, body) {
  const res = await fetch(`${backend}${path}`, {
    method,
    headers: { Cookie: session.cookie, Origin: backend, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

function expect(res, status, what) {
  if (res.status !== status) fail(`could not ${what}: ${res.status} ${res.text.slice(0, 200)}`);
}

function fail(message) {
  console.error(`business-setup: ${message}`);
  process.exit(1);
}
