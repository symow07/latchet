import { afterEach, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from './i18n/locales/en.json';
import fr from './i18n/locales/fr.json';
import ar from './i18n/locales/ar.json';
import zh from './i18n/locales/zh.json';
import { setLocale } from './i18n/core';
import {
  ApiFailure,
  ensureOk,
  errorMessage,
  errorSentence,
  kindForStatus,
  readJson,
  request,
  toApiFailure,
  type ApiErrorKind,
  type RequestPurpose,
  type ResponseLike,
} from './api-errors';

/**
 * What a failed request puts on screen.
 *
 * The *Api modules cannot load here — they import the shared client, which
 * imports expo/fetch — and a module mock of that client is process-wide in
 * Bun, so standing in for it would decide what every other test file sees.
 * So the requests are driven exactly as the modules drive them, through
 * request() and readJson() with a response expo/fetch could have returned,
 * and a last test reads every *Api module to hold that each of its requests
 * really goes through request().
 */

afterEach(() => setLocale('en'));

const CATALOGUES = { en, fr, ar, zh };

/** A response as expo/fetch hands it over. */
function response(status: number, body: unknown = {}): ResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** One request the way the *Api modules make it: the JSON answer, through request(). */
function call(res: ResponseLike, purpose?: RequestPurpose): Promise<unknown> {
  return request(async () => readJson(res, purpose), purpose);
}

/** The ApiFailure a request rejects with. */
async function failureOf(run: Promise<unknown>): Promise<ApiFailure> {
  const outcome = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(outcome).toBeInstanceOf(ApiFailure);
  return outcome as ApiFailure;
}

test('localized errors: no answer from the server reads as a connection problem, in the app language', async () => {
  setLocale('fr');
  const thrown = [
    // React Native's own fetch.
    new TypeError('Network request failed'),
    // expo/fetch, which authedFetch uses: a FetchError, named plain Error.
    new Error('fetch failed: The Internet connection appears to be offline.'),
    // The shared client's wrapper (api/api.ts).
    Object.assign(new Error('Network request failed'), { name: 'NetworkError' }),
  ];
  for (const e of thrown) {
    const failure = await failureOf(request(async () => { throw e; }));
    expect(failure.kind).toBe('network');
    expect(failure.message).toBe(fr.apiErrors.network);
    expect(failure.status).toBeNull();
    expect(failure.cause).toBe(e);
  }
});

test('localized errors: a server error, a missing record and a refusal each read as their own sentence', async () => {
  setLocale('ar');
  const cases: [number, ApiErrorKind][] = [
    [500, 'server'],
    [502, 'server'],
    [404, 'notFound'],
    [403, 'forbidden'],
    [401, 'unauthorized'],
    [409, 'conflict'],
    [400, 'validation'],
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [504, 'timeout'],
  ];
  const sentences = new Set<string>();
  for (const [status, kind] of cases) {
    // The server's own reason is English; it must not be what is shown.
    const failure = await failureOf(call(response(status, { error: 'Insufficient permissions' })));
    expect([status, failure.kind]).toEqual([status, kind]);
    expect(failure.status).toBe(status);
    expect(failure.message).toBe(ar.apiErrors[kind]);
    expect(failure.message).not.toContain('Insufficient');
    sentences.add(failure.message);
  }
  // server, notFound, forbidden, unauthorized, conflict, validation, tooLarge,
  // rateLimited, timeout: nine different things, nine different sentences.
  expect(sentences.size).toBe(9);
  // A call whose answer is only its status fails the same way.
  const failure = await failureOf(request(async () => ensureOk(response(404, ''))));
  expect(failure.message).toBe(ar.apiErrors.notFound);
  await request(async () => ensureOk(response(204, '')));
});

test("localized errors: the shared client's own errors are translated by kind", async () => {
  // accountApi, achievementsApi, entitlementApi and emailSubscriptionApi go
  // through api/api.ts, which throws ApiError, TimeoutError and NetworkError
  // with English messages ("Request timed out", or the server's words).
  setLocale('zh');
  const apiError = Object.assign(new Error('Not a member of any business'), {
    name: 'ApiError',
    status: 403,
    body: { error: 'Not a member of any business' },
  });
  const timeout = Object.assign(new Error('Request timed out'), { name: 'TimeoutError' });

  const refused = await failureOf(request(async () => { throw apiError; }));
  expect(refused.kind).toBe('forbidden');
  expect(refused.message).toBe(zh.apiErrors.forbidden);
  expect(refused.serverMessage).toBe('Not a member of any business');

  const slow = await failureOf(request(async () => { throw timeout; }));
  expect(slow.kind).toBe('timeout');
  expect(slow.message).toBe(zh.apiErrors.timeout);

  expect(errorMessage(apiError)).toBe(zh.apiErrors.forbidden);
  expect(errorMessage(timeout)).toBe(zh.apiErrors.timeout);
});

test('localized errors: the message is in the language it was thrown in, errorMessage in the language of now', () => {
  setLocale('fr');
  const failure = new ApiFailure('forbidden');
  // Built when thrown: every screen that shows e.message is right as it is.
  expect(failure.message).toBe(fr.apiErrors.forbidden);
  setLocale('zh');
  // A screen that keeps the error and shows it after a language change asks again.
  expect(errorMessage(failure)).toBe(zh.apiErrors.forbidden);
  expect(failure.message).toBe(fr.apiErrors.forbidden);
});

test("localized errors: the server's words are kept for the log and never shown", async () => {
  setLocale('fr');
  const own = await failureOf(call(response(403, { error: 'Cannot approve your own expense' })));
  expect(own.message).toBe(fr.apiErrors.forbidden);
  expect(own.serverMessage).toBe('Cannot approve your own expense');
  expect(own.body).toEqual({ error: 'Cannot approve your own expense' });

  // A 5xx body can be anything — a stack trace here — and is not kept as words.
  const crash = await failureOf(call(response(500, { message: 'TypeError: x is undefined at handler.ts:12' })));
  expect(crash.serverMessage).toBeNull();
  expect(crash.message).toBe(fr.apiErrors.server);

  // A proxy's HTML error page is not JSON and not words.
  const html = await failureOf(call(response(404, '<html><body>Not Found</body></html>')));
  expect(html.kind).toBe('notFound');
  expect(html.serverMessage).toBeNull();
  expect(html.body).toBeNull();
});

test('localized errors: what a request was for decides the sentence where it changes the meaning', async () => {
  setLocale('fr');
  const cases: [number, RequestPurpose, string][] = [
    // Joining with a code: a 404 is a code that does not exist, a 409 a group
    // you are already in.
    [404, 'invite', fr.apiErrors.inviteInvalid],
    [409, 'invite', fr.apiErrors.alreadyMember],
    // Deleting by retyping a name or an email: a 400 is a mismatch.
    [400, 'typedName', fr.apiErrors.typedMismatch],
    // A logo the server cannot read.
    [400, 'image', fr.apiErrors.imageUnusable],
    // Anything else keeps the general sentence.
    [500, 'invite', fr.apiErrors.server],
    [403, 'typedName', fr.apiErrors.forbidden],
  ];
  for (const [status, purpose, sentence] of cases) {
    const failure = await failureOf(call(response(status, { error: 'Invalid invite code' }), purpose));
    expect([status, purpose, failure.message]).toEqual([status, purpose, sentence]);
  }
  // Without a purpose a 404 is just something not found.
  expect((await failureOf(call(response(404)))).message).toBe(fr.apiErrors.notFound);
});

test('localized errors: a paywall answer keeps what isUpgradeRequired reads', async () => {
  // entitlementApi.isUpgradeRequired reads `status === 402` or
  // `body.code === 'upgrade_required'` off whatever was thrown.
  setLocale('ar');
  const paywall = await failureOf(call(response(402, { error: 'Pro required', code: 'upgrade_required' })));
  expect(paywall.kind).toBe('upgrade');
  expect(paywall.status).toBe(402);
  expect((paywall.body as { code?: string }).code).toBe('upgrade_required');
  expect(paywall.message).toBe(ar.apiErrors.upgrade);

  // The code wins over the status that carried it.
  const coded = await failureOf(call(response(403, { code: 'upgrade_required' })));
  expect(coded.kind).toBe('upgrade');
});

test('localized errors: a 200 that is not JSON is the server failing, not a SyntaxError on screen', async () => {
  setLocale('zh');
  const failure = await failureOf(call(response(200, '<html>Service Unavailable</html>')));
  expect(failure.kind).toBe('server');
  expect(failure.message).toBe(zh.apiErrors.server);
  // And a good answer is simply the answer.
  expect(await call(response(200, { business: { id: 'b1' } }))).toEqual({ business: { id: 'b1' } });
});

test('localized errors: anything unrecognised reads as a general failure, never its own text', () => {
  setLocale('fr');
  for (const e of [
    new Error('SQLITE_BUSY: database is locked'),
    new Error('EXPO_PUBLIC_BACKEND_URL is not configured'),
    'a string',
    null,
    undefined,
  ]) {
    expect(errorMessage(e)).toBe(fr.apiErrors.unknown);
    expect(toApiFailure(e).kind).toBe('unknown');
  }
  // An ApiFailure passes through untouched, purpose and all.
  const failure = new ApiFailure('notFound', { purpose: 'invite' });
  expect(toApiFailure(failure, 'image')).toBe(failure);
  expect(errorMessage(failure)).toBe(fr.apiErrors.inviteInvalid);
  // Recognised by name too, should a transpiled class lose instanceof.
  const lookalike = Object.assign(new Error('x'), { name: 'ApiFailure', kind: 'forbidden' });
  expect(toApiFailure(lookalike)).toBe(lookalike as unknown as ApiFailure);
  expect(errorMessage(lookalike)).toBe(fr.apiErrors.forbidden);
});

test('every failure has its sentence in all four languages, translated', () => {
  const kinds: ApiErrorKind[] = [
    'network', 'timeout', 'unauthorized', 'forbidden', 'notFound', 'conflict',
    'validation', 'tooLarge', 'rateLimited', 'upgrade', 'server', 'unknown',
  ];
  const specific: [ApiErrorKind, RequestPurpose][] = [
    ['notFound', 'invite'], ['conflict', 'invite'], ['validation', 'typedName'], ['validation', 'image'],
  ];
  for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
    setLocale(lang as keyof typeof CATALOGUES);
    const shown = [
      ...kinds.map((k) => errorSentence(k)),
      ...specific.map(([k, p]) => errorSentence(k, p)),
    ];
    // Every one resolves to a real sentence of this catalogue, none repeated.
    expect(shown.every((s) => Object.values(catalogue.apiErrors).includes(s))).toBe(true);
    expect(new Set(shown).size).toBe(shown.length);
    if (lang !== 'en') {
      for (const key of Object.keys(en.apiErrors) as (keyof typeof en.apiErrors)[]) {
        expect([lang, key, catalogue.apiErrors[key] !== en.apiErrors[key]]).toEqual([lang, key, true]);
      }
    }
  }
});

