/**
 * The shared client's errors, and how a failed response becomes one.
 *
 * Imports nothing native, so it is tested without a device; api.ts throws
 * these and re-exports them.
 *
 * The backend answers a failure as `{ error: "…", code: "…" }` (its own
 * routes and its error handler both do). The client used to read only a
 * `message` field, which nothing sends, so every refusal reached the screen as
 * "Request failed (400)" and the server's reason was lost. Both fields are read
 * now, through the same rule lib/api-errors.ts applies (userSafeServerMessage):
 * a 4xx's short plain sentence is kept; a 5xx body, an HTML page or anything
 * long is not, and the localized "Request failed" stands instead.
 */
import { userSafeServerMessage } from '../api-errors';
import { t } from '../i18n/core';

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

/** A response that was not ok. `body` is the parsed JSON (or the raw text). */
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

/** What a failed response says: the sentence to carry, and its body. */
export interface ParsedErrorResponse {
  message: string;
  body: unknown;
}

/**
 * Read a failed response. JSON is recognised by its content type or by its
 * shape (a proxy may label it text/plain); a short plain-text 4xx counts as
 * the server's sentence too.
 */
export function parseErrorResponse(status: number, contentType: string, text: string): ParsedErrorResponse {
  let body: unknown = text;
  const trimmed = text.trim();
  if (trimmed && (/json/i.test(contentType) || /^[{[]/.test(trimmed))) {
    try {
      body = JSON.parse(trimmed);
    } catch {
      // Not JSON after all: keep the text.
    }
  }
  const words =
    body && typeof body === 'object'
      ? userSafeServerMessage(status, body)
      : trimmed && !/json/i.test(contentType)
        ? userSafeServerMessage(status, { error: trimmed })
        : null;
  return { message: words ?? t('errors.requestFailed', { status }), body };
}

/** The ApiError a failed response stands for. */
export function apiErrorFrom(status: number, contentType: string, text: string): ApiError {
  const { message, body } = parseErrorResponse(status, contentType, text);
  return new ApiError(status, message, body);
}
