import { test, expect, mock } from 'bun:test';
import type { Breadcrumb, Event } from '@sentry/react-native';
import {
  crashReportingOptions,
  initCrashReporting,
  scrubBreadcrumb,
  scrubBreadcrumbSafely,
  scrubEvent,
  scrubEventSafely,
  scrubText,
  setCrashReportingUser,
  type SentrySdk,
} from './crash-reporting';

/**
 * Crash reports may leave the phone only with nothing personal in them: the
 * owner's one condition for turning Sentry on. These feed the scrubber the
 * events and breadcrumbs the app really produces and look for anything that
 * would identify a person or their money in what comes out.
 */

/** Everything an event would send, as one string, to look for leaks in. */
const sent = (value: unknown) => JSON.stringify(value);

function errorEvent(value: string, extra: Partial<Event> = {}): Event {
  return {
    event_id: 'e1',
    level: 'error',
    platform: 'javascript',
    exception: {
      values: [
        {
          type: 'Error',
          value,
          stacktrace: {
            frames: [
              { filename: 'app:///main.jsbundle', function: 'save', lineno: 1, colno: 4242, in_app: true, vars: { note: 'Lunch with Ana' } },
            ],
          },
          mechanism: { type: 'onerror', handled: false },
        },
      ],
    },
    ...extra,
  };
}

function fakeSentry(existingClient = false) {
  let client: object | undefined = existingClient ? {} : undefined;
  const init = mock((options: unknown) => {
    client = { options };
    return client;
  });
  const setUser = mock((_user: unknown) => {});
  const sdk = { init, setUser, getClient: () => client } as unknown as SentrySdk;
  return { sdk, init, setUser };
}

test('crash scrubbing: an error message loses the email and the amounts in it', () => {
  const event = errorEvent(
    'Payment from simo.oumaali@icloud.com of $1,234.56 failed; refund 12,50 € and 40 MAD; amount: 1500',
    { message: 'Contact ana+latchet@example.co.uk about 99.99' },
  );
  const out = scrubEvent(event);
  const text = sent(out);

  expect(text).not.toContain('icloud.com');
  expect(text).not.toContain('example.co.uk');
  for (const amount of ['1,234.56', '12,50', '40 MAD', '1500', '99.99']) expect(text).not.toContain(amount);
  expect(out.exception?.values?.[0].value).toBe(
    'Payment from [email] of [amount] failed; refund [amount] and [amount]; amount: [amount]',
  );
  expect(out.message).toBe('Contact [email] about [amount]');

  // What a developer needs survives: the type, the frames, a status code, a
  // version, a time, and code quoted in the message.
  const kept = scrubText("TypeError: Cannot read property 'map' of undefined (HTTP 500, SDK 6.14.0, at 2026-10-12T10:00:00Z)");
  expect(kept).toBe("TypeError: Cannot read property 'map' of undefined (HTTP 500, SDK 6.14.0, at 2026-10-12T10:00:00Z)");
  const frame = out.exception?.values?.[0].stacktrace?.frames?.[0];
  expect(frame).toEqual({ filename: 'app:///main.jsbundle', function: 'save', lineno: 1, colno: 4242, in_app: true });
});

test('crash scrubbing: a fetch breadcrumb keeps method, path and status — no body, no query string', () => {
  const crumb: Breadcrumb = {
    type: 'http',
    category: 'fetch',
    level: 'info',
    timestamp: 1,
    data: {
      method: 'post',
      url: 'https://latchet-production.up.railway.app/api/transactions?search=coffee&email=simo%40icloud.com#top',
      status_code: 201,
      request_body: '{"note":"Lunch with Ana","amount":12.5}',
      response_body: '{"balance":2400}',
      body: 'note=Lunch+with+Ana',
      headers: { Authorization: 'Bearer abc.def.ghi', Cookie: 'better-auth.session_token=s3cret' },
      'http.query': 'search=coffee',
    },
  };
  expect(scrubBreadcrumb(crumb)).toEqual({
    type: 'http',
    category: 'fetch',
    level: 'info',
    timestamp: 1,
    data: { method: 'POST', url: 'https://latchet-production.up.railway.app/api/transactions', status_code: 201 },
  });

  // sentry-cocoa's own request breadcrumbs reach JS events merged in; they go the same way.
  const native: Breadcrumb = { type: 'http', category: 'http', data: { url: 'https://x.test/a?q=1', 'http.query': 'q=1', method: 'GET' } };
  const out = scrubEvent(errorEvent('boom', { breadcrumbs: [native] }));
  expect(out.breadcrumbs).toEqual([{ type: 'http', category: 'http', data: { method: 'GET', url: 'https://x.test/a' } }]);
});