test('statuses map to kinds', () => {
  expect(kindForStatus(401)).toBe('unauthorized');
  expect(kindForStatus(402)).toBe('upgrade');
  expect(kindForStatus(410)).toBe('notFound');
  expect(kindForStatus(408)).toBe('timeout');
  expect(kindForStatus(422)).toBe('validation');
  expect(kindForStatus(503)).toBe('server');
  expect(kindForStatus(302)).toBe('unknown');
});

// ── Every server client goes through request() ──────────────────────────────

/** Source without comments, so prose in a doc comment is not read as code. */
const code = (file: string) =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** [start, end) of the argument list of every request(…) call. */
function requestSpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of src.matchAll(/\brequest\s*(?:<[^>()]*>)?\(/g)) {
    let depth = 1;
    let j = m.index! + m[0].length;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') depth--;
    }
    spans.push([m.index!, j]);
  }
  return spans;
}

test('localized errors: every server client sends each request through request(), and raises no English', () => {
  // request() is what turns whatever a request throws into an ApiFailure; a
  // call made outside it reaches the screen as the client's or the server's
  // English, which is how Phase 4 left them.
  const lib = import.meta.dir;
  const clients = readdirSync(lib).filter((n) => /Api\.ts$/.test(n) && !n.includes('.test.'));
  expect(clients.sort()).toEqual([
    'accountApi.ts', 'achievementsApi.ts', 'budgetApi.ts', 'businessApi.ts', 'emailSubscriptionApi.ts',
    'entitlementApi.ts', 'expenseApi.ts', 'householdApi.ts', 'salaryApi.ts',
  ]);

  const outside: string[] = [];
  for (const name of clients) {
    const src = code(join(lib, name));
    const spans = requestSpans(src);
    for (const m of src.matchAll(/\bauthedFetch\s*\(|\bapi\.(?:get|post|put|patch|delete)\s*(?:<[^>()]*>)?\(/g)) {
      if (!spans.some(([a, b]) => m.index! > a && m.index! < b)) {
        outside.push(`${name}:${src.slice(0, m.index).split('\n').length} ${m[0]}`);
      }
    }
    // A body read without readJson lets a SyntaxError through, and the old
    // `throw new Error(data.error ?? …)` put English on screen.
    if (/\.json\(\)/.test(src)) outside.push(`${name}: reads .json() itself`);
    for (const t of src.matchAll(/throw new Error\(([^)]*)\)/g)) {
      if (!/EXPO_PUBLIC_/.test(t[1]!)) outside.push(`${name}: throw new Error(${t[1]})`);
    }
  }
  expect(outside).toEqual([]);
});
