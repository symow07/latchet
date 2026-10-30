/**
 * What a session check means for whether someone is signed in.
 *
 * Only the server saying there is no session signs anyone out. A server that
 * cannot answer (rate limited, failing, unreachable, too slow) says nothing
 * about the session: Better Auth's fetch hands a 429 or a 502 back as an
 * error beside empty data, and the app used to read that empty data as
 * "signed out", so a busy server sent people to the sign-in screen. Now it is
 * "unavailable": the session the server last confirmed stands, and the check
 * is retried, backing off, until the server answers.
 *
 * Dependency-free: use-session.ts wires it to the auth client and SecureStore,
 * and session-check.test.ts runs it against a real React Query client.
 */

export const SESSION_QUERY_KEY = ['auth-session'] as const;

/** The parts of a session this module reads. */
export interface SessionLike {
  user: { id: string };
}

/** What the auth client's getSession resolves to: HTTP errors come back, not thrown. */
export interface SessionResponse<S> {
  data?: S | null;
  error?: { status?: number } | null;
}

export type SessionOutcome<S> =
  | { kind: 'signed-in'; session: S }
  | { kind: 'signed-out' }
  | { kind: 'unavailable'; status: number | null };

export function sessionOutcome<S extends SessionLike>(response: SessionResponse<S>): SessionOutcome<S> {
  const { data, error } = response;
  if (error) {
    // A 401 is the server saying the session is not valid. Nothing else is:
    // 429 and 5xx are a busy or failing server, a 403 or 404 a misconfigured
    // one, and none of them ended anyone's session.
    return error.status === 401 ? { kind: 'signed-out' } : { kind: 'unavailable', status: error.status ?? null };
  }
  return data?.user ? { kind: 'signed-in', session: data } : { kind: 'signed-out' };
}

/** The session check got no answer it can act on. Never a sign-out. */
export class SessionUnavailableError extends Error {
  constructor(
    readonly status: number | null,
    message = status === null ? "The server didn't answer" : `The server couldn't answer (${status})`,
  ) {
    super(message);
    this.name = 'SessionUnavailableError';
  }
}

const RETRY_FIRST_MS = 1_000;
const RETRY_CAP_MS = 60_000;

/**
 * The wait before retry number `attempt` (0 for the first): about a second,
 * doubling to a minute at most. Each wait is somewhere between half and all
 * of that, so phones turned away by the same busy server do not all come back
 * at the same moment.
 */
export function sessionRetryDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_FIRST_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * The session the server last confirmed, from the auth client's own cache
 * (the Expo plugin keeps each get-session answer under
 * `<storagePrefix>_session_data`, and "{}" after a sign-out). Null when there
 * is none, it does not parse, or it has expired: the server would refuse an
 * expired session, so it keeps no one signed in.
 */
export function confirmedSession<S extends SessionLike>(
  raw: string | null,
  now: number,
  parse: (text: string) => unknown = JSON.parse,
): S | null {
  if (!raw) return null;
  let parsed: { user?: { id?: unknown }; session?: { expiresAt?: unknown } } | null;
  try {
    parsed = parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed?.user?.id !== 'string' || !parsed.user.id) return null;
  const expiresAt = parsed.session?.expiresAt;
  const expires = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));
  if (!(expires > now)) return null;
  return parsed as unknown as S;
}

export interface SessionQueryDeps<S> {
  /** The auth client's getSession. */
  getSession: () => Promise<SessionResponse<S>>;
  /** confirmedSession, read from where the auth client keeps it. */
  lastConfirmed: () => S | null;
  /** How long one check may take before it counts as unanswered. */
  timeoutMs: number;
  /** The wait before each retry; sessionRetryDelay unless a test needs it shorter. */
  retryDelay?: (attempt: number) => number;
}

/**
 * The session query's options, for useQuery.
 *
 * An unanswered check throws SessionUnavailableError, and React Query retries
 * it for as long as it takes, backing off. Meanwhile the session already in
 * the cache stays, as React Query keeps data through a failing refetch. On a
 * cold start there is none yet, so once a check has gone unanswered the
 * session the server last confirmed stands in as placeholder data: the user
 * stays signed in until the server answers one way or the other. A check that
 * is merely slow is waited for, as before.
 */
export function sessionQueryOptions<S extends SessionLike>(deps: SessionQueryDeps<S>) {
  let unanswered = false;

  return {
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<S | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SessionUnavailableError(null, 'Session check timed out')), deps.timeoutMs);
      });
      try {
        const outcome = sessionOutcome(await Promise.race([deps.getSession(), timeout]));
        if (outcome.kind === 'unavailable') throw new SessionUnavailableError(outcome.status);
        unanswered = false;
        return outcome.kind === 'signed-in' ? outcome.session : null;
      } catch (err) {
        // A thrown error is no answer at all: no network, a dropped connection.
        unanswered = true;
        throw err instanceof SessionUnavailableError
          ? err
          : new SessionUnavailableError(null, err instanceof Error ? err.message : String(err));
      } finally {
        clearTimeout(timer);
      }
    },
    retry: (_failureCount: number, error: Error) => error instanceof SessionUnavailableError,
    retryDelay: deps.retryDelay ?? ((attempt: number) => sessionRetryDelay(attempt)),
    placeholderData: (): S | undefined => (unanswered ? (deps.lastConfirmed() ?? undefined) : undefined),
    staleTime: 1000 * 60 * 5,
  };
}

/** The slice of React Query's client checkSessionNow uses. */
interface SessionQueryClient {
  getQueryState(queryKey: typeof SESSION_QUERY_KEY): { data?: unknown } | undefined;
  invalidateQueries(filters: { queryKey: typeof SESSION_QUERY_KEY }): Promise<void>;
  resetQueries(filters: { queryKey: typeof SESSION_QUERY_KEY }): Promise<void>;
}

/**
 * Check the session now: after signing in, or on Retry. With an answer in the
 * cache, an invalidation cancels whatever retry is pending and checks again.
 * Without one, React Query would only wait for the pending retry, up to a
 * minute away, so the query starts over instead.
 */
export function checkSessionNow(queryClient: SessionQueryClient): Promise<void> {
  return queryClient.getQueryState(SESSION_QUERY_KEY)?.data === undefined
    ? queryClient.resetQueries({ queryKey: SESSION_QUERY_KEY })
    : queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}

/** Failed checks, with no session to fall back on, before the layout says so. */
const UNREACHABLE_AFTER = 2;

/**
 * What the root layout shows for the session check. "settled" once there is a
 * session to go on (confirmed, or the last confirmed one standing in) or the
 * server has said there is none; "unreachable" once checks have failed with
 * nothing to fall back on, a screen with Retry while the check keeps retrying
 * behind it; "checking" until then.
 */
export function sessionGate(state: {
  hasSession: boolean;
  isLoading: boolean;
  error: unknown;
  failureCount: number;
}): 'checking' | 'unreachable' | 'settled' {
  if (state.hasSession) return 'settled';
  if (state.error) return 'unreachable';
  if (!state.isLoading) return 'settled';
  return state.failureCount >= UNREACHABLE_AFTER ? 'unreachable' : 'checking';
}
