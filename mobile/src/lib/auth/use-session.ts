import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export const SESSION_QUERY_KEY = ["auth-session"] as const;

const SESSION_TIMEOUT_MS = 10000;

export class SessionTimeoutError extends Error {
  constructor() {
    super("Session check timed out");
    this.name = "SessionTimeoutError";
  }
}

export const useSession = () => {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      console.log("[useSession] querying authClient.getSession()");
      const t0 = Date.now();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new SessionTimeoutError()),
          SESSION_TIMEOUT_MS,
        );
      });
      try {
        const result = await Promise.race([
          authClient.getSession(),
          timeoutPromise,
        ]);
        console.log("[useSession] resolved", {
          ms: Date.now() - t0,
          hasError: !!result?.error,
          hasData: !!result?.data,
          hasUser: !!result?.data?.user,
          userId: result?.data?.user?.id ?? null,
        });
        return result.data ?? null;
      } catch (err) {
        const isTimeout = err instanceof SessionTimeoutError;
        console.warn(
          `[useSession] ${isTimeout ? "timeout" : "error"} after ${Date.now() - t0}ms: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Re-throw so React Query exposes this as `error`. The consumer in
        // _layout.tsx renders an explicit error UI with Retry, instead of
        // silently treating the user as logged-out (which produced re-login
        // loops that masked real backend slowness).
        throw err;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    retry: 1,
    retryDelay: 1000,
    staleTime: 1000 * 60 * 5,
  });
};

export const useInvalidateSession = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
};