test('crash scrubbing: auth headers, cookies and request bodies never leave the phone', () => {
  const event = errorEvent('Request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', {
    request: {
      url: 'https://latchet-production.up.railway.app/api/me?token=abc123',
      method: 'GET',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', Cookie: 'better-auth.session_token=s3cret' },
      cookies: { 'better-auth.session_token': 's3cret' },
      data: { email: 'simo@icloud.com', password: 'hunter22' },
      query_string: 'token=abc123',
    },
    contexts: {
      response: { status_code: 401, headers: { 'set-cookie': 'session=s3cret' }, data: '{"error":"bad"}' },
      device: { name: "Simo's iPhone", model: 'iPhone14,10', family: 'iOS' },
      os: { name: 'iOS', version: '17.10' },
    },
    extra: { cookie: 'session=s3cret', headers: { authorization: 'Basic dXNlcjpwYXNz' }, screen: 'settings' },
  });
  const out = scrubEvent(event);
  const text = sent(out);

  for (const secret of ['eyJhbGciOiJIUzI1NiJ9', 's3cret', 'abc123', 'hunter22', 'simo@icloud.com', 'dXNlcjpwYXNz', "Simo's iPhone"]) {
    expect(text).not.toContain(secret);
  }
  expect(out.request).toEqual({ url: 'https://latchet-production.up.railway.app/api/me', method: 'GET' });
  expect(out.contexts?.response).toBeUndefined();
  // The device's facts stay readable: the model and the OS version are not amounts.
  expect(out.contexts?.device).toEqual({ model: 'iPhone14,10', family: 'iOS' });
  expect(out.contexts?.os).toEqual({ name: 'iOS', version: '17.10' });
  expect(out.extra).toEqual({ screen: 'settings' });
  expect(scrubText('cookie: a=1; b=2')).toBe('cookie: [redacted]');
});

test('crash scrubbing: the user is reduced to an opaque id, with no email, name or IP', () => {
  const out = scrubEvent(
    errorEvent('boom', {
      user: { id: 'Vb3kX9qLmN2pR7sT', email: 'simo@icloud.com', username: 'simo', ip_address: '81.192.0.1', name: 'Simo' } as Event['user'],
    }),
  );
  expect(out.user).toEqual({ id: 'Vb3kX9qLmN2pR7sT' });
  // Sentry is also told not to fill the IP in from the connection.
  expect((out.sdk as { settings?: unknown } | undefined)?.settings).toEqual({ infer_ip: 'never' });

  // No id, no user at all — never an email in its place.
  const anonymous = scrubEvent(errorEvent('boom', { user: { email: 'simo@icloud.com', ip_address: '81.192.0.1' } }));
  expect(anonymous.user).toBeUndefined();
});

test('crash scrubbing: transaction notes and names are dropped from data and from messages', () => {
  const out = scrubEvent(
    errorEvent('Category "Eating out" not found for {"note":"Ana birthday","merchant":"Starbucks","id":"t1"} «Courses du samedi»', {
      extra: { note: 'Lunch with Ana', merchant: 'Joe Cafe', amount: 12.5, categoryName: 'Gifts', screen: 'add-expense' },
      tags: { merchant: 'Starbucks', screen: 'add-expense' },
      breadcrumbs: [
        { category: 'ui.click', message: 'Saved "Lunch with Ana" for €12', data: { title: 'Lunch with Ana', description: 'Ana', id: 't1' } },
      ],
    }),
  );
  const text = sent(out);
  for (const personal of ['Eating out', 'Ana birthday', 'Starbucks', 'Lunch with Ana', 'Joe Cafe', 'Gifts', 'Courses du samedi', '12.5', '€12']) {
    expect(text).not.toContain(personal);
  }
  expect(out.extra).toEqual({ screen: 'add-expense' });
  expect(out.tags).toEqual({ screen: 'add-expense' });
  expect(out.breadcrumbs).toEqual([{ category: 'ui.click', message: 'Saved "[text]" for [amount]', data: { id: 't1' } }]);
});

test('crash scrubbing: console breadcrumbs keep only the level and the [tag] of a warning or error', () => {
  const log: Breadcrumb = { category: 'console', level: 'log', message: '[mobile:gate:db] ready userId=Vb3kX9 in 12ms' };
  expect(scrubBreadcrumb(log)).toBeNull();

  const warn: Breadcrumb = {
    category: 'console',
    level: 'warning',
    message: '[mobile:signin] failed for simo@icloud.com with balance 2400',
    data: { arguments: ['[mobile:signin] failed for', 'simo@icloud.com'], logger: 'console' },
  };
  expect(scrubBreadcrumb(warn)).toEqual({ category: 'console', level: 'warning', message: '[mobile:signin]' });

  // A line with no tag says nothing worth the risk.
  expect(scrubBreadcrumb({ category: 'console', level: 'error', message: 'Import error: Lunch with Ana' })).toBeNull();
});

