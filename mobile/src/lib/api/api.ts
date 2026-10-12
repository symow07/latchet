import { fetch } from "expo/fetch";
import { authClient } from "../auth/auth-client";
import { ApiError, NetworkError, TimeoutError, apiErrorFrom } from "./http-errors";

// The error classes live in a module with nothing native in it, so they and
// the reading of a failed response are tested without a device.
export { ApiError, NetworkError, TimeoutError };

const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * fetch with the session attached.
 *
 * For the call sites that predate this client and do their own response
 * handling. `credentials: "include"` is NOT enough on this stack — see the note
 * in request() below — so anything talking to the backend has to go through
 * here or it is silently unauthenticated, which surfaces as a 401 that looks
 * like a logged-out user rather than a missing header.
 */
export const authedFetch = (
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  fetch(url, {
    ...init,
    credentials: "include",
    headers: { ...(init.headers ?? {}), Cookie: authClient.getCookie() },
  });

const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {},
): Promise<T> => {
  const method = options.method || "GET";
  // NOTE: The manual Cookie header is currently load-bearing. The mobile
  // auth-client uses the expoClient plugin (no bearerClient), and expo/fetch
  // does not auto-share cookies from SecureStore.
  const cookie = authClient.getCookie();
  console.log(
    `[mobile:api] ${method} ${url} cookieLen=${cookie?.length ?? 0} hasBody=${!!options.body}`,
  );
  const t0 = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseUrl}${url}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Cookie: cookie,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const ms = Date.now() - t0;
    if (controller.signal.aborted) {
      console.error(`[mobile:api:timeout] ${method} ${url} ms=${ms}`);
      throw new TimeoutError();
    }
    console.error(
      `[mobile:api:throw] ${method} ${url} ms=${ms} err=${err instanceof Error ? err.message : String(err)}`,
    );
    throw new NetworkError(err);
  }
  clearTimeout(timeoutId);
  console.log(
    `[mobile:api:res] ${method} ${url} ms=${Date.now() - t0} status=${response.status}`,
  );

  if (!response.ok) {
    // The server's own reason — its `error` field, or `message` — when it is
    // a request's short plain sentence (http-errors.ts).
    const text = await response.text().catch(() => "");
    throw apiErrorFrom(response.status, response.headers.get("content-type") ?? "", text);
  }
  return response.json();
};

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  // Optional body: account deletion carries a typed confirmation.
  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "DELETE",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
};
