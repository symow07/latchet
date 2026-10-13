import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLocale, t } from './i18n/core';
import { en as EN } from './i18n/locales/catalog';
import {
  REGION_CURRENCY,
  connectFailure,
  connectModel,
  formatMoney,
  inboxReading,
  inviteCodeProblem,
  joinErrorMessage,
  joinFailure,
  normalizeInviteCode,
  parseAmountInput,
  payoffModel,
  profileEdit,
  progressPosition,
  reduceOnboarding,
  regionCurrency,
  resumeProgress,
  settingsFromAnswers,
  startProgress,
  suggestedBudget,
  type ConnectFacts,
  type Msg,
  type OnboardingProgress,
  type PayoffInput,
  type PayoffSubscription,
} from './onboarding-flow';
import { getCurrencyByCode } from './currencies';

const SRC = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const say = (m: Msg | null) => (m ? t(m.key, m.params) : '');

afterAll(() => setLocale('en'));

// ── Region currency ──────────────────────────────────────────────────────────

describe('region currency', () => {
  test('the phone region picks its currency: UK pounds, French euros, Moroccan dirhams, Chinese yuan', () => {
    expect(regionCurrency({ regionCode: 'GB', currencyCode: 'GBP' })).toBe('GBP');
    expect(regionCurrency({ regionCode: 'FR', currencyCode: 'EUR' })).toBe('EUR');
    expect(regionCurrency({ regionCode: 'MA', currencyCode: 'MAD' })).toBe('MAD');
    expect(regionCurrency({ regionCode: 'CN', currencyCode: 'CNY' })).toBe('CNY');
    expect(regionCurrency({ regionCode: 'US', currencyCode: 'USD' })).toBe('USD');
    // The region wins over the locale's currency: an English phone set to France.
    expect(regionCurrency({ regionCode: 'FR', currencyCode: 'USD' })).toBe('EUR');
    // Bulgaria joined the euro on 1 January 2026.
    expect(regionCurrency({ regionCode: 'BG', currencyCode: 'BGN' })).toBe('EUR');
  });

  test('spelling: lower case, the UK alias, whitespace', () => {
    expect(regionCurrency({ regionCode: 'gb' })).toBe('GBP');
    expect(regionCurrency({ regionCode: 'UK' })).toBe('GBP');
    expect(regionCurrency({ regionCode: ' ma ' })).toBe('MAD');
  });

  test('no usable region: the locale currency, then USD — and never a currency the app cannot show', () => {
    expect(regionCurrency({ regionCode: null, currencyCode: 'JPY' })).toBe('JPY');
    expect(regionCurrency({ regionCode: '419', currencyCode: 'MXN' })).toBe('MXN');
    expect(regionCurrency({ regionCode: 'ZZ', currencyCode: 'chf' })).toBe('CHF');
    expect(regionCurrency({ regionCode: null, currencyCode: null })).toBe('USD');
    expect(regionCurrency(null)).toBe('USD');
    expect(regionCurrency({ regionCode: 'GB' }, (code) => code !== 'GBP')).toBe('USD');
    expect(regionCurrency({ regionCode: 'GB', currencyCode: 'EUR' }, (code) => code !== 'GBP')).toBe('EUR');
  });

  test('every currency the region table names is one the app can show', () => {
    // The rates provider quotes no North Korean won, so the list lacks it;
    // a phone there falls back to its locale's currency, then USD.
    const missing = Object.entries(REGION_CURRENCY).filter(([, code]) => !getCurrencyByCode(code));
    expect(missing).toEqual([['KP', 'KPW']]);
    expect(regionCurrency({ regionCode: 'KP', currencyCode: null })).toBe('USD');
    expect(Object.keys(REGION_CURRENCY).length).toBeGreaterThan(240);
  });

  test('the currency step comes first and is what the Cash account follows', () => {
    expect(startProgress().step).toBe('currency');
    const screen = read('app/onboarding.tsx');
    expect(screen).toContain('setPersonalCurrency(');
    expect(screen).toContain('regionCurrency(getLocales()');
    // The Settings picker changes the Cash account with the settings too.
    expect(read('app/currency.tsx')).toContain('setPersonalCurrency(');
  });
});

