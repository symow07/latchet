import { afterEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver, notifyManager, type QueryObserverResult } from '@tanstack/react-query';
import {
  SESSION_QUERY_KEY,
  SessionUnavailableError,
  checkSessionNow,
  confirmedSession,
  sessionGate,
  sessionOutcome,
  sessionQueryOptions,
  sessionRetryDelay,
  type SessionResponse,
} from './session-check';

type Session = { user: { id: string; email: string }; session: { expiresAt: string } };

const NOW = Date.parse('2026-10-30T12:00:00Z');
const session = (id = 'user_1'): Session => ({
  user: { id, email: `${id}@example.test` },
  session: { expiresAt: '2026-11-06T12:00:00Z' },
});
const ok = (s: Session | null = session()): SessionResponse<Session> => ({ data: s, error: null });
const refused = (status: number): SessionResponse<Session> => ({ data: null, error: { status } });

describe('what a session check means', () => {
  test('a session in the answer is signed in', () => {
    expect(sessionOutcome(ok())).toEqual({ kind: 'signed-in', session: session() });
  });

  test('the server answering with no session, or a 401, is signed out', () => {
    expect(sessionOutcome(ok(null))).toEqual({ kind: 'signed-out' });
    expect(sessionOutcome(refused(401))).toEqual({ kind: 'signed-out' });
  });

  test('429, 5xx and anything else the server cannot answer is not a sign-out', () => {
    for (const status of [429, 500, 502, 503, 504, 403, 404]) {
      expect(sessionOutcome(refused(status))).toEqual({ kind: 'unavailable', status });
    }
    expect(sessionOutcome({ data: null, error: {} })).toEqual({ kind: 'unavailable', status: null });
  });
});

