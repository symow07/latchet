import { fetch } from "expo/fetch";
import { authClient } from "../auth/auth-client";
import { t } from "../i18n/core";

const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
const REQUEST_TIMEOUT_MS = 15000;

export class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Network request failed");
    this.name = "NetworkError";
  }
}

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

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

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
    const text = await response.text().catch(() => "");
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: unknown = text;
    let message = t("errors.requestFailed", { status: response.status });
    if (contentType.includes("application/json") && text) {
      try {
        parsed = JSON.parse(text);
        const maybeMessage = (parsed as { message?: unknown })?.message;
        if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
          message = maybeMessage;
        }
      } catch {
        // fall through with raw text
      }
    } else if (text) {
      message = text;
    }
    throw new ApiError(response.status, message, parsed);
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