// ── The flow ─────────────────────────────────────────────────────────────────

const run = (...actions: Parameters<typeof reduceOnboarding>[1][]): OnboardingProgress =>
  actions.reduce(reduceOnboarding, startProgress());

describe('onboarding flow', () => {
  test('currency, then income, then Connect your data, then the search, then the payoff', () => {
    const steps = [startProgress().step];
    let p = startProgress();
    for (const action of [
      { type: 'confirmCurrency', code: 'GBP' },
      { type: 'setIncome', monthlyIncome: 3000, budgetStyle: 'moderate' },
      { type: 'finishConnect', offered: ['email', 'statement'], connected: ['email'] },
      { type: 'detected' },
    ] as const) {
      p = reduceOnboarding(p, action);
      steps.push(p.step);
    }
    expect(steps).toEqual(['currency', 'income', 'connect', 'detect', 'payoff']);
    expect(p.answers).toEqual({
      currency: 'GBP',
      monthlyIncome: 3000,
      budgetStyle: 'moderate',
      connected: ['email'],
      skipped: ['statement'],
    });
  });

  test('income is optional: skipping it records nothing, and clears an earlier answer', () => {
    const skipped = run({ type: 'confirmCurrency', code: 'EUR' }, { type: 'skipIncome' });
    expect(skipped.step).toBe('connect');
    expect(skipped.answers.monthlyIncome).toBeNull();
    const changedMind = run(
      { type: 'confirmCurrency', code: 'EUR' },
      { type: 'setIncome', monthlyIncome: 2000, budgetStyle: 'frugal' },
      { type: 'back' },
      { type: 'skipIncome' },
    );
    expect(changedMind.answers).toMatchObject({ monthlyIncome: null, budgetStyle: null });
    expect(settingsFromAnswers(changedMind.answers)).toEqual({});
  });

  test('back steps one question at a time; from the search or the payoff it returns to Connect', () => {
    const atConnect = run({ type: 'confirmCurrency', code: 'USD' }, { type: 'skipIncome' });
    expect(reduceOnboarding(atConnect, { type: 'back' }).step).toBe('income');
    expect(reduceOnboarding(reduceOnboarding(atConnect, { type: 'back' }), { type: 'back' }).step).toBe('currency');
    expect(reduceOnboarding(startProgress(), { type: 'back' }).step).toBe('currency');
    const searching = reduceOnboarding(atConnect, { type: 'finishConnect', offered: [], connected: [] });
    expect(reduceOnboarding(searching, { type: 'back' }).step).toBe('connect');
    expect(reduceOnboarding(reduceOnboarding(searching, { type: 'detected' }), { type: 'back' }).step).toBe('connect');
  });

  test('a reopened app resumes at the saved step with its answers; a search or payoff searches again', () => {
    const saved = run({ type: 'confirmCurrency', code: 'MAD' }, { type: 'setIncome', monthlyIncome: 9000, budgetStyle: null });
    const reopened = resumeProgress(JSON.parse(JSON.stringify(saved)));
    expect(reopened).toEqual(saved);
    expect(reopened?.step).toBe('connect');

    const payoff = run(
      { type: 'confirmCurrency', code: 'MAD' },
      { type: 'skipIncome' },
      { type: 'finishConnect', offered: ['statement'], connected: [] },
      { type: 'detected' },
    );
    expect(resumeProgress(JSON.parse(JSON.stringify(payoff)))?.step).toBe('detect');
  });

  test('saved progress that is malformed is no progress; a step past the currency without one restarts there', () => {
    expect(resumeProgress(null)).toBeNull();
    expect(resumeProgress('connect')).toBeNull();
    expect(resumeProgress({ version: 2, step: 'connect', answers: {} })).toBeNull();
    expect(resumeProgress({ version: 1, step: 'elsewhere', answers: {} })).toBeNull();
    const noCurrency = resumeProgress({ version: 1, step: 'connect', answers: { connected: ['email', 'fax'] } });
    expect(noCurrency?.step).toBe('currency');
    expect(noCurrency?.answers.connected).toEqual(['email']);
    const badIncome = resumeProgress({
      version: 1,
      step: 'income',
      answers: { currency: 'GBP', monthlyIncome: -5, budgetStyle: 'generous' },
    });
    expect(badIncome?.answers).toMatchObject({ monthlyIncome: null, budgetStyle: null });
  });

  test('connecting a source later takes it off the skipped list', () => {
    const p = run(
      { type: 'confirmCurrency', code: 'USD' },
      { type: 'skipIncome' },
      { type: 'finishConnect', offered: ['email', 'statement', 'bank'], connected: [] },
      { type: 'back' },
      { type: 'connected', source: 'statement' },
    );
    expect(p.answers.skipped).toEqual(['email', 'bank']);
    expect(p.answers.connected).toEqual(['statement']);
  });

  test('finishing writes the income and the budget it picked — never the starting balance or the currency', () => {
    const p = run({ type: 'confirmCurrency', code: 'GBP' }, { type: 'setIncome', monthlyIncome: 3000, budgetStyle: 'moderate' });
    const write = settingsFromAnswers(p.answers);
    expect(write).toEqual({ monthlyIncome: 3000, spendingStyle: 'moderate', monthlyBudget: 2100 });
    expect('startingBalance' in write).toBe(false);
    expect('currency' in write).toBe(false);
    expect(settingsFromAnswers({ ...p.answers, budgetStyle: null })).toEqual({ monthlyIncome: 3000 });
    expect(suggestedBudget(3000, 'frugal')).toBe(1500);
    expect(suggestedBudget(3333, 'generous')).toBe(2833);
    expect(suggestedBudget(0, 'moderate')).toBe(0);
    // The screen writes nothing else either: no starting balance anywhere in it.
    expect(read('app/onboarding.tsx')).not.toContain('startingBalance');
  });

  test('the progress bar: three questions and the results', () => {
    expect(progressPosition('currency')).toEqual({ index: 0, total: 4 });
    expect(progressPosition('connect')).toEqual({ index: 2, total: 4 });
    expect(progressPosition('detect')).toEqual({ index: 3, total: 4 });
    expect(progressPosition('payoff')).toEqual({ index: 3, total: 4 });
  });

  test('the search waits only for an inbox read that is running, and counts what it has scanned', () => {
    const base = { status: 'active', backfillDoneAt: null, messagesScanned: 0 };
    expect(inboxReading([])).toEqual({ reading: false, scanned: 0 });
    expect(
      inboxReading([
        { ...base, provider: 'gmail', syncState: 'backfilling', messagesScanned: 120 },
        { ...base, provider: 'outlook', syncState: 'backfilling', messagesScanned: 30 },
      ]),
    ).toEqual({ reading: true, scanned: 150 });
    // Done, idle (the server slept), failed, or forwarding: nothing to wait for.
    expect(inboxReading([{ ...base, provider: 'gmail', syncState: 'idle', backfillDoneAt: '2026-10-13T10:00:00Z' }]).reading).toBe(false);
    expect(inboxReading([{ ...base, provider: 'gmail', syncState: 'idle' }]).reading).toBe(false);
    expect(inboxReading([{ ...base, provider: 'gmail', syncState: 'backfilling', status: 'needs_reauth' }]).reading).toBe(false);
    expect(inboxReading([{ ...base, provider: 'forwarding', syncState: 'syncing' }]).reading).toBe(false);
  });
});

