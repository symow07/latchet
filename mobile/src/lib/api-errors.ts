/**
 * What went wrong talking to the server, in the language the person reads.
 *
 * The *Api modules used to throw `new Error(data.error ?? 'Failed to …')`, and
 * screens show `e.message` — so an English sentence, the server's or ours,
 * reached French, Arabic and Chinese screens. Every *Api function now rejects
 * with an ApiFailure instead: what went wrong as a kind (network, server, not
 * found, forbidden…), and a `.message` that is already the sentence for that
 * kind in the app's language at the moment it was thrown. A screen that does
 * `setErr(e.message)` is right without being touched; errorMessage(e) re-reads
 * the language, for anything shown later.
 *
 * The server's own words travel with the error (`serverMessage`) for the log,
 * and are never what is shown: they are English, written by whoever wrote the
 * route. Only a 4xx's are kept — they describe the request ("Name does not
 * match"). A 5xx body can be anything, a stack trace or a proxy's HTML page.
 *
 * Imports nothing but the i18n core, so it is tested without a device. The
 * shared client's errors (api/api.ts) are recognised by their shape rather
 * than their class for the same reason: importing that module pulls in
 * expo/fetch, which only loads in the app.
 */
import { t } from './i18n/core';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'validation'
  | 'tooLarge'
  | 'rateLimited'
  | 'upgrade'
  | 'server'
  | 'unknown';

/**
 * What a request was for, where that changes what a failure means to the
 * person who made it:
 *   invite     a 404 is an invite code that does not exist, a 409 someone
 *              joining a group they are already in;
 *   typedName  a 400 is a retyped confirmation (a name, an email) that does
 *              not match;
 *   image      a 400 is an image the server cannot use.
 */
export type RequestPurpose = 'invite' | 'typedName' | 'image';

/** The kind of failure an HTTP status reports. */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'upgrade';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'notFound';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 409) return 'conflict';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'validation';
  return 'unknown';
}

/**
 * The sentence for a kind of failure, in the current language.
 *
 * Every key is spelled out rather than built from the kind, so the test that
 * every translation key the app asks for exists (i18n.test.ts) can see them.
 */
export function errorSentence(kind: ApiErrorKind, purpose?: RequestPurpose): string {
  if (purpose === 'invite' && kind === 'notFound') return t('apiErrors.inviteInvalid');
  if (purpose === 'invite' && kind === 'conflict') return t('apiErrors.alreadyMember');
  if (purpose === 'typedName' && kind === 'validation') return t('apiErrors.typedMismatch');
  if (purpose === 'image' && kind === 'validation') return t('apiErrors.imageUnusable');
  switch (kind) {
    case 'network': return t('apiErrors.network');
    case 'timeout': return t('apiErrors.timeout');
    case 'unauthorized': return t('apiErrors.unauthorized');
    case 'forbidden': return t('apiErrors.forbidden');
    case 'notFound': return t('apiErrors.notFound');
    case 'conflict': return t('apiErrors.conflict');
    case 'validation': return t('apiErrors.validation');
    case 'tooLarge': return t('apiErrors.tooLarge');
    case 'rateLimited': return t('apiErrors.rateLimited');
    case 'upgrade': return t('apiErrors.upgrade');
    case 'server': return t('apiErrors.server');
    case 'unknown': return t('apiErrors.unknown');
  }
}

export interface ApiFailureDetails {
  /** The HTTP status, when a response arrived. */
  status?: number | null;
  /** The parsed JSON body, when there was one. */
  body?: unknown;
  /** The server's own words, when they are safe to keep (see userSafeServerMessage). */
  serverMessage?: string | null;
  purpose?: RequestPurpose;
  /** What was actually thrown, for the log. */
  cause?: unknown;
}

/** A request that failed, with a message already in the reader's language. */
export class ApiFailure extends Error {
  readonly kind: ApiErrorKind;
  readonly purpose: RequestPurpose | undefined;
  /** The HTTP status, or null when no response arrived. */
  readonly status: number | null;
  /**
   * The parsed JSON body, or null. Kept because callers read codes from it —
   * isUpgradeRequired looks for `upgrade_required`.
   */
  readonly body: unknown;
  /** The server's words, for the log only: English, and never shown. */
  readonly serverMessage: string | null;

  constructor(kind: ApiErrorKind, details: ApiFailureDetails = {}) {
    super(errorSentence(kind, details.purpose));
    this.name = 'ApiFailure';
    this.kind = kind;
    this.purpose = details.purpose;
    this.status = details.status ?? null;
    this.body = details.body ?? null;
    this.serverMessage = details.serverMessage ?? null;
    if (details.cause !== undefined) this.cause = details.cause;
  }
}