describe('backing off', () => {
  test('starts around a second and doubles', () => {
    expect(sessionRetryDelay(0, () => 0)).toBe(500);
    expect(sessionRetryDelay(0, () => 1)).toBe(1_000);
    expect(sessionRetryDelay(1, () => 1)).toBe(2_000);
    expect(sessionRetryDelay(2, () => 1)).toBe(4_000);
  });

  test('never waits more than a minute, however many retries', () => {
    expect(sessionRetryDelay(6, () => 1)).toBe(60_000);
    expect(sessionRetryDelay(50, () => 1)).toBe(60_000);
    expect(sessionRetryDelay(1_000, () => 0)).toBe(30_000);
  });

  test('is the delay the session query waits between retries', () => {
    const { retryDelay } = sessionQueryOptions<Session>({
      getSession: async () => ok(),
      lastConfirmed: () => null,
      timeoutMs: 10_000,
    });
    for (let attempt = 0; attempt < 10; attempt++) {
      const ceiling = Math.min(60_000, 1_000 * 2 ** attempt);
      const wait = retryDelay(attempt);
      expect(wait).toBeGreaterThanOrEqual(ceiling / 2);
      expect(wait).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe('the session the server last confirmed', () => {
  test('is read from the auth client cache', () => {
    expect(confirmedSession<Session>(JSON.stringify(session()), NOW)).toEqual(session());
  });

  test('is nothing after a sign-out, when unreadable, or once expired', () => {
    expect(confirmedSession(null, NOW)).toBeNull();
    expect(confirmedSession('{}', NOW)).toBeNull();
    expect(confirmedSession('null', NOW)).toBeNull();
    expect(confirmedSession('not json', NOW)).toBeNull();
    const expired = { ...session(), session: { expiresAt: '2026-10-30T11:59:59Z' } };
    expect(confirmedSession(JSON.stringify(expired), NOW)).toBeNull();
    const noExpiry = { user: { id: 'user_1' } };
    expect(confirmedSession(JSON.stringify(noExpiry), NOW)).toBeNull();
  });

  test('takes dates as the auth client parses them', () => {
    const revived = { ...session(), session: { expiresAt: new Date('2026-11-06T12:00:00Z') } };
    expect(confirmedSession('ignored', NOW, () => revived)).toBe(revived as never);
  });
});

// ── The session query, on a real React Query client ─────────────────────────

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * The session query with a scripted server: each check takes the next answer
 * ("hang" never answers; an Error is a dropped connection), and the last one
 * repeats. Retries wait 5 ms instead of seconds, and a check times out after 30.
 */
function sessionQuery(
  answers: (SessionResponse<Session> | 'hang' | Error)[],
  opts: { stored?: Session | null; retryDelay?: number; timeoutMs?: number } = {},
) {
  const script = [...answers];
  let calls = 0;
  const options = sessionQueryOptions<Session>({
    getSession: () => {
      calls++;
      const next = script.length > 1 ? script.shift()! : script[0]!;
      if (next === 'hang') return new Promise(() => {});
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
    lastConfirmed: () => opts.stored ?? null,
    timeoutMs: opts.timeoutMs ?? 30,
    retryDelay: () => opts.retryDelay ?? 5,
  });
  const client = new QueryClient();
  const observer = new QueryObserver<Session | null, Error, Session | null, Session | null, typeof SESSION_QUERY_KEY>(
    client,
    options,
  );
  // Subscribed the way useQuery subscribes a component: notified in batches,
  // reading the result as it then stands. `seen` is what the layout renders.
  const seen: QueryObserverResult<Session | null>[] = [];
  const stop = observer.subscribe(notifyManager.batchCalls(() => seen.push(observer.getCurrentResult())));
  cleanups.push(() => {
    stop();
    client.clear();
  });
  return {
    client,
    seen,
    calls: () => calls,
    now: () => observer.getCurrentResult(),
    /** Every answer from here on. */
    answer: (...next: (SessionResponse<Session> | 'hang' | Error)[]) => script.splice(0, script.length, ...next),
  };
}

async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 2));
  }
}

const userOf = (r: QueryObserverResult<Session | null>) => r.data?.user.id ?? r.data;

describe('a server that cannot answer never signs anyone out', () => {
  test('a 429 on a cold start keeps the last confirmed user signed in, and retries until it answers', async () => {
    const q = sessionQuery([refused(429), refused(429), refused(503), ok()], { stored: session() });

    await until(() => q.now().isPlaceholderData);
    expect(userOf(q.now())).toBe('user_1');
    expect(sessionGate({ hasSession: !!q.now().data, isLoading: q.now().isLoading, error: q.now().error, failureCount: q.now().failureCount })).toBe('settled');

    await until(() => q.now().status === 'success' && !q.now().isPlaceholderData);
    expect(q.calls()).toBe(4);
    expect(userOf(q.now())).toBe('user_1');
    // Not once in between did the app see "no session".
    expect(q.seen.some((r) => r.data === null)).toBe(false);
    expect(q.seen.some((r) => r.error !== null)).toBe(false);
  });

  test('5xx while signed in keeps the session, and the check keeps retrying', async () => {
    const q = sessionQuery([ok()]);
    await until(() => userOf(q.now()) === 'user_1');

    q.answer(refused(502), refused(503), refused(500), refused(429), ok());
    const from = q.seen.length;
    void q.client.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    await until(() => q.calls() === 6 && !q.now().isFetching);

    const during = q.seen.slice(from);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((r) => userOf(r) === 'user_1')).toBe(true);
    expect(during.every((r) => r.error === null)).toBe(true);
    expect(during.some((r) => r.failureReason instanceof SessionUnavailableError)).toBe(true);
  });

  test('a timeout or a dropped connection is unanswered too', async () => {
    const q = sessionQuery(['hang', new TypeError('Network request failed'), ok()], { stored: session() });
    await until(() => q.now().isPlaceholderData);
    expect(q.now().failureReason).toBeInstanceOf(SessionUnavailableError);
    expect(q.now().failureReason?.message).toBe('Session check timed out');
    await until(() => q.calls() === 3 && !q.now().isPlaceholderData);
    expect(userOf(q.now())).toBe('user_1');
  });

  test('with no confirmed session to fall back on, the layout says so after two failures, until the server answers', async () => {
    const q = sessionQuery([refused(429), refused(429), refused(429), ok()]);
    const gate = () =>
      sessionGate({ hasSession: !!q.now().data, isLoading: q.now().isLoading, error: q.now().error, failureCount: q.now().failureCount });
    expect(gate()).toBe('checking');
    await until(() => gate() === 'unreachable');
    expect(q.now().data).toBeUndefined();
    await until(() => gate() === 'settled');
    expect(userOf(q.now())).toBe('user_1');
  });

  test('a slow first check is waited for: no stand-in before it has failed', async () => {
    const q = sessionQuery(['hang', ok()], { stored: session(), timeoutMs: 200 });
    await new Promise((r) => setTimeout(r, 20));
    expect(q.now().isLoading).toBe(true);
    expect(q.now().data).toBeUndefined();
    expect(q.now().isPlaceholderData).toBe(false);
  });
});

describe('the server saying there is no session is believed', () => {
  test('on a cold start, even with a confirmed session stored', async () => {
    const q = sessionQuery([ok(null)], { stored: session() });
    await until(() => q.now().status === 'success');
    expect(q.now().data).toBeNull();
    expect(q.now().isPlaceholderData).toBe(false);
  });

  test('after a 429, once it can answer', async () => {
    const q = sessionQuery([refused(429), ok(null)], { stored: session() });
    await until(() => q.now().status === 'success' && !q.now().isPlaceholderData);
    expect(q.now().data).toBeNull();
  });

  test('a 401 while signed in signs out', async () => {
    const q = sessionQuery([ok()]);
    await until(() => userOf(q.now()) === 'user_1');
    q.answer(refused(401));
    await q.client.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    expect(q.now().data).toBeNull();
  });
});

describe('checking now', () => {
  test('starts a check at once instead of waiting out the backoff', async () => {
    const q = sessionQuery([refused(429), ok()], { retryDelay: 60_000 });
    await until(() => q.now().failureCount === 1);
    // An invalidation alone would wait for the pending retry, a minute away.
    await checkSessionNow(q.client);
    expect(q.calls()).toBe(2);
    expect(userOf(q.now())).toBe('user_1');
    // Starting over never showed the layout "no session" on the way.
    const settledEmpty = q.seen.filter(
      (r) =>
        r.data === undefined &&
        sessionGate({ hasSession: false, isLoading: r.isLoading, error: r.error, failureCount: r.failureCount }) === 'settled',
    );
    expect(settledEmpty).toEqual([]);
  });

  test('with a session in the cache, checks again and keeps it while it does', async () => {
    const q = sessionQuery([ok()]);
    await until(() => userOf(q.now()) === 'user_1');
    q.answer(ok(session('user_1')));
    await checkSessionNow(q.client);
    expect(q.calls()).toBe(2);
    expect(q.seen.every((r) => r.isLoading || userOf(r) === 'user_1')).toBe(true);
  });
});