// ── Connect your data ────────────────────────────────────────────────────────

const facts = (over: Partial<ConnectFacts> = {}): ConnectFacts => ({
  providers: { gmail: { configured: true, verified: true, capReached: false }, outlook: { configured: true } },
  emailConnections: [],
  statementImported: false,
  bankState: 'available',
  banksLinked: 0,
  isPro: true,
  ...over,
});
const ids = (f: ConnectFacts) => connectModel(f).options.map((o) => o.id);

describe('connect step', () => {
  test('offers Gmail and Outlook only where the server has them, and always a statement', () => {
    expect(ids(facts())).toEqual(['gmail', 'outlook', 'statement', 'bank']);
    expect(ids(facts({ providers: { gmail: { configured: false }, outlook: { configured: true } } }))).toEqual([
      'outlook',
      'statement',
      'bank',
    ]);
    expect(ids(facts({ providers: { gmail: { configured: false }, outlook: { configured: false } } }))).toEqual([
      'statement',
      'bank',
    ]);
    // The server could not be asked: no inbox rows, and the screen says why.
    const offline = connectModel(facts({ providers: null }));
    expect(offline.options.map((o) => o.id)).toEqual(['statement', 'bank']);
    expect(offline.emailUnreachable).toBe(true);
    expect(offline.offered).toEqual(['statement', 'bank']);
  });

  test('offers a bank only where Plaid serves the region, marked Pro for a free user', () => {
    expect(ids(facts({ bankState: 'outside' }))).not.toContain('bank');
    expect(ids(facts({ bankState: 'not_configured' }))).not.toContain('bank');
    expect(ids(facts({ bankState: 'unknown' }))).not.toContain('bank');
    const free = connectModel(facts({ isPro: false })).options.find((o) => o.id === 'bank');
    expect(free).toMatchObject({ pro: true, available: true });
    const pro = connectModel(facts({ isPro: true })).options.find((o) => o.id === 'bank');
    expect(pro?.pro).toBe(false);
  });

  test("Gmail's unverified screen is warned about, and its full cap shown rather than offered", () => {
    const unverified = connectModel(
      facts({ providers: { gmail: { configured: true, verified: false }, outlook: { configured: false } } }),
    ).options[0];
    expect(unverified).toMatchObject({ id: 'gmail', unverified: true, available: true });
    const full = connectModel(
      facts({ providers: { gmail: { configured: true, verified: false, capReached: true }, outlook: { configured: true } } }),
    ).options[0];
    expect(full).toMatchObject({ id: 'gmail', capReached: true, available: false });
    // Someone already connected is not refused by the cap.
    const connected = connectModel(
      facts({
        providers: { gmail: { configured: true, capReached: true }, outlook: { configured: true } },
        emailConnections: [{ provider: 'gmail' }],
      }),
    ).options[0];
    expect(connected).toMatchObject({ done: true, capReached: false });
  });

  test('what is connected, however it got there, and what Continue will count as skipped', () => {
    const m = connectModel(facts({ emailConnections: [{ provider: 'forwarding' }], banksLinked: 1 }));
    expect(m.connected).toEqual(['email', 'bank']);
    expect(m.options.find((o) => o.id === 'bank')?.done).toBe(true);
    const p = reduceOnboarding(
      run({ type: 'confirmCurrency', code: 'USD' }, { type: 'skipIncome' }),
      { type: 'finishConnect', offered: m.offered, connected: m.connected },
    );
    expect(p.answers.skipped).toEqual(['statement']);
  });

  test('a failed connection says why in words; a closed browser says nothing', () => {
    expect(connectFailure({ result: 'success' })).toBeNull();
    expect(connectFailure({ result: 'cancel' })).toBeNull();
    expect(connectFailure({ result: 'denied' })?.key).toBe('onboardingFlow.connect.errors.denied');
    expect(connectFailure({ result: 'error', reason: 'not_configured' })?.key).toBe('onboardingFlow.connect.errors.notConfigured');
    expect(connectFailure({ result: 'error', reason: 'cap_reached' })?.key).toBe('onboardingFlow.connect.errors.capReached');
    expect(connectFailure({ result: 'error', reason: 'network' })?.key).toBe('onboardingFlow.connect.errors.offline');
    expect(connectFailure({ result: 'error', reason: 'whatever' })?.key).toBe('onboardingFlow.connect.errors.failed');
  });
});