/**
 * The server's message, when it is fit to keep: a 4xx's short plain string.
 * A 5xx's body is not — it can be a stack trace, or a proxy's error page.
 */
export function userSafeServerMessage(status: number, body: unknown): string | null {
  if (status < 400 || status >= 500 || !body || typeof body !== 'object') return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  const words = typeof error === 'string' ? error : typeof message === 'string' ? message : null;
  const trimmed = words?.trim() ?? '';
  if (!trimmed || trimmed.length > 300 || /<[a-z!/]/i.test(trimmed)) return null;
  return trimmed;
}

/** A failure from a status and the body that came with it. */
export function failureFromStatus(
  status: number,
  body: unknown,
  purpose?: RequestPurpose,
  cause?: unknown,
): ApiFailure {
  // The paywall's own code wins over whatever status carried it.
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return new ApiFailure(code === 'upgrade_required' ? 'upgrade' : kindForStatus(status), {
    status,
    body: body && typeof body === 'object' ? body : null,
    serverMessage: userSafeServerMessage(status, body),
    purpose,
    cause,
  });
}

/** A fetch that never got an answer: expo/fetch's FetchError, React Native's TypeError. */
function isTransportFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === 'FetchError' || /^fetch failed\b|network request failed|network error/i.test(e.message);
}

/**
 * Anything a request threw, as an ApiFailure.
 *
 * The shared client (api/api.ts) throws ApiError, NetworkError and
 * TimeoutError, each with an English message; they are recognised by name.
 * Anything unrecognised is 'unknown' — its message is not shown, because
 * nothing says it was written for a person, or in their language.
 */
export function toApiFailure(e: unknown, purpose?: RequestPurpose): ApiFailure {
  const shape = (e && typeof e === 'object' ? e : {}) as {
    name?: unknown;
    kind?: unknown;
    status?: unknown;
    body?: unknown;
  };
  // Also by name: a transpiled subclass of Error can lose instanceof, and an
  // ApiFailure re-wrapped as 'unknown' would show the wrong sentence.
  if (e instanceof ApiFailure || (shape.name === 'ApiFailure' && typeof shape.kind === 'string')) {
    return e as ApiFailure;
  }
  if (shape.name === 'ApiError' && typeof shape.status === 'number') {
    return failureFromStatus(shape.status, shape.body, purpose, e);
  }
  if (shape.name === 'TimeoutError' || shape.name === 'AbortError') {
    return new ApiFailure('timeout', { purpose, cause: e });
  }
  if (shape.name === 'NetworkError' || isTransportFailure(e)) {
    return new ApiFailure('network', { purpose, cause: e });
  }
  return new ApiFailure('unknown', { purpose, cause: e });
}

/**
 * The sentence to show for a failed request, in the language on screen now.
 *
 * For a screen that keeps an error and shows it later: `.message` is fixed in
 * the language of the moment it was thrown, and this is not.
 */
export function errorMessage(e: unknown): string {
  const failure = toApiFailure(e);
  return errorSentence(failure.kind, failure.purpose);
}

/** The parts of a fetch Response read here. expo/fetch's fits, and so does a test's. */
export interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** The ApiFailure a response that is not ok stands for, its body read for detail. */
export async function failureFromResponse(res: ResponseLike, purpose?: RequestPurpose): Promise<ApiFailure> {
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON — a proxy's error page, say. The status says enough.
  }
  return failureFromStatus(res.status, body, purpose);
}

/** Reject a response that is not ok. For calls whose answer has no body worth reading. */
export async function ensureOk(res: ResponseLike, purpose?: RequestPurpose): Promise<void> {
  if (!res.ok) throw await failureFromResponse(res, purpose);
}

/**
 * The JSON body of a successful response.
 *
 * A 200 that is not JSON is the server's failure, not the person's — the old
 * `await res.json()` let its SyntaxError reach the screen.
 */
export async function readJson<T>(res: ResponseLike, purpose?: RequestPurpose): Promise<T> {
  await ensureOk(res, purpose);
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw new ApiFailure('network', { status: res.status, purpose, cause: e });
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ApiFailure('server', { status: res.status, purpose, cause: e });
  }
}

/** Run one request; whatever it throws comes out as an ApiFailure. */
export async function request<T>(run: () => Promise<T>, purpose?: RequestPurpose): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw toApiFailure(e, purpose);
  }
}