test('crash scrubbing: nothing starts without a DSN, and a fast refresh does not start it twice', () => {
  const off = fakeSentry();
  expect(initCrashReporting(off.sdk, { dsn: undefined })).toBe(false);
  expect(initCrashReporting(off.sdk, { dsn: '   ' })).toBe(false);
  expect(off.init).not.toHaveBeenCalled();
  // With crash reporting off, signing in tells Sentry nothing.
  setCrashReportingUser('Vb3kX9qLmN2pR7sT');
  expect(off.setUser).not.toHaveBeenCalled();

  const on = fakeSentry();
  expect(initCrashReporting(on.sdk, { dsn: 'https://public@o1.ingest.sentry.io/2', environment: 'preview' })).toBe(true);
  expect(on.init).toHaveBeenCalledTimes(1);
  const options = on.init.mock.calls[0][0] as ReturnType<typeof crashReportingOptions>;
  expect(options.sendDefaultPii).toBe(false);
  expect(options.environment).toBe('preview');
  expect(options.attachScreenshot).toBe(false);
  expect(options.attachViewHierarchy).toBe(false);
  // sentry-cocoa's own breadcrumbs (request URLs, a touched text field's text) never start.
  expect(options.enableNetworkBreadcrumbs).toBe(false);
  expect(options.enableAutoBreadcrumbTracking).toBe(false);
  expect(options.tracesSampleRate).toBeUndefined();
  expect(options.replaysSessionSampleRate).toBeUndefined();
  expect(options.replaysOnErrorSampleRate).toBeUndefined();

  // Fast refresh re-runs the root layout; the client is already there.
  expect(initCrashReporting(on.sdk, { dsn: 'https://public@o1.ingest.sentry.io/2' })).toBe(true);
  expect(on.init).toHaveBeenCalledTimes(1);

  // The user Sentry sees is the opaque id, then no one after sign-out.
  setCrashReportingUser('Vb3kX9qLmN2pR7sT');
  setCrashReportingUser(null);
  expect(on.setUser.mock.calls).toEqual([[{ id: 'Vb3kX9qLmN2pR7sT' }], [null]]);

  // A broken SDK does not take the app down with it.
  const broken = fakeSentry();
  broken.init.mockImplementation(() => {
    throw new Error('native module missing');
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(initCrashReporting(broken.sdk, { dsn: 'https://public@o1.ingest.sentry.io/2' })).toBe(false);
  } finally {
    console.warn = warn;
  }
});

test('crash scrubbing: the hooks Sentry calls scrub, and drop performance traces', () => {
  const options = crashReportingOptions('https://public@o1.ingest.sentry.io/2');
  const event = errorEvent('simo@icloud.com owes $20') as Parameters<NonNullable<typeof options.beforeSend>>[0];
  const out = options.beforeSend?.(event, {}) as Event;
  expect(out.exception?.values?.[0].value).toBe('[email] owes [amount]');
  expect(options.beforeBreadcrumb?.({ category: 'console', level: 'log', message: 'x' })).toBeNull();
  expect(options.beforeSendTransaction?.({ type: 'transaction' } as never, {})).toBeNull();
});

test('crash scrubbing: a scrubber failure sends a bare crash, never the raw one, and never throws', () => {
  const event = errorEvent('simo@icloud.com paid $40', { user: { id: 'Vb3kX9qLmN2pR7sT', email: 'simo@icloud.com' } });
  // An extra whose getter throws makes the scrubber itself fail.
  Object.defineProperty(event, 'extra', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  expect(() => scrubEvent(event)).toThrow();
  const out = scrubEventSafely(event);
  expect(out).not.toBeNull();
  expect(sent(out)).not.toContain('icloud.com');
  expect(sent(out)).not.toContain('$40');
  expect(out?.exception?.values?.[0]).toEqual({
    type: 'Error',
    value: '[scrubber failed]',
    stacktrace: { frames: [{ filename: 'app:///main.jsbundle', function: 'save', lineno: 1, colno: 4242, in_app: true }] },
  });
  expect(out?.user).toEqual({ id: 'Vb3kX9qLmN2pR7sT' });

  const hostile = {} as Breadcrumb;
  Object.defineProperty(hostile, 'category', {
    get() {
      throw new Error('boom');
    },
  });
  expect(scrubBreadcrumbSafely(hostile)).toBeNull();
});

test('crash scrubbing: the event handed in is left as it was', () => {
  const event = errorEvent('simo@icloud.com', { user: { id: 'u1', email: 'simo@icloud.com' }, extra: { note: 'x' } });
  const before = sent(event);
  scrubEvent(event);
  expect(sent(event)).toBe(before);
});