// ── The payoff ───────────────────────────────────────────────────────────────

const sub = (over: Partial<PayoffSubscription> & { id: string }): PayoffSubscription => ({
  merchantDisplay: over.id,
  typicalAmount: 10,
  cadence: 'monthly',
  currency: 'GBP',
  status: 'active',
  nextExpectedAt: '2026-11-01',
  trialEndsAt: null,
  ...over,
});

const FOUR = [
  sub({ id: 'Netflix', typicalAmount: 10.99 }),
  sub({ id: 'Spotify', typicalAmount: 11.99 }),
  sub({ id: 'iCloud', typicalAmount: 2.99 }),
  sub({ id: 'Gym', typicalAmount: 21 }),
];

const input = (over: Partial<PayoffInput> = {}): PayoffInput => ({
  summary: { active: FOUR, monthlyTotal: 46.97, currency: 'GBP', notInTotal: 0 },
  currency: 'GBP',
  intlTag: 'en-US',
  emailConnected: true,
  inboxStillReading: false,
  anySource: true,
  permission: 'undetermined',
  ...over,
});

describe('onboarding payoff', () => {
  test('"We found 4 subscriptions, £47/month", the dearest listed first', () => {
    setLocale('en');
    const m = payoffModel(input());
    expect(say(m.headline)).toBe('We found 4 subscriptions, £47/month');
    expect(m.items.map((i) => i.name)).toEqual(['Gym', 'Spotify', 'Netflix']);
    expect(say(m.items[0]!.line)).toBe('£21.00 a month');
    expect(m.more).toBe(1);
    expect(t('onboardingFlow.payoff.more', { count: m.more })).toBe('and 1 more');
    expect(say(payoffModel(input({ summary: { active: [FOUR[0]!], monthlyTotal: 10.99, currency: 'GBP', notInTotal: 0 } })).headline)).toBe(
      'We found 1 subscription, £11/month',
    );
    expect(say(payoffModel(input({ summary: { active: [FOUR[2]!], monthlyTotal: 2.99, currency: 'GBP', notInTotal: 0 } })).headline)).toBe(
      'We found 1 subscription, £2.99/month',
    );
  });

  test("in the user's currency and language, plural-correct in French, Chinese and Arabic", () => {
    setLocale('fr');
    const fr = say(payoffModel(input({ summary: { active: FOUR, monthlyTotal: 46.97, currency: 'EUR', notInTotal: 0 }, intlTag: 'fr-FR' })).headline);
    expect(fr).toStartWith('Nous avons trouvé 4 abonnements, 47');
    expect(fr).toContain('€/mois');
    setLocale('zh');
    expect(say(payoffModel(input({ summary: { active: FOUR, monthlyTotal: 300, currency: 'CNY', notInTotal: 0 }, intlTag: 'zh-CN' })).headline)).toBe(
      '我们找到了 4 项订阅，每月 ¥300',
    );
    setLocale('ar');
    const two = say(payoffModel(input({ summary: { active: FOUR.slice(0, 2), monthlyTotal: 120, currency: 'MAD', notInTotal: 0 }, intlTag: 'ar-MA' })).headline);
    expect(two).toContain('وجدنا اشتراكين');
    const eleven = Array.from({ length: 11 }, (_, i) => sub({ id: `s${i}` }));
    expect(say(payoffModel(input({ summary: { active: eleven, monthlyTotal: 110, currency: 'MAD', notInTotal: 0 }, intlTag: 'ar-MA' })).headline)).toContain(
      'وجدنا 11 اشتراكًا',
    );
    setLocale('en');
  });

  test('a subscription in a currency with no rate is left out of the total, and the screen says so', () => {
    setLocale('en');
    const m = payoffModel(input({ summary: { active: FOUR, monthlyTotal: 35.98, currency: 'GBP', notInTotal: 1 } }));
    expect(say(m.headline)).toBe('We found 4 subscriptions, £36/month');
    expect(say(m.note)).toBe("1 of them is billed in another currency, so it isn't in that total.");
    const none = payoffModel(input({ summary: { active: [FOUR[0]!], monthlyTotal: 0, currency: 'GBP', notInTotal: 1 } }));
    expect(say(none.headline)).toBe('We found 1 subscription');
    expect(none.note).toBeNull();
  });

  test('nothing found yet is said honestly: watching the inbox, still reading it, or what to connect', () => {
    setLocale('en');
    const empty = { active: [], monthlyTotal: 0, currency: 'GBP', notInTotal: 0 };
    const watching = payoffModel(input({ summary: empty }));
    expect(say(watching.headline)).toBe('Nothing found yet');
    expect(watching.body?.key).toBe('onboardingFlow.payoff.noneWatching');
    expect(say(watching.body)).toContain('checking it for new billing emails');
    expect(payoffModel(input({ summary: empty, inboxStillReading: true })).body?.key).toBe('onboardingFlow.payoff.noneStillReading');
    expect(payoffModel(input({ summary: empty, emailConnected: false })).body?.key).toBe('onboardingFlow.payoff.noneConnectEmail');
    expect(payoffModel(input({ summary: empty, emailConnected: false, anySource: false })).body?.key).toBe('onboardingFlow.payoff.noneNothing');
    // Nothing to remind about: nothing asked.
    expect(watching.reminders).toBe('none');
    expect(watching.remindersLine).toBeNull();
  });

  test('notification permission is offered only when there is something to remind about, and only while it can be asked', () => {
    expect(payoffModel(input()).reminders).toBe('ask');
    expect(payoffModel(input({ permission: 'granted' })).reminders).toBe('on');
    expect(payoffModel(input({ permission: 'denied' })).reminders).toBe('off');
    expect(payoffModel(input({ permission: null })).reminders).toBe('none');
    const undated = FOUR.map((s) => ({ ...s, nextExpectedAt: null }));
    expect(payoffModel(input({ summary: { active: undated, monthlyTotal: 46.97, currency: 'GBP', notInTotal: 0 } })).reminders).toBe('none');
    const trial = [sub({ id: 'Disney+', status: 'trial', nextExpectedAt: null, trialEndsAt: '2026-10-20', typicalAmount: 7.99 })];
    const m = payoffModel(input({ summary: { active: trial, monthlyTotal: 7.99, currency: 'GBP', notInTotal: 0 } }));
    expect(m.reminders).toBe('ask');
    expect(say(m.items[0]!.line)).toBe('Free trial, then £7.99');
    // The one prompt is leaf 6.6's, from the payoff; the run itself never asks.
    const screen = read('app/onboarding.tsx');
    expect(screen).toContain('askForNotifications()');
    expect(screen).toContain("runDetection('onboarding', { interactive: false, announce: false })");
  });

  test('money keeps its currency: whole for an estimate, minor units for a price, none for yen', () => {
    expect(formatMoney(46.97, 'GBP', 'en-US', true)).toBe('£47');
    expect(formatMoney(9.99, 'USD', 'en-US')).toBe('$9.99');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
  });

  test('every key the payoff can show exists in all four languages', () => {
    const keys = new Set<string>();
    const add = (m: Msg | null) => m && keys.add(m.key);
    const empty = { active: [], monthlyTotal: 0, currency: 'GBP', notInTotal: 0 };
    for (const i of [
      input(),
      input({ permission: 'granted' }),
      input({ permission: 'denied' }),
      input({ summary: { ...input().summary, notInTotal: 1 } }),
      input({ summary: { ...input().summary, notInTotal: 4 } }),
      input({ summary: empty }),
      input({ summary: empty, inboxStillReading: true }),
      input({ summary: empty, emailConnected: false }),
      input({ summary: empty, emailConnected: false, anySource: false }),
      input({ summary: { active: ['weekly', 'biweekly', 'quarterly', 'semiannual', 'yearly', 'unknown'].map((c) => sub({ id: c, cadence: c })), monthlyTotal: 1, currency: 'GBP', notInTotal: 0 } }),
    ]) {
      const m = payoffModel(i);
      [m.headline, m.body, m.note, m.remindersLine, ...m.items.map((x) => x.line)].forEach(add);
    }
    const flow = (EN as Record<string, unknown>).onboardingFlow as Record<string, unknown>;
    const has = (key: string) =>
      key
        .split('.')
        .slice(1)
        .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), flow) !== undefined;
    expect([...keys].filter((k) => !has(k))).toEqual([]);
  });
});

