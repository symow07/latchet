/**
 * fetch with a mandatory timeout.
 *
 * Bun's fetch has no default timeout, so a hung upstream — OpenAI, Plaid,
 * Google, Expo — held the request open indefinitely. On a single-instance
 * deployment with one SQLite writer, a handful of those exhausts the server.
 * lib/email-otp.ts already did this correctly; nothing else did.
 */

/** Generous enough for a slow model call, short enough to fail visibly. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface TimeoutInit extends RequestInit {
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  input: string,
  init: TimeoutInit = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      // A bare AbortError says nothing about which upstream stalled.
      let host = "upstream";
      try {
        host = new URL(input).host;
      } catch {
        /* keep the generic label */
      }
      throw new Error(`Request to ${host} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
