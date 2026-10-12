/**
 * HTTP for the mailbox providers: every call through lib/fetch-timeout, the
 * development override for a fake provider, bounded bodies, short retries on
 * throttling, and errors mapped to codes without ever carrying the provider's
 * response text (which can echo addresses or tokens).
 */

import { fetchWithTimeout, type TimeoutInit } from "../fetch-timeout";
import {
  AccessExpiredError,
  MailboxUnavailableError,
  ProviderBusyError,
  ProviderError,
  ReauthRequiredError,
  type FetchFn,
} from "./types";

/**
 * `https://<host><path>` → `${override}/<host><path>` when an override is set
 * (development and tests only; the config never passes one in production).
 * Anything else is left as it is.
 */
export function providerUrl(url: string, override: string | null): string {
  if (!override) return url;
  const m = /^https:\/\/([^/?#]+)(.*)$/i.exec(url);
  if (!m) return url;
  return `${override.replace(/\/+$/, "")}/${m[1]}${m[2] || "/"}`;
}

export interface ProviderHttp {
  /** fetchWithTimeout (or a test's fake) on the overridden URL. */
  fetch(url: string, init?: TimeoutInit): Promise<Response>;
  /** Waits between retries; tests pass one that does not. */
  sleep(ms: number): Promise<void>;
}

export function providerHttp(override: string | null, fetchFn: FetchFn = fetchWithTimeout, sleep?: (ms: number) => Promise<void>): ProviderHttp {
  return {
    fetch: (url, init) => fetchFn(providerUrl(url, override), init),
    sleep: sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
}

/** Throttling and transient upstream failures worth a short retry. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [500, 2000];
/** A Retry-After longer than this ends the run instead; the next sync resumes. */
const MAX_RETRY_AFTER_MS = 10_000;

function retryAfterMs(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * A provider API call with retries on throttling. Returns the response for
 * any status the caller handles itself (2xx, 4xx); throws ProviderBusyError
 * when throttling or a 5xx outlasts the retries.
 */
export async function callWithRetry(http: ProviderHttp, url: string, init: TimeoutInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await http.fetch(url, init);
    } catch {
      // A timeout or a network error: the same as a 503 for our purposes.
      if (attempt < RETRY_DELAYS_MS.length) {
        await http.sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      throw new ProviderBusyError();
    }
    if (!RETRYABLE.has(res.status)) return res;
    await res.body?.cancel().catch(() => {});
    const wait = retryAfterMs(res) ?? RETRY_DELAYS_MS[attempt] ?? 0;
    if (attempt >= RETRY_DELAYS_MS.length || wait > MAX_RETRY_AFTER_MS) throw new ProviderBusyError();
    await http.sleep(wait);
  }
}

/** The provider's JSON error, read only for its machine codes. */
async function errorShape(res: Response): Promise<{ error: string; reason: string }> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const e = j.error as unknown;
    const error = typeof e === "string" ? e : typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code) : "";
    const reasons = (e as { errors?: { reason?: unknown }[] })?.errors;
    const status = (e as { status?: unknown })?.status;
    const reason = Array.isArray(reasons) && typeof reasons[0]?.reason === "string" ? String(reasons[0].reason) : typeof status === "string" ? status : "";
    return { error, reason };
  } catch {
    return { error: "", reason: "" };
  }
}

/**
 * Map a mailbox API's non-2xx response to an error (never its text):
 *   401 → the access token expired: refresh and retry.
 *   403 → throttling when the provider says so, else the grant no longer
 *         covers mail (scope removed, consent withdrawn): reconnect.
 *   400/404 on a mailbox listing → there is no mailbox to read.
 */
export async function apiError(res: Response): Promise<ProviderError> {
  if (res.status === 401) {
    await res.body?.cancel().catch(() => {});
    return new AccessExpiredError();
  }
  const { error, reason } = await errorShape(res);
  if (res.status === 403) {
    if (/rate|quota|throttl|limit/i.test(`${error} ${reason}`)) return new ProviderBusyError();
    return new ReauthRequiredError();
  }
  if (res.status === 400 || res.status === 404) return new MailboxUnavailableError();
  return new ProviderError("provider_error");
}

/**
 * A token endpoint's failure: invalid_grant (expired, revoked, or a code
 * already used) needs the user; anything else is the provider's or ours.
 */
export async function tokenError(res: Response): Promise<ProviderError> {
  const { error } = await errorShape(res);
  if (error === "invalid_grant") return new ReauthRequiredError();
  if (RETRYABLE.has(res.status)) return new ProviderBusyError();
  return new ProviderError("token_exchange_failed");
}

/**
 * The body, unless it is larger than `maxBytes`: then null, and the rest is
 * not downloaded. Content-Length is checked first, the stream as it arrives.
 */
export async function readBounded(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** JSON from a 2xx response, or a ProviderError (never the text). */
export async function okJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError("provider_error");
  }
}

/** A token endpoint's answer, validated. */
export async function readTokenResponse(res: Response): Promise<{
  access_token: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}> {
  if (!res.ok) throw await tokenError(res);
  const j = await okJson<Record<string, unknown>>(res);
  if (typeof j.access_token !== "string" || !j.access_token) throw new ProviderError("token_exchange_failed");
  return {
    access_token: j.access_token,
    refresh_token: typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : undefined,
    scope: typeof j.scope === "string" ? j.scope : undefined,
    id_token: typeof j.id_token === "string" ? j.id_token : undefined,
  };
}

/** Space- or plus-separated scopes as a set. */
export function scopeSet(scope: string | null | undefined): Set<string> {
  return new Set((scope ?? "").split(/[\s+]+/).filter(Boolean));
}