// ── Profile settings ─────────────────────────────────────────────────────────

describe('profile settings', () => {
  test('an amount is read however it is typed', () => {
    expect(parseAmountInput('2500')).toBe(2500);
    expect(parseAmountInput('2 500,50')).toBe(2500.5);
    expect(parseAmountInput('2,500.50')).toBe(2500.5);
    expect(parseAmountInput('2.500,50')).toBe(2500.5);
    expect(parseAmountInput('1,234')).toBe(1234);
    expect(parseAmountInput('12,5')).toBe(12.5);
    expect(parseAmountInput('£47')).toBe(47);
    expect(parseAmountInput('١٢٣٤٫٥')).toBe(1234.5);
    expect(parseAmountInput("1'234.75")).toBe(1234.75);
    expect(parseAmountInput('12.')).toBe(12);
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('-50')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
  });

  test('each editor writes its own field and never the starting balance or the currency', () => {
    expect(profileEdit('goal', 250)).toEqual({ savingsGoal: 250 });
    expect(profileEdit('goal', null)).toEqual({ savingsGoal: 0 });
    expect(profileEdit('income', 3200)).toEqual({ monthlyIncome: 3200 });
    expect(profileEdit('income', -1)).toEqual({ monthlyIncome: 0 });
    for (const screen of ['app/goal.tsx', 'app/income.tsx', 'app/currency.tsx']) {
      const src = read(screen);
      expect(src).not.toContain('startingBalance');
    }
    expect(read('app/goal.tsx')).toContain("profileEdit('goal'");
    expect(read('app/income.tsx')).toContain("profileEdit('income'");
  });

  test("Home's Set a goal opens the goal editor, not onboarding", () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home).toMatch(/setGoal:\s*'\/goal'/);
    expect(home).not.toMatch(/setGoal:\s*'\/onboarding'/);
  });

  test('Settings edits the currency, the monthly income and the savings goal, each on its own', () => {
    const settings = read('app/(tabs)/settings.tsx');
    expect(settings).toContain("router.push('/currency')");
    expect(settings).toContain("router.push('/income' as never)");
    expect(settings).toContain("router.push('/goal' as never)");
    const layout = read('app/_layout.tsx');
    for (const name of ['goal', 'income', 'business-join']) {
      expect(layout).toMatch(new RegExp(`<Stack.Screen name="${name}" options=\\{\\{ headerShown: false, presentation: 'modal' \\}\\} />`));
    }
  });
});

