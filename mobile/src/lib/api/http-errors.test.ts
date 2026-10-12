import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, apiErrorFrom, parseErrorResponse } from './http-errors';
import { toApiFailure } from '../api-errors';
import { setLocale } from '../i18n/core';
import { en, fr } from '../i18n/locales/catalog';

const JSON_TYPE = 'application/json; charset=utf-8';

afterEach(() => setLocale('en'));

describe('server error message', () => {
  test("server error message: the backend's `error` field is what the error says", () => {
    // Every backend route answers { error, code }. The client used to read
    // only `message`, so this arrived as "Request failed (400)".
    const e = apiErrorFrom(400, JSON_TYPE, JSON.stringify({ error: 'Type your email address exactly to confirm deletion.', code: 'confirmation_mismatch' }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe('Type your email address exactly to confirm deletion.');
    expect(e.status).toBe(400);
    expect(e.body).toEqual({ error: 'Type your email address exactly to confirm deletion.', code: 'confirmation_mismatch' });
  });

  test('server error message: a `message` field is still read, and `error` wins when both are sent', () => {
    expect(parseErrorResponse(422, JSON_TYPE, JSON.stringify({ message: 'Amount must be positive' })).message).toBe('Amount must be positive');
    expect(parseErrorResponse(409, JSON_TYPE, JSON.stringify({ error: 'Already a member', message: 'Conflict' })).message).toBe('Already a member');
  });

  test('server error message: JSON labelled as text is still read, and a short plain-text refusal is kept', () => {
    expect(parseErrorResponse(404, 'text/plain', '{"error":"No such link session.","code":"link_session_not_found"}').message).toBe('No such link session.');
    expect(parseErrorResponse(401, 'text/plain', 'Unauthorized').message).toBe('Unauthorized');
  });

  test('server error message: a 5xx, an HTML page or an empty body falls back to the localized sentence', () => {
    // A 5xx body can be a stack trace; a proxy's page is HTML.
    expect(parseErrorResponse(500, JSON_TYPE, JSON.stringify({ error: 'TypeError: x is undefined at handler (index.ts:12)' })).message)
      .toBe(en.errors.requestFailed.replace('%{status}', '500'));
    expect(parseErrorResponse(400, 'text/html', '<html><body>Bad Gateway</body></html>').message)
      .toBe(en.errors.requestFailed.replace('%{status}', '400'));
    expect(parseErrorResponse(403, JSON_TYPE, '').message).toBe(en.errors.requestFailed.replace('%{status}', '403'));

    setLocale('fr');
    expect(parseErrorResponse(502, JSON_TYPE, '{}').message).toBe(fr.errors.requestFailed.replace('%{status}', '502'));
  });

  test("server error message: the localized-errors path keeps the server's words and its code", () => {
    const failure = toApiFailure(apiErrorFrom(404, JSON_TYPE, JSON.stringify({ error: 'No such link session.', code: 'link_session_not_found' })));
    expect(failure.kind).toBe('notFound');
    expect(failure.serverMessage).toBe('No such link session.');
    expect((failure.body as { code: string }).code).toBe('link_session_not_found');

    // A paywall answer is recognised by its code.
    const paywall = toApiFailure(apiErrorFrom(402, JSON_TYPE, JSON.stringify({ error: 'Bank sync is a Pro feature.', code: 'upgrade_required' })));
    expect(paywall.kind).toBe('upgrade');
  });
});
