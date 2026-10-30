import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { parseJSON } from "better-auth/client";
import * as SecureStore from "expo-secure-store";
import { AUTH_STORAGE_PREFIX_MOVE } from "../storage-migration";
import { authClient } from "./auth-client";
import {
  SESSION_QUERY_KEY,
  checkSessionNow,
  confirmedSession,
  sessionOutcome,
  sessionQueryOptions,
} from "./session-check";

export { SESSION_QUERY_KEY, checkSessionNow };

const SESSION_TIMEOUT_MS = 10000;

type SessionData = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>['data']>;

/**
 * The session the server last confirmed, as the auth client cached it
 * (session-check.ts). Its key is named after the client's storagePrefix, which
 * storage-migration.test.ts holds equal to AUTH_STORAGE_PREFIX_MOVE.to.
 */
function lastConfirmedSession(): SessionData | null {
  try {
    const raw = SecureStore.getItem(`${AUTH_STORAGE_PREFIX_MOVE.to}_session_data`);
    return confirmedSession<SessionData>(raw, Date.now(), (text) => parseJSON(text, { strict: false }));
  } catch {
    return null;
  }
}

// One set of options for every useSession: its retry state and the
// placeholder decision are shared by the one query they describe.
const sessionQuery = sessionQueryOptions<SessionData>({
  getSession: async () => {
    console.log("[useSession] querying authClient.getSession()");
    const t0 = Date.now();
    try {
      const result = await authClient.getSession();
      console.log("[useSession] resolved", {
        ms: Date.now() - t0,
        status: result?.error?.status ?? null,
        hasUser: !!result?.data?.user,
        userId: result?.data?.user?.id ?? null,
      });
      return result;
    } catch (err) {
      console.warn(`[useSession] error after ${Date.now() - t0}ms: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  },
  lastConfirmed: lastConfirmedSession,
  timeoutMs: SESSION_TIMEOUT_MS,
});

/**
 * The signed-in session. A server that cannot answer (429, 5xx, no network,
 * a timeout) never signs anyone out: the check retries with backoff while the
 * session it last confirmed stands (session-check.ts).
 */
export const useSession = () => useQuery(sessionQuery);

export const useInvalidateSession = () => {
  const queryClient = useQueryClient();
  return () => checkSessionNow(queryClient);
};

/**
 * Re-read the session from the server into the shared query — quietly.
 *
 * Not invalidateQueries: a background refresh (Settings coming into focus,
 * the verification landing) wants one look, not a check that keeps retrying,
 * and a server that cannot answer leaves the cached session exactly as it was.
 *
 * It only ever refreshes the same user (a newer emailVerified, a new name);
 * it never signs anyone in. With `allowSignOut`, a server that says there is
 * no session any more is believed: a password reset made on this phone has
 * just revoked it, along with every other session of that account.
 */
export async function refreshSession(
  queryClient: QueryClient,
  opts: { allowSignOut?: boolean } = {},
): Promise<'signed-in' | 'signed-out' | 'unknown'> {
  try {
    const outcome = sessionOutcome(await authClient.getSession());
    if (outcome.kind === 'unavailable') return 'unknown';
    const current = queryClient.getQueryData<SessionData | null>(SESSION_QUERY_KEY);
    if (outcome.kind === 'signed-out') {
      if (opts.allowSignOut && current?.user) queryClient.setQueryData(SESSION_QUERY_KEY, null);
      return 'signed-out';
    }
    if (current?.user?.id === outcome.session.user.id) queryClient.setQueryData(SESSION_QUERY_KEY, outcome.session);
    return 'signed-in';
  } catch {
    return 'unknown';
  }
}