// ── Joining a company ────────────────────────────────────────────────────────

describe('join company', () => {
  test('an invite code is read as the server stores it, and checked for shape before it is sent', () => {
    expect(normalizeInviteCode(' 4f2-a9c ')).toBe('4F2A9C');
    expect(inviteCodeProblem('')).toBe('empty');
    expect(inviteCodeProblem('   ')).toBe('empty');
    expect(inviteCodeProblem('4F2A9')).toBe('format');
    expect(inviteCodeProblem('4F2A9C!')).toBe('format');
    expect(inviteCodeProblem('4f2a9c')).toBeNull();
  });

  test('each failure says what happened: a wrong code, too many tries, already a member, offline', () => {
    expect(joinFailure({ kind: 'notFound', status: 404 })).toBe('wrongCode');
    expect(joinFailure({ kind: 'rateLimited', status: 429 })).toBe('rateLimited');
    expect(joinFailure({ kind: 'conflict', status: 409 })).toBe('alreadyMember');
    expect(joinFailure({ kind: 'network', status: null })).toBe('offline');
    expect(joinFailure({ status: 404 })).toBe('wrongCode');
    expect(joinFailure(new Error('boom'))).toBe('other');
    expect(joinFailure(null)).toBe('other');
    setLocale('en');
    expect(t(joinErrorMessage('rateLimited').key)).toBe('Too many tries. Wait 15 minutes, then try again.');
    for (const lang of ['en', 'fr', 'zh', 'ar'] as const) {
      setLocale(lang);
      for (const p of ['empty', 'format', 'wrongCode', 'rateLimited', 'alreadyMember', 'offline', 'other'] as const) {
        expect(t(joinErrorMessage(p).key)).not.toContain('onboardingFlow.');
      }
    }
    setLocale('en');
  });

  test('Join a company sits beside Create a business, and never creates a business of its own', () => {
    const picker = read('app/account-type.tsx');
    expect(picker).toContain("t('onboardingFlow.join.button')");
    expect(picker).toContain("t('onboardingFlow.join.create')");
    expect(picker).toContain("router.push('/business-join' as never)");
    const join = read('app/business-join.tsx');
    expect(join).toContain('joinBusiness(normalizeInviteCode(code))');
    expect(join).not.toContain('createBusiness');
    expect(join).toContain("router.replace('/(business-tabs)')");
    expect(join).toContain("saveAccountType(userId, 'business')");
  });
});
